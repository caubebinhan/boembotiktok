
const { Database } = require('sql.js');
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

async function checkJobs() {
    try {
        const userData = app.getPath('userData');
        const dbPath = path.join(userData, 'boembo.sqlite');
        console.log('Reading DB at:', dbPath);

        if (!await fs.pathExists(dbPath)) {
            console.error('DB not found');
            app.quit();
            return;
        }

        const buffer = await fs.readFile(dbPath);
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        const db = new SQL.Database(buffer);

        const res = db.exec("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 5");
        if (res.length > 0) {
            console.log('Recent Jobs:');
            console.log(JSON.stringify(res[0].values, null, 2));
        } else {
            console.log('No jobs found.');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        app.quit();
    }
}

app.whenReady().then(checkJobs);
