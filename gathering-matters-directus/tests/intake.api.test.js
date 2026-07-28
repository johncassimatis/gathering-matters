import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { testFixtures } from './fixtures.js';

const API_URL = process.env.API_URL || 'http://localhost:8055';
const fixtures = testFixtures();

const validPayload = {
  source: 'listening_program',
  title: 'A valid title string',
  body: 'This is a valid body that contains at least twenty characters.',
  submitter_email: fixtures.email,
  consent_to_review: true,
  consent_to_contact: true,
};

function intakeRequest(path) {
  return request(API_URL).post(path).set('x-gm-test-run-id', fixtures.runId);
}

describe('POST /gm-intake/submissions', () => {
  it('Valid submission: returns 201 pending', async () => {
    const res = await intakeRequest('/gm-intake/submissions')
      .send({ ...validPayload, title: `${fixtures.successTitlePrefix}-${Date.now()}` });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.status).toBe('pending');
  });

  it('Honeypot filled: silently absorbs and returns 202', async () => {
    const res = await intakeRequest('/gm-intake/submissions')
      .send({ ...validPayload, website: 'http://spam-bot.com' });

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('accepted');
  });

  it('Duplicate replay within 24h: silently absorbs and returns 202', async () => {
    const duplicatePayload = { ...validPayload, title: fixtures.duplicateTitlePrefix };

    const res1 = await intakeRequest('/gm-intake/submissions').send(duplicatePayload);
    expect(res1.status).toBe(201);

    const res2 = await intakeRequest('/gm-intake/submissions').send(duplicatePayload);
    expect(res2.status).toBe(202);
    expect(res2.body.data.status).toBe('accepted');
  });

  it('Invalid source: returns 400 Directus error envelope', async () => {
    const res = await intakeRequest('/gm-intake/submissions')
      .send({ ...validPayload, source: 'invalid_hacked_source' });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  describe('Validation failures (422)', () => {
    it('Fails if title exceeds the max length', async () => {
      const res = await intakeRequest('/gm-intake/submissions')
        .send({ ...validPayload, title: 'x'.repeat(200) });

      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    it('young_adult_initiative fails without preferred_follow_up', async () => {
      const res = await intakeRequest('/gm-intake/submissions')
        .send({ ...validPayload, source: 'young_adult_initiative' });

      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    it('rejects an invalid preferred_follow_up value', async () => {
      const res = await intakeRequest('/gm-intake/submissions')
        .send({ ...validPayload, source: 'young_adult_initiative', preferred_follow_up: 'carrier_pigeon' });

      expect(res.status).toBe(422);
    });

    it('Fails if body is too short', async () => {
      const res = await intakeRequest('/gm-intake/submissions')
        .send({ ...validPayload, body: 'Too short' });

      expect(res.status).toBe(422);
    });

    it('Fails if missing consent_to_review', async () => {
      const { consent_to_review, ...noConsentPayload } = validPayload;
      const res = await intakeRequest('/gm-intake/submissions')
        .send(noConsentPayload);

      expect(res.status).toBe(422);
    });

    it('Fails if submitter_email is missing (required for every source)', async () => {
      const { submitter_email, ...noEmail } = validPayload;
      const res = await intakeRequest('/gm-intake/submissions').send(noEmail);

      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    it('Fails if young_adult_initiative is missing submitter_email', async () => {
      const { submitter_email, ...noEmail } = validPayload;
      const res = await intakeRequest('/gm-intake/submissions')
        .send({ ...noEmail, source: 'young_adult_initiative' });

      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    it('young_adult_initiative fails without consent_to_contact', async () => {
      const res = await intakeRequest('/gm-intake/submissions')
        .send({ ...validPayload, source: 'young_adult_initiative', consent_to_contact: false });

      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });
  });

  it('Listening Program: fails without consent_to_contact (contact consent now required for every source)', async () => {
    const res = await intakeRequest('/gm-intake/submissions')
      .send({ ...validPayload, consent_to_contact: false });

    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('Title is optional at intake (single-idea forms send none)', async () => {
    const { title, ...noTitle } = validPayload;
    const res = await intakeRequest('/gm-intake/submissions')
      .send({ ...noTitle, body: `Optional-title submission with at least twenty characters ${Date.now()}` });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
  });

  it('Young Adult Initiative: valid submission with contact + follow-up + updates returns 201', async () => {
    const res = await intakeRequest('/gm-intake/submissions')
      .send({ ...validPayload, source: 'young_adult_initiative', preferred_follow_up: 'video', consent_to_updates: true, title: `${fixtures.successTitlePrefix}-yai-${Date.now()}` });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
  });

  it('Rate limits after 5 submissions in 60min', async () => {
    let finalRes;
    for (let i = 0; i < 6; i += 1) {
      finalRes = await intakeRequest('/gm-intake/submissions')
        .send({ ...validPayload, title: `${fixtures.rateLimitTitlePrefix}-${i}` });
    }

    expect(finalRes.status).toBe(429);
    expect(Array.isArray(finalRes.body.errors)).toBe(true);
  });
});
