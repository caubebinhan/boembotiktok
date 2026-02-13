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
            // Check concurrency for running jobs
            const active = storageService.get("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").count
            if (active >= this.MAX_CONCURRENT) return

            // Get next pending job that is scheduled for now or earlier
            const job = storageService.get(`
                SELECT * FROM jobs 
                WHERE status = 'pending' 
                AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
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

            // Initialize module if needed (e.g. browser context)
            if (!tiktok) throw new Error('TikTok module missing')

            if (job.type === 'SCAN') {
                await this.handleScan(job, data, tiktok)
            } else if (job.type === 'DOWNLOAD') {
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
        // 1. Get Campaign Config (for Interval)
        const campaign = storageService.get('SELECT * FROM campaigns WHERE id = ?', [job.campaign_id])
        let intervalMinutes = 60 // Default 1 hour
        if (campaign && campaign.config_json) {
            try {
                const cfg = JSON.parse(campaign.config_json)
                if (cfg.schedule && cfg.schedule.interval) {
                    intervalMinutes = parseInt(cfg.schedule.interval) || 60
                }
            } catch { }
        }

        // 2. Gather ALL videos (from Sources + Manual Selection)
        let allVideos: any[] = []
        let scannedCount = 0

        // 2a. Scan Sources (Channels/Keywords)
        if (data.sources) {
            if (data.sources.channels) {
                for (const ch of data.sources.channels) {
                    console.log(`Scanning channel: ${ch.name}`)
                    this.updateJobData(job.id, { ...data, status: `Scanning channel: ${ch.name}`, scannedCount })
                    const result = await tiktok.scanProfile(ch.name) || { videos: [] }
                    const newVideos = result.videos || []
                    allVideos.push(...newVideos)
                    scannedCount += newVideos.length
                    this.updateJobData(job.id, { ...data, status: `Scanned channel: ${ch.name}`, scannedCount })
                }
            }
            for (const kw of data.sources.keywords) {
                console.log(`Scanning keyword: ${kw.name}`)
                this.updateJobData(job.id, { ...data, status: `Scanning keyword: ${kw.name}`, scannedCount })
                const result = await tiktok.scanKeyword(kw.name, kw.maxScanCount || 50) || { videos: [] }
                const newVideos = result.videos || []
                allVideos.push(...newVideos)
                scannedCount += newVideos.length
                this.updateJobData(job.id, { ...data, status: `Scanned keyword: ${kw.name}`, scannedCount })
            }
        }

        // 2b. Add Manual Videos
        if (data.videos && Array.isArray(data.videos)) {
            allVideos.push(...data.videos)
            scannedCount += data.videos.length
        }

        // 3. Deduplicate
        const uniqueVideos = Array.from(new Map(allVideos.map(v => [v.id, v])).values())

        // 4. Sort by Post Order
        const postOrder = data.postOrder || 'newest'
        uniqueVideos.sort((a: any, b: any) => {
            // Stats sorting
            const aLikes = (a.stats?.likes || 0)
            const bLikes = (b.stats?.likes || 0)
            if (postOrder === 'most_likes') return bLikes - aLikes
            if (postOrder === 'least_likes') return aLikes - bLikes
            if (postOrder === 'oldest') return a.id.localeCompare(b.id)
            return b.id.localeCompare(a.id) // newest (default)
        })

        console.log(`JobQueue: Found ${uniqueVideos.length} unique videos. Scheduling...`)
        this.updateJobData(job.id, { ...data, status: `Found ${uniqueVideos.length} unique videos. Scheduling downloads...`, scannedCount })

        // 5. Create Scheduled DOWNLOAD Jobs
        let scheduleTime = new Date()

        for (let i = 0; i < uniqueVideos.length; i++) {
            const v = uniqueVideos[i]

            // Check if already processed
            const exists = storageService.get("SELECT id FROM videos WHERE platform_id = ? AND status = 'downloaded'", [v.id])
            if (exists) {
                console.log(`Skipping existing video ${v.id}`)
                continue
            }

            if (i > 0) {
                scheduleTime = new Date(scheduleTime.getTime() + intervalMinutes * 60000)
            }

            // Create DOWNLOAD job
            storageService.run(
                `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'DOWNLOAD', 'pending', ?, ?)`,
                [
                    job.campaign_id,
                    scheduleTime.toISOString().replace('T', ' ').slice(0, 19),
                    JSON.stringify({
                        url: v.url,
                        platform_id: v.platform_id || v.id,
                        video_id: v.id,
                        targetAccounts: data.targetAccounts,
                        description: v.desc || v.description // Pass description
                    })
                ]
            )
        }

        // Update Job Result
        const result = { found: uniqueVideos.length, scheduled: uniqueVideos.length }
        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify(result), job.id])
    }

    private async handleDownload(job: any, data: any, tiktok: TikTokModule) {
        this.updateJobData(job.id, { ...data, status: 'Downloading video...' })

        // 1. Download video
        const filePath = await tiktok.downloadVideo(data.url, data.platform_id)
        let finalPath = filePath

        // 2. Check campaign for edit pipeline
        const campaign = storageService.get('SELECT * FROM campaigns WHERE id = ?', [job.campaign_id])
        if (campaign && campaign.config_json) {
            const config = JSON.parse(campaign.config_json)

            // Use VideoEditEngine if pipeline has effects
            if (config.editPipeline && config.editPipeline.effects && config.editPipeline.effects.length > 0) {
                this.updateJobData(job.id, { ...data, status: 'Processing video (AI editing)...' })
                const { videoEditEngine } = require('./video-edit/VideoEditEngine')
                const processedPath = filePath.replace('.mp4', '_edited.mp4')
                await videoEditEngine.render(filePath, config.editPipeline, processedPath)
                finalPath = processedPath
            }
        }

        // 3. Update video record
        const video = storageService.get("SELECT id FROM videos WHERE platform_id = ?", [data.platform_id])
        if (video) {
            storageService.run("UPDATE videos SET local_path = ?, status = 'downloaded' WHERE id = ?", [finalPath, video.id])
        }

        // 4. Create PUBLISH job
        if (data.targetAccounts && data.targetAccounts.length > 0) {
            this.updateJobData(job.id, { ...data, status: 'Scheduling publication...' })
            for (const accId of data.targetAccounts) {
                storageService.run(
                    `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'PUBLISH', 'pending', datetime('now'), ?)`,
                    [
                        job.campaign_id,
                        JSON.stringify({
                            video_path: finalPath,
                            account_id: accId,
                            caption: data.description || ''
                        })
                    ]
                )
            }
        }

        // Store result path for "Open Folder" feature
        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify({ path: require('path').dirname(finalPath) }), job.id])
    }

    private updateJobData(jobId: number, data: any) {
        try {
            storageService.run("UPDATE jobs SET data_json = ? WHERE id = ?", [JSON.stringify(data), jobId])
        } catch (e) {
            console.error('Failed to update job data:', e)
        }
    }

    private broadcastUpdate() {
        try {
            const jobs = storageService.getAll("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50")
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('jobs-updated', jobs))
        } catch (e) { /* ignore */ }
    }
}

export const jobQueue = new JobQueue()
