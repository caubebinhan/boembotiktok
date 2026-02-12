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



function createWindow(): void {
    const isDev = !app.isPackaged
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 900,
        height: 670,
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

    try {
        await storageService.init()
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

        // Campaigns & Jobs IPC
        ipcMain.handle('create-campaign', async (_event: any, name: string, type: string, cron: string, config: any) => {
            return campaignService.create(name, type, cron, config)
        })

        ipcMain.handle('trigger-campaign', async (_event: any, id: number) => {
            // Manually trigger a campaign run
            // This would likely call SchedulerService to run the task immediately
            return schedulerService.triggerCampaign(id)
        })

        ipcMain.handle('get-campaigns', async () => {
            return campaignService.getAll()
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

        // Legacy Downloads IPC (mapped to jobs/downloads table if needed, or kept for backward compatibility if UI still uses it)
        ipcMain.handle('get-downloads', async () => {
            // Redirect to 'downloads' table if we still use it, or 'jobs'?
            // For now, let's keep serving 'downloads' table as TikTokModule still writes to it in 'scanProfile' (wait, I modified scanProfile to NOT write to downloads but return list)
            // So 'get-downloads' will return OLD data or empty if we don't insert anymore.
            // We configured JobQueue to insert into 'downloads' table for 'DOWNLOAD' jobs?
            // No, JobQueue updates 'videos' and 'jobs'.
            // So 'get-downloads' is now DEPRECATED/BROKEN unless we update it to query 'jobs' where type='DOWNLOAD'.

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
