import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getDbClient } from './db-helper.js';

const API_URL = process.env.API_URL || 'http://localhost:8055'; 
let dbClient;

// A helper for the valid base payload to avoid re-typing it.
// Uses an email specific to these tests so we can easily delete them later!
const validPayload = {
  source: "listening_program", // Matches your 'submission_source_check' constraint
  title: "A valid title string",
  body: "This is a valid body that contains at least twenty characters.",
  submitter_email: "test@example.com", 
  consent_to_review: true
};

describe('POST /gm-intake/submissions', () => {

  // --- 1. SETUP & TEARDOWN ---

  beforeAll(async () => {
    // Connect to the DB before tests start
    dbClient = await getDbClient();
  });

  afterAll(async () => {
    // Clean up test data after all tests finish
    if (dbClient) {
      await dbClient.query(`
        -- 1. Delete audit records tied to test submissions to satisfy ON DELETE RESTRICT
        DELETE FROM audit_event 
        WHERE submission_id IN (
          SELECT id FROM submission WHERE submitter_email = 'test@example.com'
        );

        -- 2. Delete the actual test submissions
        DELETE FROM submission 
        WHERE submitter_email = 'test@example.com';
      `);
      await dbClient.end();
    }
  });


  // --- 2. SUCCESSFUL SUBMISSION ---

  it('Valid submission: returns 201 pending', async () => {
    const res = await request(API_URL)
      .post('/gm-intake/submissions')
      .send({ ...validPayload, title: "Unique Success Title " + Date.now() }); 
      // Date.now() ensures we don't trigger the Duplicate Replay 24h block during testing
    
    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.status).toBe('pending');
  });


  // --- 3. HONEYPOT & DUPLICATES (SILENT ABSORPTION) ---

  it('Honeypot filled: silently absorbs and returns 202', async () => {
    const res = await request(API_URL)
      .post('/gm-intake/submissions')
      .send({ ...validPayload, website: "http://spam-bot.com" });
    
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('accepted');
  });

  it('Duplicate replay within 24h: silently absorbs and returns 202', async () => {
    const duplicatePayload = { ...validPayload, title: "Duplicate Test" };
    
    // First request should succeed
    const res1 = await request(API_URL).post('/gm-intake/submissions').send(duplicatePayload);
    expect(res1.status).toBe(201);

    // Immediate second request with identical data should be absorbed
    const res2 = await request(API_URL).post('/gm-intake/submissions').send(duplicatePayload);
    expect(res2.status).toBe(202);
    expect(res2.body.data.status).toBe('accepted');
  });


  // --- 4. SOURCE VALIDATION (400) ---

  it('Invalid source: returns 400 Directus error envelope', async () => {
    const res = await request(API_URL)
      .post('/gm-intake/submissions')
      .send({ ...validPayload, source: "invalid_hacked_source" });
    
    expect(res.status).toBe(400);
    // Intake API must use standard Directus error envelope array
    expect(Array.isArray(res.body.errors)).toBe(true); 
  });


  // --- 5. DATA VALIDATION FAILURES (422) ---

  describe('Validation failures (422)', () => {
    
    it('Fails if title is too short', async () => {
      const res = await request(API_URL)
        .post('/gm-intake/submissions')
        .send({ ...validPayload, title: "ab" }); // less than 3 chars
      
      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    it('Fails if body is too short', async () => {
      const res = await request(API_URL)
        .post('/gm-intake/submissions')
        .send({ ...validPayload, body: "Too short" }); // less than 20 chars
      
      expect(res.status).toBe(422);
    });

    it('Fails if missing consent_to_review', async () => {
      const { consent_to_review, ...noConsentPayload } = validPayload;
      const res = await request(API_URL)
        .post('/gm-intake/submissions')
        .send(noConsentPayload);
      
      expect(res.status).toBe(422);
    });

    it('Fails if contact info supplied without consent_to_contact', async () => {
      const res = await request(API_URL)
        .post('/gm-intake/submissions')
        .send({ 
          ...validPayload, 
          submitter_phone: "555-1234", 
          consent_to_contact: false // or missing
        });
      
      expect(res.status).toBe(422);
    });
  });


  // --- 6. RATE LIMITING (429) ---

  it('Rate limits after 5 submissions in 60min', async () => {
    let finalRes;
    // Fire 6 distinct requests rapidly (altering the title slightly so it doesn't trigger the Duplicate Replay block)
    for (let i = 0; i < 6; i++) {
      finalRes = await request(API_URL)
        .post('/gm-intake/submissions')
        .send({ ...validPayload, title: `Rate Limit Test ${i}` });
    }
    
    // The 6th request should be blocked
    expect(finalRes.status).toBe(429);
    expect(Array.isArray(finalRes.body.errors)).toBe(true);
  });
  
});