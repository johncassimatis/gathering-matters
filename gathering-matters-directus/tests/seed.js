const { Client } = require('pg');
const fs = require('fs');
const toml = require('toml');
const path = require('path');

async function seedDatabase() {
  console.log('🚀 Starting seed script...');
  
  let client;

  try {
    // 1. Locate the flyway.toml file 
    const tomlPath = path.resolve(process.cwd(), '../gathering-matters-db/flyway.user.toml');
    console.log(`📂 Looking for Flyway config at: ${tomlPath}`);
    
    if (!fs.existsSync(tomlPath)) {
        throw new Error(`Could not find flyway.user.toml at ${tomlPath}.`);
    }

    const tomlFile = fs.readFileSync(tomlPath, 'utf-8');
    const config = toml.parse(tomlFile);

    // 2. Extract credentials specifically from [environments.personal]
    const personalEnv = config.environments?.personal;
    if (!personalEnv) throw new Error("Could not find [environments.personal] in flyway.toml");

    const rawUrl = personalEnv.url;
    if (!rawUrl) throw new Error("Could not find the 'url' property inside [environments.personal]");

    // 3. Format Flyway JDBC URL to Node Postgres URL
    let cleanUrl = rawUrl.replace(/^jdbc:/, '');
    const dbUrlObj = new URL(cleanUrl);
    if (personalEnv.user) dbUrlObj.username = personalEnv.user;
    if (personalEnv.password) dbUrlObj.password = encodeURIComponent(personalEnv.password);

    // 4. Connect to DB
    client = new Client({
      connectionString: dbUrlObj.toString(),
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    console.log('✅ Connected! Preparing test data...');

    // --- 5. GET DIRECTUS USER ID ---
    // The schema requires a valid directus_users UUID for privacy_reviewed_by
    const userRes = await client.query(`SELECT id FROM directus_users LIMIT 1;`);
    if (userRes.rowCount === 0) {
      throw new Error("No users found in directus_users. Make sure Directus has booted up at least once!");
    }
    const adminUserId = userRes.rows[0].id;


    // --- 6. EXECUTE SCHEMA-ALIGNED SQL QUERIES ---

    console.log('🧹 Cleaning up old test data (including audit tables)...');
    
    // A. CLEANUP (Must be deleted in this exact order to satisfy foreign keys)
    await client.query(`
      -- 1. Delete audit events referencing test submissions or content items
      DELETE FROM audit_event WHERE content_item_id IN (
          SELECT id FROM content_item WHERE slug IN ('valid-published-slug', 'some-draft-or-missing-slug')
      ) OR submission_id IN (
          SELECT id FROM submission WHERE submitter_email = 'test@example.com' OR title LIKE 'Rate Limit Test%'
      );

      -- 2. Delete test submissions (from the POST tests)
      DELETE FROM submission WHERE submitter_email = 'test@example.com' OR title LIKE 'Rate Limit Test%';

      -- 3. Delete file attachments and tags referencing test content items
      DELETE FROM content_item_file WHERE content_item_id IN (
          SELECT id FROM content_item WHERE slug IN ('valid-published-slug', 'some-draft-or-missing-slug')
      );
      DELETE FROM content_item_tag WHERE content_item_id IN (
          SELECT id FROM content_item WHERE slug IN ('valid-published-slug', 'some-draft-or-missing-slug')
      );

      -- 4. Delete the test content items themselves
      DELETE FROM content_item WHERE slug IN ('valid-published-slug', 'some-draft-or-missing-slug');
      
      -- 5. Delete the test content type
      DELETE FROM content_type WHERE slug = 'test-article-type';
    `);

    console.log('🌱 Injecting fresh test data...');

    // B. SEED: CONTENT TYPE
    const typeRes = await client.query(`
      INSERT INTO content_type (name, slug, description, is_active) 
      VALUES ('Test Article Type', 'test-article-type', 'Created for automated tests', true)
      RETURNING id;
    `);
    const contentTypeId = typeRes.rows[0].id; 

    // C. SEED: PUBLISHED CONTENT ITEM
    // Now uses actual columns for editorial_notes, privacy_reviewed_at, privacy_reviewed_by
    await client.query(`
      INSERT INTO content_item (
          status, title, slug, summary, body, external_url, 
          featured, published_at, author, source, content_type_id,
          editorial_notes, privacy_reviewed_at, privacy_reviewed_by
      ) VALUES (
          'published', 
          'Test Published Article', 
          'valid-published-slug', 
          'This is a valid summary.', 
          'This body should be hidden in search but visible in detail.', 
          'https://example.com', 
          false, 
          '2023-01-01 10:00:00+00', 
          'Jane Doe', 
          'gm_upload', 
          $1,
          'CRITICAL: This note must never be exposed by the API.',
          '2023-01-01 09:00:00+00',
          $2
      );
    `, [contentTypeId, adminUserId]); // $1 = content_type_id, $2 = directus_users(id)

    // D. SEED: DRAFT CONTENT ITEM
    await client.query(`
      INSERT INTO content_item (
          status, title, slug, summary, body, source, content_type_id
      ) VALUES (
          'draft', 
          'Test Draft Article', 
          'some-draft-or-missing-slug', 
          'Draft summary.', 
          'Draft body.', 
          'gm_upload', 
          $1
      );
    `, [contentTypeId]);

    console.log('🎉 Dummy data successfully seeded!');

  } catch (error) {
    console.error('\n❌ SEED SCRIPT FAILED:');
    console.error(error.message);
    process.exit(1); 
  } finally {
    if (client) {
        await client.end();
    }
  }
}

seedDatabase();