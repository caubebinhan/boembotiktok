const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const userDataPath = path.join(process.env.APPDATA || 'C:\\Users\\linhlinh\\AppData\\Roaming', 'boembo');
const dbPath = path.join(userDataPath, 'boembo.sqlite');

console.log('Seeding DB at:', dbPath);

if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });

const db = new Database(dbPath);

console.log('Creating tables...');
db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        cron_expression TEXT,
        status TEXT DEFAULT 'active',
        config_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS publish_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        session_valid INTEGER DEFAULT 0,
        cookies_json TEXT,
        proxy_url TEXT,
        last_login_at DATETIME,
        daily_post_count INTEGER DEFAULT 0,
        last_post_date TEXT
    );
`);

console.log('Inserting Template Campaign...');
const config = {
    sources: { keywords: [{ keyword: 'funny cats', maxScanCount: 10 }] },
    schedule: { interval: 30, startTime: '08:00', endTime: '20:00', days: ['Mon'] }
};

// Insert a valid account check
const account = db.prepare('SELECT * FROM publish_accounts WHERE session_valid = 1 LIMIT 1').get();
if (account) {
    console.log(`Found valid account: ${account.username} (ID: ${account.id})`);

    // Create dummy video file
    const fixturePath = path.resolve(__dirname, 'fixtures', 'test-video.mp4');
    if (!fs.existsSync(path.dirname(fixturePath))) fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    if (!fs.existsSync(fixturePath)) fs.writeFileSync(fixturePath, 'fake video content'); // Ensure file exists

    // Create PUBLISH job
    const jobData = {
        video_path: fixturePath,
        platform_id: 'test_vid_' + Date.now(),
        account_id: account.id,
        account_name: account.username,
        caption: 'Manual Test Upload ' + new Date().toISOString(),
        videoStats: {},
        status: 'Waiting to publish'
    };

    console.log('Injecting PUBLISH job...');
    db.prepare(`
        INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json, created_at)
        VALUES (?, 'PUBLISH', 'pending', datetime('now'), ?, datetime('now'))
    `).run(999, JSON.stringify(jobData));
    console.log('PUBLISH job injected.');
} else {
    console.log('No valid account found. Skipping publish job injection.');
}

db.prepare(`
    INSERT INTO campaigns (name, type, status, config_json) 
    VALUES (?, ?, ?, ?)
`).run('Template Campaign', 'scheduled', 'active', JSON.stringify(config));

console.log('Seeding Complete.');
db.close();
