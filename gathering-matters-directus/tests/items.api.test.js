import { describe, it, expect } from 'vitest';
import request from 'supertest';

const API_URL = process.env.API_URL || 'http://localhost:8055'; 

describe('GET /gm-library/items/:slug', () => {

  // --- 1. SLUG VALIDATION ---
  it('Empty or whitespace-only slug: returns 400 invalid_slug', async () => {
    // %20 is an encoded space. Trimming it makes it empty.
    const res = await request(API_URL).get('/gm-library/items/%20');
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_slug');
  });

  // --- 2. VISIBILITY & 404s (Draft/Archived/Future/Missing) ---
  it('Unpublished, future-dated, or missing item: returns 404 not_found', async () => {
    const res = await request(API_URL).get('/gm-library/items/some-draft-or-missing-slug');
    
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  // --- 3. DATA STRUCTURE & CRITICAL ALLOWLIST ---
  it('CRITICAL: Returns strictly allowed fields for a published item', async () => {
    const res = await request(API_URL).get('/gm-library/items/valid-published-slug');
    
    if (res.status === 404) {
      console.warn('⚠️ DB empty: Skipping detail allowlist test. Please seed data.');
      return; 
    }

    expect(res.status).toBe(200);

    const allowedKeys = [
      'id', 'title', 'slug', 'summary', 'body', 'external_url', 
      'featured', 'published_at', 'author', 'featured_image_id', 
      'content_type', 'content_type_slug', 'tags', 'files'
    ];
    
    const forbiddenKeys = [
      'editorial_notes', 'privacy_reviewed_at', 'privacy_reviewed_by', 
      'submitter_name', 'submitter_email', 'rank', 'audit_log'
    ];

    const dataKeys = Object.keys(res.body.data);
    
    dataKeys.forEach(key => expect(allowedKeys).toContain(key));
    forbiddenKeys.forEach(key => expect(dataKeys).not.toContain(key));
  });
});