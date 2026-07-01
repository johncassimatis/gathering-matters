// extensions/endpoints/gm-library/index.js
// Public, read-only library endpoints:
//   GET /gm-library/search        faceted full-text search + feed, signed keyset cursor
//   GET /gm-library/items/:slug    single published item detail
//
// The status='published' AND published_at<=as_of filter is enforced HERE for every query and
// is never trusted from the client. Cursors are HMAC-signed; as_of freezes the browsing window.
import crypto from 'node:crypto';

const ALLOWED_SORTS = new Set(['relevance', 'newest', 'oldest']);
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;
const MAX_FILTER_VALUES = 20;
const MAX_QUERY_LENGTH = 256;
const TS_CONFIG = 'english';
const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000; // a cursor (its as_of window) is valid for 24h

// Public card projection. No body, no editorial_notes, no submission/PII/audit/privacy fields.
const CARD_COLUMNS = `
  ci.id, ci.title, ci.slug, ci.summary, ci.external_url, ci.featured,
  ci.published_at, ct.name AS content_type, ct.slug AS content_type_slug
`;

function badRequest(code) {
  const err = new Error(code);
  err.statusCode = 400;
  err.code = code;
  return err;
}

function toArray(value, fieldName) {
  if (value === undefined || value === null) return [];
  const values = (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  if (values.length > MAX_FILTER_VALUES) throw badRequest('too_many_filter_values');
  return [...new Set(values)];
}

// Strict: only an exact positive integer 1..MAX_LIMIT is accepted. No coercion, no clamping.
// Absent => default. Anything malformed ('12junk', '1e3', '0', '-1', '999999') => 400.
function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const s = String(raw);
  if (!/^[0-9]+$/.test(s)) throw badRequest('invalid_pagination');
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw badRequest('invalid_pagination');
  return n;
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function b64urlDecode(str) {
  return JSON.parse(Buffer.from(String(str), 'base64url').toString('utf8'));
}
function sign(secret, payloadWithoutSig) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payloadWithoutSig)).digest('base64url');
}
function filtersHash(secret, parts) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

