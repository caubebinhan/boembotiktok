import initSqlJs, { Database } from 'sql.js'
import fs from 'fs-extra'
import path from 'path'
import { app } from 'electron'

class StorageService {
    private db: Database | null = null
    private dbPath: string = ''

    constructor() {
        // We defer dbPath initialization to init() because app.getPath might fail before app is ready
    }

    async init(): Promise<void> {
        this.dbPath = path.join(app.getPath('userData'), 'boembo.sqlite')
        console.log('Database path:', this.dbPath)

        try {
            const SQL = await initSqlJs({
                // In Electron/Node, we don't strictly need locateFile if the wasm is resolvable,
                // but we might need to adjust this if the build moves things around.
                // For now, let's rely on default resolution or revisit.
            })

            // Ensure directory exists
            await fs.ensureDir(path.dirname(this.dbPath))

            if (await fs.pathExists(this.dbPath)) {
                const buffer = await fs.readFile(this.dbPath)
                this.db = new SQL.Database(buffer)
                console.log('Loaded existing database')
            } else {
                this.db = new SQL.Database()
                console.log('Created new database')
                await this.save()
            }

            await this.runMigrations()
        } catch (error) {
            console.error('Failed to initialize database:', error)
            throw error
        }
    }

    private async runMigrations() {
        if (!this.db) return

        // Schema definition
        const schema = `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        source_account_id INTEGER,
        target_account_id INTEGER,
        status TEXT DEFAULT 'active',
        schedule_cron TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER,
        video_id INTEGER,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        error_message TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
      );
      
      CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        platform_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        description TEXT,
        duration INTEGER,
        local_path TEXT,
        processed_path TEXT,
        status TEXT DEFAULT 'discovered',
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(platform, platform_id)
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        session_valid BOOLEAN DEFAULT 0,
        proxy_url TEXT,
        last_checked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        action TEXT NOT NULL,
        max_requests INTEGER NOT NULL,
        window_seconds INTEGER NOT NULL,
        current_count INTEGER DEFAULT 0,
        window_start DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        keyword TEXT NOT NULL,
        filter_criteria TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(platform, keyword)
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending', -- pending, downloading, completed, failed
        progress INTEGER DEFAULT 0,
        file_path TEXT,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(video_id) REFERENCES videos(id)
      );

      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL, -- channel, keyword
        source_id INTEGER NOT NULL,
        last_scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        videos_found INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS publish_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL DEFAULT 'tiktok',
        username TEXT,
        display_name TEXT,
        avatar_url TEXT,
        cookies_json TEXT,
        proxy_url TEXT,
        auto_caption TEXT,
        auto_tags TEXT,
        settings_json TEXT,
        session_valid BOOLEAN DEFAULT 1,
        last_login_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `

        try {
            this.db.run(schema)

            // Migration for filter_criteria (Phase 4/5)
            try {
                this.db.run("ALTER TABLE accounts ADD COLUMN filter_criteria TEXT")
            } catch (e) { /* ignore */ }

            // Migration for Campaign Refactor (Phase 5)
            try {
                // Check if config_json exists, if not add it
                this.db.run("ALTER TABLE campaigns ADD COLUMN config_json TEXT")
                this.db.run("ALTER TABLE campaigns ADD COLUMN type TEXT")
                // We might already have 'type' or 'platform', let's ensure we have what we need
            } catch (e) { /* ignore */ }

            // Individual column migrations to prevent one failure blocking others
            try { this.db.run("ALTER TABLE jobs ADD COLUMN data_json TEXT") } catch (e) { /* ignore */ }
            try { this.db.run("ALTER TABLE jobs ADD COLUMN result_json TEXT") } catch (e) { /* ignore */ }
            try { this.db.run("ALTER TABLE jobs ADD COLUMN scheduled_for DATETIME") } catch (e) { /* ignore */ }
            try { this.db.run("ALTER TABLE accounts ADD COLUMN metadata TEXT") } catch (e) { /* ignore */ }
            try { this.db.run("ALTER TABLE jobs ADD COLUMN metadata TEXT") } catch (e) { /* ignore */ }

            await this.save()
            console.log('Migrations executed')
        } catch (err) {
            console.error('Migration failed:', err)
        }
    }

    private maskParams(sql: string, params: any[]): any[] {
        // Mask sensitive data in logs
        if (sql.toLowerCase().includes('cookies_json') || sql.toLowerCase().includes('proxy_url')) {
            return params.map(p => (typeof p === 'string' && p.length > 50) ? `[MASKED:${p.length} chars]` : p);
        }
        return params;
    }

    public run(sql: string, params: any[] = []): { changes: number, lastInsertId: number } {
        if (!this.db) throw new Error('DB not initialized')

        const masked = this.maskParams(sql, params);
        console.log(`[StorageService] [RUN] SQL: ${sql.replace(/\s+/g, ' ')} | Params:`, JSON.stringify(masked));

        this.db.run(sql, params)
        this.save().catch(e => console.error('[StorageService] Auto-save failed:', e))

        const changes = this.db.getRowsModified()
        let lastInsertId = 0
        if (changes > 0) {
            try {
                const res = this.db.exec('SELECT last_insert_rowid()')[0]
                if (res && res.values && res.values[0]) {
                    lastInsertId = res.values[0][0] as number
                }
            } catch (e) { /* ignore */ }
        }

        console.log(`[StorageService] [RUN] Result: Changes=${changes}, LastInsertId=${lastInsertId}`);
        return { changes, lastInsertId }
    }

    public get(sql: string, params: any[] = []): any {
        if (!this.db) throw new Error('DB not initialized')

        const masked = this.maskParams(sql, params);
        console.log(`[StorageService] [GET] SQL: ${sql.replace(/\s+/g, ' ')} | Params:`, JSON.stringify(masked));

        const stmt = this.db.prepare(sql)
        stmt.bind(params)
        const res = stmt.step() ? stmt.getAsObject() : null
        stmt.free()

        console.log(`[StorageService] [GET] Result: ${res ? 'Found (Object)' : 'NotFound'}`);
        return res
    }

    public all(sql: string, params: any[] = []): any[] {
        if (!this.db) throw new Error('DB not initialized')

        const masked = this.maskParams(sql, params);
        console.log(`[StorageService] [ALL] SQL: ${sql.replace(/\s+/g, ' ')} | Params:`, JSON.stringify(masked));

        const stmt = this.db.prepare(sql)
        stmt.bind(params)
        const result: any[] = []
        while (stmt.step()) {
            result.push(stmt.getAsObject())
        }
        stmt.free()

        console.log(`[StorageService] [ALL] Result: ${result.length} rows found.`);
        return result
    }

    // Alias for compatibility
    public getAll(sql: string, params: any[] = []): any[] {
        return this.all(sql, params)
    }

    public async save() {
        if (!this.db || !this.dbPath) return
        const data = this.db.export()
        const buffer = Buffer.from(data)
        await fs.writeFile(this.dbPath, buffer)
    }
}

export const storageService = new StorageService()
