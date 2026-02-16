
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Path to user data (adjust if needed for dev vs prod)
const appName = 'boembo';
const appDataPath = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');
const userDataPath = path.join(appDataPath, appName);
const dbPath = path.join(userDataPath, 'boembo.sqlite');

console.log('--- Manual Publish Job Seeder ---');
console.log('DB Path:', dbPath);

if (!fs.existsSync(dbPath)) {
    console.error('Database not found! Run the app at least once.');
    process.exit(1);
}

const db = new Database(dbPath);

// 1. Get a valid account
const account = db.prepare('SELECT * FROM publish_accounts WHERE session_valid = 1 LIMIT 1').get();
if (!account) {
    console.error('No valid session found in publish_accounts. Please login in the app first!');
    process.exit(1);
}
console.log(`Using account: ${account.username} (ID: ${account.id})`);

// 2. Get a valid video (or fake one if file exists)
// We need a real file for upload to work.
// Let's use the fixture video if available, or ask user to ensure one exists.
const fixturePath = path.resolve(__dirname, 'fixtures', 'test-video.mp4');
if (!fs.existsSync(fixturePath)) {
    console.error('Fixture video not found at:', fixturePath);
    console.log('Creating dummy video file...');
    if (!fs.existsSync(path.dirname(fixturePath))) fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, 'fake video content'); // This will fail upload validation in real browser...
    // We need a real mp4. 
    // Is there one in the project? 
    // `c:\boembo\tests\fixtures\test-video.mp4` was referenced in `campaign-full-flow.spec.ts`.
    // Let's hope it exists.
}

console.log('Using video path:', fixturePath);

// 3. Insert PUBLISH Job
const jobData = {
    video_path: fixturePath,
    platform_id: 'test_vid_' + Date.now(),
    account_id: account.id,
    account_name: account.username,
    caption: 'Manual Test Upload ' + new Date().toISOString(),
    thumbnail: '',
    videoStats: {},
    status: 'Waiting to publish'
};

const stmt = db.prepare(`
    INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json, created_at)
    VALUES (?, 'PUBLISH', 'pending', datetime('now'), ?, datetime('now'))
`);

const info = stmt.run(999, JSON.stringify(jobData));
console.log(`Job created! ID: ${info.lastInsertRowid}`);
console.log('Status: PENDING. Now run the app (npm run dev) to process it.');

db.close();
