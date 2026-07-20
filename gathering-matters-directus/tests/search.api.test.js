import { describe, it, expect } from 'vitest';
import request from 'supertest';

const API_URL = process.env.API_URL || 'http://localhost:8055'; 

describe('GET /extensions/gm-library/search', () => {

  it('Blank q: defaults to feed mode, newest sort, and limit 12', async () => {
    const res = await request(API_URL).get('/gm-library/search');
    console.log("STATUS:", res.status, "BODY:", res.body, "ERROR:", res.error?.message);
    expect(res.status).toBe(200);
    expect(res.body.meta.has_text_query).toBe(false);
    expect(res.body.meta.too_vague).toBe(false);
    expect(res.body.meta.sort).toBe('newest');
    expect(res.body.meta.limit).toBe(12);
  });

  it('Stopword/punctuation-only q: returns empty data with flags', async () => {
    const res = await request(API_URL).get('/gm-library/search?q=the !!!');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]); 
    expect(res.body.meta.too_vague).toBe(true);
  });

  it('Pagination is STRICT: 400 invalid_pagination', async () => {
    const res = await request(API_URL).get(`/gm-library/search?limit=12junk`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_pagination');
  });

  it('CRITICAL: strictly enforces card projection allowlist', async () => {
    const res = await request(API_URL).get('/gm-library/search');
    expect(res.status).toBe(200);
    
    const allowedKeys = [
      'id', 'title', 'slug', 'summary', 'external_url', 
      'featured', 'published_at', 'content_type', 'content_type_slug'
    ];
    
    const forbiddenKeys = [
      'body', 'editorial_notes', 'privacy_reviewed_at', 
      'privacy_reviewed_by', 'author', 'rank'
    ];

    res.body.data.forEach(card => {
      const cardKeys = Object.keys(card);
      cardKeys.forEach(key => expect(allowedKeys).toContain(key));
      forbiddenKeys.forEach(key => expect(cardKeys).not.toContain(key));
    });
  });

  it('Bad cursor formatting/signature: returns 400 invalid_cursor', async () => {
    const res = await request(API_URL).get('/gm-library/search?cursor=fake_tampered_cursor_string');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_cursor');
  });
});