export default {
  id: 'gm-library',
  handler: (router, { database: knex, logger, env }) => {
    const cursorSecret = env.GM_SEARCH_CURSOR_SECRET;

    // ---------------------------------------------------------------- SEARCH / FEED
    router.get('/search', async (req, res) => {
      try {
        if (!cursorSecret) {
          logger.error('GM_SEARCH_CURSOR_SECRET is not configured');
          return res.status(500).json({ error: 'search_unavailable' });
        }
        const db = knex; // full connection; this path only reads

        const rawQ = String(req.query.q ?? '').trim();
        if (rawQ.length > MAX_QUERY_LENGTH) throw badRequest('query_too_long');

        const limit = parseLimit(req.query.limit);
        const requestedSort = String(req.query.sort ?? '').toLowerCase();

        const topicSlugs = toArray(req.query.topic, 'topic');
        const audienceSlugs = toArray(req.query.audience, 'audience');
        const regionSlugs = toArray(req.query.region, 'region');
        const typeSlugs = toArray(req.query.content_type, 'content_type');
        const tagSlugs = toArray(req.query.tag, 'tag');

        // Classify the text query: blank vs real vs stopword/punctuation-only.
        let hasTextQuery = false;
        let tooVague = false;
        if (rawQ !== '') {
          const probe = await db.raw(`SELECT numnode(websearch_to_tsquery(?, ?)) = 0 AS is_empty`, [TS_CONFIG, rawQ]);
          tooVague = probe.rows[0].is_empty;
          hasTextQuery = !tooVague;
        }
        if (tooVague) {
          return res.json({
            data: [],
            meta: { sort: 'newest', limit, has_text_query: false, too_vague: true, next_cursor: null,
                    message: 'Try a more specific search term.' },
          });
        }

        let sort = ALLOWED_SORTS.has(requestedSort) ? requestedSort : (hasTextQuery ? 'relevance' : 'newest');
        if (sort === 'relevance' && !hasTextQuery) sort = 'newest';

        const fhash = filtersHash(cursorSecret, { rawQ, sort, topicSlugs, audienceSlugs, regionSlugs, typeSlugs, tagSlugs });

        // Decode + validate cursor (also yields the frozen as_of boundary).
        let cursor = null;
        if (req.query.cursor !== undefined && req.query.cursor !== '') {
          try {
            const decoded = b64urlDecode(req.query.cursor);
            const { sig, ...payload } = decoded;
            if (payload.v !== CURSOR_VERSION) throw new Error('version');
            if (payload.sort !== sort) throw new Error('sort');
            if (payload.filters_hash !== fhash) throw new Error('filters');
            if (typeof payload.as_of !== 'string' || typeof payload.last_id !== 'string') throw new Error('shape');
            if (typeof payload.last_published_at !== 'string') throw new Error('shape');
            const asOfMs = Date.parse(payload.as_of);
            if (Number.isNaN(asOfMs) || (Date.now() - asOfMs) > CURSOR_TTL_MS) throw new Error('expired');
            if (sign(cursorSecret, payload) !== sig) throw new Error('sig');
            cursor = payload;
          } catch {
            throw badRequest('invalid_cursor');
          }
        }
        const asOf = cursor ? cursor.as_of : new Date().toISOString();

        // Shared WHERE builder. Mandatory visibility filter + as_of boundary, server-enforced.
        const applyWhere = (qb) => {
          qb.from('content_item as ci')
            .join('content_type as ct', 'ct.id', 'ci.content_type_id')
            .where('ci.status', 'published')
            .whereRaw('ci.published_at <= ?', [asOf]);
          if (hasTextQuery) qb.whereRaw(`ci.search_tsv @@ websearch_to_tsquery(?, ?)`, [TS_CONFIG, rawQ]);
          if (typeSlugs.length) qb.whereIn('ct.slug', typeSlugs);
          const tagExists = (dimension, slugs) => qb.whereExists(function () {
            this.select(db.raw('1'))
              .from('content_item_tag as cit')
              .join('tag as t', 't.id', 'cit.tag_id')
              .whereRaw('cit.content_item_id = ci.id')
              .where('t.is_active', true)
              .modify((q) => { if (dimension) q.where('t.dimension', dimension); })
              .whereIn('t.slug', slugs);
          });
          if (topicSlugs.length) tagExists('topic', topicSlugs);
          if (audienceSlugs.length) tagExists('audience', audienceSlugs);
          if (regionSlugs.length) tagExists('region', regionSlugs);
          if (tagSlugs.length) tagExists(null, tagSlugs);
        };

        const dataQ = db.queryBuilder();
        applyWhere(dataQ);

        // Sort + keyset predicate + projection.
        if (sort === 'relevance') {
          dataQ.select(
            db.raw(CARD_COLUMNS),
            db.raw(`round(ts_rank_cd(ci.search_tsv, websearch_to_tsquery(?, ?))::numeric, 8) AS rank`, [TS_CONFIG, rawQ])
          );
          if (cursor) {
            dataQ.whereRaw(
              `(round(ts_rank_cd(ci.search_tsv, websearch_to_tsquery(?, ?))::numeric, 8) < ?
                OR (round(ts_rank_cd(ci.search_tsv, websearch_to_tsquery(?, ?))::numeric, 8) = ?
                    AND (ci.published_at < ? OR (ci.published_at = ? AND ci.id < ?))))`,
              [TS_CONFIG, rawQ, cursor.last_rank, TS_CONFIG, rawQ, cursor.last_rank,
               cursor.last_published_at, cursor.last_published_at, cursor.last_id]
            );
          }
          dataQ.orderByRaw('rank DESC, ci.published_at DESC, ci.id DESC');
        } else {
          dataQ.select(db.raw(CARD_COLUMNS));
          const desc = sort !== 'oldest';
          if (cursor) {
            const cmp = desc ? '<' : '>';
            dataQ.whereRaw(
              `(ci.published_at ${cmp} ? OR (ci.published_at = ? AND ci.id ${cmp} ?))`,
              [cursor.last_published_at, cursor.last_published_at, cursor.last_id]
            );
          }
          dataQ.orderBy('ci.published_at', desc ? 'desc' : 'asc').orderBy('ci.id', desc ? 'desc' : 'asc');
        }

        dataQ.limit(limit + 1); // fetch one extra to know if there's a next page
        const rows = await dataQ;

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;

        let nextCursor = null;
        if (hasMore) {
          const last = pageRows[pageRows.length - 1];
          const payload = {
            v: CURSOR_VERSION, sort, filters_hash: fhash, as_of: asOf,
            last_published_at: (last.published_at instanceof Date ? last.published_at.toISOString() : last.published_at),
            last_id: last.id,
            last_rank: sort === 'relevance' ? String(last.rank) : null,
          };
          nextCursor = b64urlEncode({ ...payload, sig: sign(cursorSecret, payload) });
        }

        // Strip the internal rank field from the public projection.
        const data = pageRows.map(({ rank, ...card }) => card);

        return res.json({
          data,
          meta: { sort, limit, has_text_query: hasTextQuery, too_vague: false, next_cursor: nextCursor },
        });
      } catch (err) {
        if (err.statusCode === 400) return res.status(400).json({ error: err.code ?? 'invalid_request' });
        logger.error(err, 'gm-library/search failed');
        return res.status(500).json({ error: 'search_failed' });
      }
    });

    // ---------------------------------------------------------------- DETAIL
    router.get('/items/:slug', async (req, res) => {
      try {
        const db = knex;
        const slug = String(req.params.slug ?? '').trim().toLowerCase();
        if (!slug) return res.status(400).json({ error: 'invalid_slug' });

        const item = await db('content_item as ci')
          .join('content_type as ct', 'ct.id', 'ci.content_type_id')
          .where('ci.slug', slug)
          .where('ci.status', 'published')
          .whereRaw('ci.published_at <= now()')
          .first(
            'ci.id', 'ci.title', 'ci.slug', 'ci.summary', 'ci.body', 'ci.external_url',
            'ci.featured', 'ci.published_at', 'ci.author', 'ci.featured_image_id',
            { content_type: 'ct.name' }, { content_type_slug: 'ct.slug' }
          );
        if (!item) return res.status(404).json({ error: 'not_found' });

        const tags = await db('content_item_tag as cit')
          .join('tag as t', 't.id', 'cit.tag_id')
          .where('cit.content_item_id', item.id)
          .where('t.is_active', true)
          .select('t.slug', 't.name', 't.dimension')
          .orderBy('t.dimension')
          .orderBy('t.name');

        const files = await db('content_item_file')
          .where('content_item_id', item.id)
          .where('is_download', true)
          .select('directus_file_id', 'label', 'sort')
          .orderBy('sort')
          .orderBy('id');

        return res.json({ data: { ...item, tags, files } });
      } catch (err) {
        logger.error(err, 'gm-library/items failed');
        return res.status(500).json({ error: 'detail_failed' });
      }
    });
  },
};
