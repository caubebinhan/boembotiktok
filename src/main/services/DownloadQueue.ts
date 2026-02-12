import { storageService } from './StorageService'
import { moduleManager } from './ModuleManager'
import { TikTokModule } from '../modules/tiktok/TikTokModule'
import path from 'path'
import { app, BrowserWindow } from 'electron'

class DownloadQueue {
    private intervalId: NodeJS.Timeout | null = null
    private isRunning = false
    private readonly POLL_INTERVAL = 5000 // 5 seconds
    private readonly MAX_CONCURRENT = 1

    start() {
        if (this.intervalId) return
        console.log('DownloadQueue started')
        this.intervalId = setInterval(() => this.processQueue(), this.POLL_INTERVAL)
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
        this.isRunning = false
    }

    async processQueue() {
        if (this.isRunning) return
        this.isRunning = true

        try {
            // Check active downloads
            const active = storageService.get('SELECT COUNT(*) as count FROM downloads WHERE status = ?', ['downloading']).count
            if (active >= this.MAX_CONCURRENT) return

            // Get next pending
            const next = storageService.get(`
                SELECT d.*, v.url, v.platform_id 
                FROM downloads d
                JOIN videos v ON d.video_id = v.id
                WHERE d.status = 'pending'
                ORDER BY d.created_at ASC
                LIMIT 1
            `)

            if (next) {
                console.log(`Processing download: ${next.platform_id}`)
                await this.performDownload(next)
            }

        } catch (error) {
            console.error('Error in download queue:', error)
        } finally {
            this.isRunning = false
        }
    }

    async performDownload(item: any) {
        // Mark as downloading
        storageService.run('UPDATE downloads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['downloading', item.id])
        this.broadcastUpdate()

        try {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (!tiktok) throw new Error('TikTok module not available')

            // Download
            const filePath = await tiktok.downloadVideo(item.url, item.platform_id)

            // Mark completed
            storageService.run(
                'UPDATE downloads SET status = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['completed', filePath, item.id]
            )
            console.log(`Download completed: ${item.platform_id}`)

            this.broadcastUpdate()
            this.broadcastComplete(item)

        } catch (error: any) {
            console.error(`Download failed for ${item.platform_id}:`, error)
            storageService.run(
                'UPDATE downloads SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['failed', error.message || 'Unknown error', item.id]
            )
            this.broadcastUpdate()
        }
    }

    private broadcastUpdate() {
        // Fetch latest list and send to all windows
        const downloads = storageService.getAll(`
            SELECT d.*, v.title, v.platform_id, v.metadata
            FROM downloads d
            JOIN videos v ON d.video_id = v.id
            ORDER BY d.created_at DESC
            LIMIT 50
        `)
        BrowserWindow.getAllWindows().forEach(win => win.webContents.send('download-updated', downloads))
    }

    private broadcastComplete(item: any) {
        BrowserWindow.getAllWindows().forEach(win => win.webContents.send('download-complete', item))
    }
}

export const downloadQueue = new DownloadQueue()
