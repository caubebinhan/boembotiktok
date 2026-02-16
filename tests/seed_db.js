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

db.prepare(`
    INSERT INTO campaigns (name, type, status, config_json) 
    VALUES (?, ?, ?, ?)
`).run('Template Campaign', 'scheduled', 'active', JSON.stringify(config));

console.log('Inserting Publish Account...');
const existing = db.prepare('SELECT id FROM publish_accounts WHERE username = ?').get('test_user_clone');
if (!existing) {
    db.prepare(`
        INSERT INTO publish_accounts (username, session_valid, avatar_url) VALUES (?, ?, ?)
    `).run('test_user_clone', 1, 'https://example.com/avatar.png');
}

console.log('Seeding Complete.');
db.close();
