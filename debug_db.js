const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'boembo', 'boembo.sqlite');
console.log("DB Path:", dbPath);

if (!fs.existsSync(dbPath)) {
    console.error("Database file not found!");
    process.exit(1);
}

const db = new Database(dbPath, { verbose: console.log });

console.log("--- System Time ---");
console.log("JS Date.now():", new Date().toISOString());

const times = db.prepare("SELECT datetime('now') as db_now, datetime('now', 'localtime') as db_local").get();
console.log("DB datetime('now'):", times.db_now);
console.log("DB datetime('now', 'localtime'):", times.db_local);

console.log("\n--- Pending Jobs ---");
const jobs = db.prepare("SELECT id, campaign_id, type, status, scheduled_for, created_at FROM jobs WHERE status = 'pending'").all();
if (jobs.length > 0) {
    console.table(jobs);
} else {
    console.log("No pending jobs.");
}

console.log("\n--- Active Campaigns ---");
const campaigns = db.prepare("SELECT id, name, status, config_json FROM campaigns WHERE status = 'active'").all();
campaigns.forEach(r => {
    let config = {};
    try { config = JSON.parse(r.config_json || '{}'); } catch (e) { }
    console.log(`Campaign ${r.id} (${r.name}): RunAt=${config.schedule?.runAt}`);
});

db.close();
