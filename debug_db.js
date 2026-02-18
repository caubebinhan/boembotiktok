
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function checkDB() {
    try {
        // Path to DB (hardcoded based on findings)
        const dbPath = 'C:\\Users\\linhlinh\\AppData\\Roaming\\boembo\\boembo.sqlite';

        if (!fs.existsSync(dbPath)) {
            console.error(`DB not found at: ${dbPath}`);
            return;
        }

        const buffer = fs.readFileSync(dbPath);
        const SQL = await initSqlJs();
        const db = new SQL.Database(buffer);

        console.log('--- Latest Campaign ---');
        const campRes = db.exec("SELECT id, name, config_json FROM campaigns ORDER BY id DESC LIMIT 1");
        if (campRes.length > 0) {
            const cols = campRes[0].columns;
            const row = campRes[0].values[0];
            const data = {};
            cols.forEach((col, i) => data[col] = row[i]);

            console.log(`ID: ${data.id}, Name: ${data.name}`);
            try {
                const config = JSON.parse(data.config_json);
                console.log(`[CAMPAIGN] ID: ${data.id}, Name: "${data.name}"`);
                console.log(`[CAMPAIGN] captionTemplate: "${config.captionTemplate}"`);
            } catch (e) {
                console.log('[CAMPAIGN] Failed to parse config JSON');
            }
        } else {
            console.log('[CAMPAIGN] No campaigns found.');
        }

        console.log('\n--- Latest Job ---');
        const jobRes = db.exec("SELECT id, campaign_id, type, status, data_json FROM jobs ORDER BY id DESC LIMIT 1");
        if (jobRes.length > 0) {
            const cols = jobRes[0].columns;
            const row = jobRes[0].values[0];
            const data = {};
            cols.forEach((col, i) => data[col] = row[i]);

            try {
                const jobData = JSON.parse(data.data_json);
                console.log(`[JOB] ID: ${data.id}, Type: ${data.type}, Status: ${data.status}`);
                console.log(`[JOB] Caption: "${jobData.caption ? jobData.caption.substring(0, 50) + '...' : 'N/A'}"`);
                console.log(`[JOB] customCaption: "${jobData.customCaption}"`);
            } catch (e) {
                console.log('[JOB] Job Data parse error');
            }
        } else {
            console.log('[JOB] No jobs found.');
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

checkDB();
