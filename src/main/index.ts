import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { storageService } from './services/StorageService'
import { browserService } from './services/BrowserService'
import { processingService } from './services/ProcessingService'
import { moduleManager } from './services/ModuleManager'
import { TikTokModule } from './modules/tiktok/TikTokModule'
import { schedulerService } from './services/SchedulerService'
import { jobQueue } from './services/JobQueue'
import { campaignService } from './services/CampaignService'
import { videoEditEngine } from './services/video-edit/VideoEditEngine'
import { publishAccountService } from './services/PublishAccountService'
import { selfTestService } from './services/SelfTestService'
import { logger } from './services/LoggerService'

function createWindow(): void {
    const isDev = !app.isPackaged
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            webviewTag: true
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
    // Set app user model id for windows
    app.setAppUserModelId('com.boembo')

    // ...

    try {
        await storageService.init()
        await logger.init() // Initialize Logger
        // Initialize browser service (headless by default for background tasks, user can toggle)
        await browserService.init(true)

        // Module Manager
        await moduleManager.loadModule(new TikTokModule())

        // IPC Handlers

        ipcMain.handle('scan-profile', async (_event: any, username: string) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.scanProfile(username)
            throw new Error('TikTok module not loaded')
        })

        ipcMain.handle('add-video', async (_event: any, url: string) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.addVideo(url)
            throw new Error('TikTok module not loaded')
        })

        ipcMain.handle('add-account', async (_event: any, username: string, filterCriteria?: string) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.addAccount(username, filterCriteria)
            throw new Error('TikTok module not loaded')
        })

        ipcMain.handle('add-keyword', async (_event: any, keyword: string, filterCriteria?: string) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.addKeyword(keyword, filterCriteria)
            throw new Error('TikTok module not loaded')
        })

        ipcMain.handle('check-videos', async (_event: any, ids: string[]) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.checkVideosExistence(ids)
            return []
        })

        ipcMain.handle('get-collection', async (_event: any) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.getCollection()
            return []
        })

        ipcMain.handle('get-sources', async (_event: any) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.getSources()
            return { channels: [], keywords: [] }
        })

        ipcMain.handle('remove-source', async (_event: any, type: string, id: number) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.removeSource(type as 'channel' | 'keyword', id)
        })

        ipcMain.handle('remove-video', async (_event: any, id: number) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.removeVideo(id)
        })

        ipcMain.handle('remove-all-videos', async (_event: any) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.removeAllVideos()
        })

        ipcMain.handle('tiktok:refresh-stats', async (_event: any, videoId: string, username: string) => {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (tiktok) return tiktok.refreshVideoStats(videoId, username)
            return null
        })

        // Campaigns & Jobs IPC
        ipcMain.handle('create-campaign', async (_event: any, name: string, type: string, cron: string, config: any) => {
            return campaignService.create(name, type, cron, config)
        })

        ipcMain.handle('trigger-campaign', async (_event: any, id: number, ignoreSchedule?: boolean) => {
            return schedulerService.triggerCampaign(id, ignoreSchedule)
        })

        ipcMain.handle('get-campaigns', async () => {
            return campaignService.getAll()
        })

        ipcMain.handle('delete-campaign', async (_event: any, id: number) => {
            return campaignService.delete(id)
        })

        ipcMain.handle('update-campaign-config', async (_event: any, id: number, config: any) => {
            return campaignService.updateConfig(id, config)
        })

        ipcMain.handle('clone-campaign', async (_event: any, id: number) => {
            return campaignService.clone(id)
        })

        ipcMain.handle('get-campaign-stats', async (_event: any, id: number) => {
            return campaignService.getCampaignStats(id)
        })

        ipcMain.handle('get-scheduled-jobs', async (_event: any, start: string, end: string) => {
            return campaignService.getScheduledJobs(start, end)
        })

        ipcMain.handle('get-campaign-jobs', async (_event: any, id: number) => {
            return campaignService.getCampaignJobs(id)
        })

        // Crash Recovery IPC
        ipcMain.handle('job:get-missed', () => {
            return jobQueue.getMissedJobs()
        })

        ipcMain.handle('job:resume-recovery', (_event, rescheduleIds: number[]) => {
            jobQueue.resumeFromRecovery(rescheduleIds)
            return true
        })

        ipcMain.handle('job:update-data', (_event, jobId: number, data: any) => {
            // We need a public method in JobQueue or access storage directly?
            // JobQueue has updateJobData but it's private.
            // Let's just update DB directly here for simplicity, or expose a method.
            // Actually, best to update DB and then notify JobQueue if needed.
            // But JobQueue reads from DB when processing.
            // Converting to use a direct DB update for data_json.
            const job = storageService.get('SELECT data_json FROM jobs WHERE id = ?', [jobId])
            if (job) {
                const currentData = JSON.parse(job.data_json || '{}')
                const newData = { ...currentData, ...data }
                storageService.run("UPDATE jobs SET data_json = ? WHERE id = ?", [JSON.stringify(newData), jobId])
                return true
            }
            return false
        })

        ipcMain.handle('get-campaign-details', async (_event: any, id: number) => {
            return campaignService.getCampaign(id)
        })

        ipcMain.handle('open-campaign-details', async (_event, id) => {
            const win = new BrowserWindow({
                width: 1200,
                height: 800,
                show: false,
                autoHideMenuBar: true,
                webPreferences: {
                    preload: join(__dirname, '../preload/index.js'),
                    sandbox: false
                }
            })
            win.maximize()

            if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
                win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/index.html?mode=campaign-details&id=${id}`)
            } else {
                win.loadFile(join(__dirname, '../renderer/index.html'), { search: `?mode=campaign-details&id=${id}` })
            }

            win.once('ready-to-show', () => {
                win.show()
            })

            // When closed, notify main window to refresh stats
            win.on('closed', () => {
                const allWindows = BrowserWindow.getAllWindows()
                for (const w of allWindows) {
                    w.webContents.send('campaign-updated')
                }
            })
        })

        ipcMain.handle('open-path', async (_event, path) => {
            await shell.openPath(path)
        })

        // ─── Video Edit Engine IPC ─────────────────────────────────
        ipcMain.handle('edit:get-effects', async () => {
            return videoEditEngine.getEffects()
        })

        ipcMain.handle('edit:get-providers', async () => {
            return videoEditEngine.getProviders()
        })

        ipcMain.handle('edit:render', async (_event: any, videoPath: string, pipeline: any, outputPath: string) => {
            return videoEditEngine.render(videoPath, pipeline, outputPath)
        })

        ipcMain.handle('edit:preview-frame', async (_event: any, videoPath: string, pipeline: any, timestamp: number) => {
            const buffer = await videoEditEngine.getPreviewFrame(videoPath, pipeline, timestamp)
            return buffer.toString('base64')
        })

        ipcMain.handle('edit:validate', async (_event: any, pipeline: any) => {
            return videoEditEngine.validatePipeline(pipeline)
        })

        // ─── Settings IPC ──────────────────────────────────────────
        ipcMain.handle('get-settings', async () => {
            return storageService.getAll('SELECT key, value FROM settings')
        })

        ipcMain.handle('get-setting', async (_event: any, key: string) => {
            const row = storageService.get('SELECT value FROM settings WHERE key = ?', [key])
            return row ? row.value : null
        })

        ipcMain.handle('save-setting', async (_event: any, key: string, value: string) => {
            storageService.run(
                'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))',
                [key, value]
            )
            return { success: true }
        })

        // ─── Stats IPC ─────────────────────────────────────────────
        ipcMain.handle('get-stats', async () => {
            const totalVideos = storageService.get('SELECT COUNT(*) as count FROM videos')?.count ?? 0
            const downloadedVideos = storageService.get("SELECT COUNT(*) as count FROM videos WHERE status = 'downloaded'")?.count ?? 0
            const totalCampaigns = storageService.get('SELECT COUNT(*) as count FROM campaigns')?.count ?? 0
            const activeCampaigns = storageService.get("SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'")?.count ?? 0
            const totalJobs = storageService.get('SELECT COUNT(*) as count FROM jobs')?.count ?? 0
            const completedJobs = storageService.get("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'")?.count ?? 0
            const failedJobs = storageService.get("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'")?.count ?? 0
            const pendingJobs = storageService.get("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'")?.count ?? 0
            const totalChannels = storageService.get('SELECT COUNT(*) as count FROM accounts')?.count ?? 0
            const totalKeywords = storageService.get('SELECT COUNT(*) as count FROM keywords')?.count ?? 0
            const recentJobs = storageService.getAll(`
                SELECT j.type, j.status, j.created_at, j.completed_at, c.name as campaign_name
                FROM jobs j LEFT JOIN campaigns c ON j.campaign_id = c.id
                ORDER BY j.created_at DESC LIMIT 10
            `)
            return {
                totalVideos, downloadedVideos,
                totalCampaigns, activeCampaigns,
                totalJobs, completedJobs, failedJobs, pendingJobs,
                totalChannels, totalKeywords,
                recentJobs
            }
        })

        // ─── File Dialog IPC ───────────────────────────────────────
        ipcMain.handle('dialog:open-file', async (_event: any, options?: { filters?: { name: string; extensions: string[] }[], title?: string }) => {
            const result = await dialog.showOpenDialog({
                title: options?.title || 'Select File',
                properties: ['openFile'],
                filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
            })
            if (result.canceled || result.filePaths.length === 0) return null
            return result.filePaths[0]
        })

        ipcMain.handle('get-jobs', async () => {
            return storageService.getAll(`
                SELECT j.*, c.name as campaign_name 
                FROM jobs j
                LEFT JOIN campaigns c ON j.campaign_id = c.id
                ORDER BY j.created_at DESC
                LIMIT 50
            `)
        })

        ipcMain.handle('job:pause', async (_event: any, jobId: number) => {
            storageService.run(
                "UPDATE jobs SET status = 'paused' WHERE id = ? AND status = 'pending'",
                [jobId]
            )
            return { success: true }
        })

        ipcMain.handle('job:resume', async (_event: any, jobId: number) => {
            storageService.run(
                "UPDATE jobs SET status = 'pending' WHERE id = ? AND status = 'paused'",
                [jobId]
            )
            return { success: true }
        })

        ipcMain.handle('job:retry', async (_event: any, jobId: number) => {
            storageService.run(
                "UPDATE jobs SET status = 'pending', error_message = NULL, started_at = NULL, completed_at = NULL, scheduled_for = datetime('now') WHERE id = ? AND status = 'failed'",
                [jobId]
            )
            return { success: true }
        })

        ipcMain.handle('job:retry-all', async (_event: any, campaignId: number) => {
            storageService.run(
                "UPDATE jobs SET status = 'pending', error_message = NULL, started_at = NULL, completed_at = NULL, scheduled_for = datetime('now') WHERE campaign_id = ? AND status = 'failed'",
                [campaignId]
            )
            return { success: true }
        })

        ipcMain.handle('job:check-status', async (_event: any, jobId: number) => {
            return jobQueue.manualStatusCheck(jobId)
        })

        ipcMain.handle('job:delete', async (_event: any, jobId: number) => {
            storageService.run(
                "DELETE FROM jobs WHERE id = ? AND status IN ('pending', 'paused', 'failed')",
                [jobId]
            )
            return { success: true }
        })

        ipcMain.handle('job:open-browser', async (_event: any, jobId: number) => {
            const job = storageService.get('SELECT * FROM jobs WHERE id = ?', [jobId])
            if (!job) throw new Error('Job not found')

            const data = JSON.parse(job.data_json || '{}')
            const username = data.account_name || data.targetAccount

            if (!username) throw new Error('No account associated with this job')

            const account = storageService.get('SELECT * FROM publish_accounts WHERE username = ?', [username])
            if (!account) throw new Error(`Account ${username} not found`)

            return publishAccountService.reLoginAccount(account.id)
        })

        ipcMain.handle('get-downloads', async () => {
            return storageService.getAll(`
                SELECT j.*, j.data_json as metadata, j.status
                FROM jobs j
                WHERE j.type = 'DOWNLOAD'
                ORDER BY j.created_at DESC
                LIMIT 50
            `)
        })

        // ─── Publish Account IPC ─────────────────────────────────
        ipcMain.handle('publish-account:add', async () => {
            return publishAccountService.addAccount()
        })

        ipcMain.handle('publish-account:list', async () => {
            return publishAccountService.listAccounts()
        })

        ipcMain.handle('publish-account:update', async (_event: any, id: number, settings: any) => {
            return publishAccountService.updateAccount(id, settings)
        })

        ipcMain.handle('publish-account:remove', async (_event: any, id: number) => {
            return publishAccountService.removeAccount(id)
        })

        ipcMain.handle('publish-account:relogin', async (_event: any, id: number) => {
            return publishAccountService.reLoginAccount(id)
        })

        // ─── Scanner Window IPC ──────────────────────────────────
        ipcMain.handle('open-scanner-window', async () => {
            const isDev = !app.isPackaged
            const scannerWindow = new BrowserWindow({
                width: 1280,
                height: 850,
                title: '🔍 Scanner Tool',
                autoHideMenuBar: true,
                webPreferences: {
                    preload: join(__dirname, '../preload/index.js'),
                    sandbox: false,
                    webviewTag: true
                }
            })

            if (isDev && process.env['ELECTRON_RENDERER_URL']) {
                scannerWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?mode=scan')
            } else {
                scannerWindow.loadFile(join(__dirname, '../renderer/index.html'), {
                    query: { mode: 'scan' }
                })
            }

            return { windowId: scannerWindow.id }
        })

        // Receive results from scanner window and forward to main window
        ipcMain.handle('scanner-save-results', async (_event, results: any) => {
            // Send to all renderer windows (the main window will pick it up)
            const allWindows = BrowserWindow.getAllWindows()
            for (const win of allWindows) {
                win.webContents.send('scanner-results-received', results)
            }
            return { success: true }
        })

        // ─── Self Test IPC ───────────────────────────────────────
        ipcMain.handle('run-self-test', async () => {
            return selfTestService.runTest()
        })

        // ─── Test Helpers ────────────────────────────────────────
        ipcMain.handle('test:seed-account', async () => {
            const result = storageService.run(
                `INSERT OR IGNORE INTO publish_accounts (username, display_name, session_valid, created_at) 
                 VALUES ('test_user', 'Test User', 1, datetime('now'))`
            )
            return { success: result.changes > 0 }
        })

        ipcMain.handle('test:create-job', async (_event: any, type: string, data: any) => {
            const result = storageService.run(
                `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json, created_at) 
                 VALUES (0, ?, 'pending', datetime('now'), ?, datetime('now'))`,
                [type, JSON.stringify(data)]
            )
            return { id: result.lastInsertId }
        })

        ipcMain.handle('test:run-scheduler', async () => {
            await schedulerService.checkAndSchedule()
            return { success: true }
        })

        ipcMain.handle('test:update-cookies', async (_event: any, id: number, cookies: any[]) => {
            storageService.run(
                `UPDATE publish_accounts SET cookies_json = ? WHERE id = ?`,
                [JSON.stringify(cookies), id]
            )
            return { success: true }
        })

        // Start background services
        schedulerService.start()
        jobQueue.start()

    } catch (err) {
        console.error('Failed to init services:', err)
    }

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
