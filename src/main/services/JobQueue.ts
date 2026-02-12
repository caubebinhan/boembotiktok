import { storageService } from './StorageService'
import { moduleManager } from './ModuleManager'
import { TikTokModule } from '../modules/tiktok/TikTokModule'
import { BrowserWindow } from 'electron'

class JobQueue {
    private intervalId: NodeJS.Timeout | null = null
    private isRunning = false
    private readonly POLL_INTERVAL = 5000
    private readonly MAX_CONCURRENT = 1

    start() {
        if (this.intervalId) return
        console.log('JobQueue started')
        this.intervalId = setInterval(() => this.processQueue(), this.POLL_INTERVAL)
    }

    stop() {
        if (this.intervalId) clearInterval(this.intervalId)
        this.isRunning = false
    }

    async processQueue() {
        if (this.isRunning) return
        this.isRunning = true

        try {
            // Check concurrency (only for DOWNLOADs usually, but let's limit global for now to be safe)
            const active = storageService.get("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").count
            if (active >= this.MAX_CONCURRENT) return

            // Get next pending job
            // Priority: DOWNLOAD > SCAN (Finish what we found before finding more?)
            // Or SCAN > DOWNLOAD? Let's do FIFO for now.
            const job = storageService.get(`
                SELECT * FROM jobs 
                WHERE status = 'pending' 
                ORDER BY created_at ASC 
                LIMIT 1
            `)

            if (job) {
                console.log(`JobQueue: Processing ${job.type} job #${job.id}`)
                await this.executeJob(job)
            }

        } catch (error) {
            console.error('JobQueue error:', error)
        } finally {
            this.isRunning = false
        }
    }

    async executeJob(job: any) {
        // Mark running
        storageService.run("UPDATE jobs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id])
        this.broadcastUpdate()

        try {
            const data = JSON.parse(job.data_json || '{}')
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule

            if (job.type === 'SCAN') {
                if (!tiktok) throw new Error('TikTok module missing')
                await this.handleScan(job, data, tiktok)
            } else if (job.type === 'DOWNLOAD') {
                if (!tiktok) throw new Error('TikTok module missing')
                await this.handleDownload(job, data, tiktok)
            }

            // Mark completed
            storageService.run("UPDATE jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id])
            console.log(`Job #${job.id} completed`)

        } catch (error: any) {
            console.error(`Job #${job.id} failed:`, error)
            storageService.run("UPDATE jobs SET status = 'failed', error_message = ? WHERE id = ?", [error.message, job.id])
        } finally {
            this.broadcastUpdate()
        }
    }

    private async handleScan(job: any, data: any, tiktok: TikTokModule) {
        // data matches the campaign config structure:
        // { source: { type: 'channel'|'keyword', value: '...' }, ... }

        const source = data.source
        if (!source || !source.value) {
            console.error('JobQueue: No source defined for scan job', job.id)
            return
        }

        console.log(`Scanning target: ${source.value} (${source.type})`)
        let foundCount = 0

        try {
            // We need to implement a true "scan and return items" in TikTokModule.
            // For now, we will use the existing scanProfile but we need to ensure it returns items.
            // If scanProfile writes to DB, we can just query the DB for the new items?
            // Or we modify scanProfile. 

            // ASSUMPTION: TikTokModule.scanProfile returns an array of { id, url, platform_id, ... }
            // If not, we need to fix TikTokModule.
            const newVideos = await tiktok.scanProfile(source.value) || []

            for (const v of newVideos) {
                // Check if already downloaded/exists? 
                // scanProfile might already check existence.

                // Create DOWNLOAD job
                storageService.run(
                    `INSERT INTO jobs (campaign_id, type, status, data_json) VALUES (?, 'DOWNLOAD', 'pending', ?)`,
                    [job.campaign_id, JSON.stringify({
                        url: v.url,
                        platform_id: v.platform_id,
                        video_id: v.id,
                        target_account: data.target // Pass the publishing target
                    })]
                )
                foundCount++
            }

            // Update job result
            storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify({ found: foundCount }), job.id])

        } catch (err: any) {
            console.error('Scan failed:', err)
            throw err
        }
    }

    private async handleDownload(job: any, data: any, tiktok: TikTokModule) {
        // 1. Download video
        const filePath = await tiktok.downloadVideo(data.url, data.platform_id)
        let finalPath = filePath

        // 2. Check campaign for edit pipeline
        const campaign = storageService.get('SELECT * FROM campaigns WHERE id = ?', [job.campaign_id])
        if (campaign && campaign.config_json) {
            const config = JSON.parse(campaign.config_json)

            // Use VideoEditEngine if pipeline has effects
            if (config.editPipeline && config.editPipeline.effects && config.editPipeline.effects.length > 0) {
                const { videoEditEngine } = require('./video-edit/VideoEditEngine')

                console.log(`[JobQueue] Running edit pipeline (${config.editPipeline.effects.length} effects) on ${data.video_id}`)
                const processedPath = filePath.replace('.mp4', '_edited.mp4')

                await videoEditEngine.render(filePath, config.editPipeline, processedPath)
                finalPath = processedPath
            }
        }

        // 3. Update video record
        storageService.run("UPDATE videos SET local_path = ?, status = 'downloaded' WHERE id = ?", [finalPath, data.video_id])
    }

    private broadcastUpdate() {
        try {
            const jobs = storageService.getAll("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50")
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('jobs-updated', jobs))
        } catch (e) { /* ignore */ }
    }
}

export const jobQueue = new JobQueue()
