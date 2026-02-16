
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');

async function run() {
    const dbPath = 'C:\\Users\\linhlinh\\AppData\\Roaming\\boembo\\boembo.sqlite';
    console.log('Checking jobs in:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('File not found');
        return;
    }

    const db = new Database(dbPath);
    const jobs = db.prepare("SELECT id, type, status, error_message, result_json, created_at, started_at, completed_at FROM jobs ORDER BY created_at DESC LIMIT 10").all();

    console.log('--- LATEST JOBS ---');
    jobs.forEach(j => {
        console.log(`[${j.id}] ${j.type} | Status: ${j.status} | Created: ${j.created_at}`);
        if (j.error_message) console.log(`   Error: ${j.error_message}`);
        if (j.result_json) console.log(`   Result: ${j.result_json}`);
    });

    db.close();
}

run();
