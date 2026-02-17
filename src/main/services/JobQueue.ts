import { storageService } from './StorageService'
import { moduleManager } from './ModuleManager'
import { TikTokModule } from '../modules/tiktok/TikTokModule'
import { BrowserWindow } from 'electron'
import { publishAccountService } from './PublishAccountService'
import { campaignService } from './CampaignService'
import { notificationService } from './NotificationService'

class JobQueue {
    private intervalId: NodeJS.Timeout | null = null
    private isRunning = false
    private readonly POLL_INTERVAL = 5000
    async start() {
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
            // Default to 100 as requested by user
            const maxConcurrentStr = storageService.get("SELECT value FROM settings WHERE key = 'app.maxConcurrentJobs'")?.value
            const maxConcurrent = parseInt(maxConcurrentStr || '100')

            const active = storageService.get("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").count
            if (active >= maxConcurrent) return

            // Get next pending job that is scheduled for now or earlier
            // Prioritize by scheduled time (urgency) then creation (FIFO)
            const job = storageService.get(`
                SELECT * FROM jobs 
                WHERE status = 'pending' 
                AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
                ORDER BY scheduled_for ASC, created_at ASC 
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
            } else if (job.type === 'PUBLISH') {
                await this.handlePublish(job, data, tiktok)
            }

            // Mark completed
            storageService.run("UPDATE jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id])
            console.log(`Job #${job.id} completed`)

        } catch (error: any) {
            console.error(`Job #${job.id} failed:`, error)

            // Extract path if present in error message (for "file too small" or similar)
            let resultUpdate = ''
            const pathMatch = error.message.match(/Path: (.+)$/)
            if (pathMatch && pathMatch[1]) {
                const failPath = pathMatch[1].trim()
                try {
                    // Save path so user can inspect corrupt file
                    storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [
                        JSON.stringify({ video_path: failPath, folder_path: require('path').dirname(failPath), error: error.message }),
                        job.id
                    ])
                } catch (e) { }
            }

            storageService.run("UPDATE jobs SET status = ?, error_message = ? WHERE id = ?", [`Failed: ${error.message.substring(0, 50)}`, error.message, job.id])

            try {
                const campaign = storageService.get('SELECT name FROM campaigns WHERE id = ?', [job.campaign_id])
                notificationService.notifyJobFailed(campaign ? campaign.name : 'Unknown', error.message)
            } catch (e) { /* ignore */ }
        } finally {
            // Check if Campaign is Completed (regardless of success/failure)
            this.checkCampaignCompletion(job.campaign_id)
            this.broadcastUpdate()
        }
    }

    private async handleScan(job: any, data: any, tiktok: TikTokModule) {
        // 1. Get scheduling params from job data (set by triggerCampaign)
        const intervalMinutes = data.intervalMinutes || 15
        let scheduleTime = data.nextScheduleTime ? new Date(data.nextScheduleTime) : new Date()
        const targetAccounts = data.targetAccounts || []

        // 2. Scan ALL sources and collect videos
        let allVideos: any[] = []
        let scannedCount = 0

        if (data.sources) {
            // 2a. Scan Channels
            if (data.sources.channels) {
                for (const ch of data.sources.channels) {
                    console.log(`Scanning channel: ${ch.name}`)
                    this.updateJobData(job.id, { ...data, status: `Scanning channel @${ch.name}...`, scannedCount })
                    const result = await tiktok.scanProfile(ch.name) || { videos: [] }
                    const newVideos = result.videos || []

                    // Apply source-level sorting before adding (per-source sort order)
                    const sortOrder = ch.sortOrder || data.postOrder || 'newest'
                    newVideos.sort((a: any, b: any) => {
                        if (sortOrder === 'oldest') return (a.id || '').localeCompare(b.id || '')
                        if (sortOrder === 'most_likes') return (b.stats?.likes || 0) - (a.stats?.likes || 0)
                        return (b.id || '').localeCompare(a.id || '') // newest (default)
                    })

                    // Apply max scan limit
                    const limited = ch.maxScanCount ? newVideos.slice(0, ch.maxScanCount) : newVideos

                    allVideos.push(...limited)
                    scannedCount += limited.length
                    this.updateJobData(job.id, { ...data, status: `Scanned @${ch.name}: found ${limited.length} videos`, scannedCount })
                }
            }

            // 2b. Scan Keywords
            if (data.sources.keywords) {
                for (const kw of data.sources.keywords) {
                    console.log(`Scanning keyword: ${kw.name}`)
                    this.updateJobData(job.id, { ...data, status: `Scanning keyword "${kw.name}"...`, scannedCount })
                    const result = await tiktok.scanKeyword(kw.name, kw.maxScanCount || 50) || { videos: [] }
                    const newVideos = result.videos || []
                    allVideos.push(...newVideos)
                    scannedCount += newVideos.length
                    this.updateJobData(job.id, { ...data, status: `Scanned keyword "${kw.name}": found ${newVideos.length} videos`, scannedCount })
                }
            }
        }

        // 3. Deduplicate
        const uniqueVideos = Array.from(new Map(allVideos.map(v => [v.id, v])).values())

        // 4. Global sort by Post Order
        const postOrder = data.postOrder || 'newest'
        const postOrderLabel = postOrder === 'most_likes' ? 'most likes first' : postOrder === 'oldest' ? 'oldest first' : 'newest first'
        this.updateJobData(job.id, { ...data, status: `Sorting ${uniqueVideos.length} scanned videos (${postOrderLabel})...`, scannedCount })

        uniqueVideos.sort((a: any, b: any) => {
            const aLikes = (a.stats?.likes || 0)
            const bLikes = (b.stats?.likes || 0)
            if (postOrder === 'most_likes') return bLikes - aLikes
            if (postOrder === 'least_likes') return aLikes - bLikes
            if (postOrder === 'oldest') return a.id.localeCompare(b.id)
            return b.id.localeCompare(a.id) // newest (default)
        })

        console.log(`JobQueue: Found ${uniqueVideos.length} unique scanned videos. Scheduling downloads starting at ${scheduleTime.toISOString()}`)
        this.updateJobData(job.id, { ...data, status: `Scheduling ${uniqueVideos.length} download jobs...`, scannedCount })

        // 5. Create Scheduled DOWNLOAD Jobs (continuing from after single videos)
        let scheduledCount = 0

        for (let i = 0; i < uniqueVideos.length; i++) {
            const v = uniqueVideos[i]

            // Check if already processed
            const exists = storageService.get("SELECT id FROM videos WHERE platform_id = ? AND status IN ('downloaded', 'published')", [v.id])
            if (exists) {
                console.log(`Skipping already processed video ${v.id}`)
                continue
            }

            storageService.run(
                `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'DOWNLOAD', 'pending', ?, ?)`,
                [
                    job.campaign_id,
                    scheduleTime.toISOString().replace('T', ' ').slice(0, 19),
                    JSON.stringify({
                        url: v.url,
                        platform_id: v.platform_id || v.id,
                        video_id: v.id,
                        targetAccounts,
                        description: v.desc || v.description,
                        thumbnail: v.thumbnail || v.cover || '',
                        videoStats: v.stats || { views: 0, likes: 0 },
                        editPipeline: data.editPipeline,
                        status: `Queued: Download`
                    })
                ]
            )
            scheduledCount++
            scheduleTime = new Date(scheduleTime.getTime() + intervalMinutes * 60000)
        }

        // Update Job Result
        const result = { found: uniqueVideos.length, scheduled: scheduledCount, skipped: uniqueVideos.length - scheduledCount }
        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify(result), job.id])
        this.updateJobData(job.id, { ...data, status: `Scan complete: Found ${scheduledCount} new videos today`, scannedCount })
    }

    private async handleDownload(job: any, data: any, tiktok: TikTokModule) {
        this.updateJobData(job.id, { ...data, status: 'Downloading video...' })

        // 1. Download video
        const { filePath, cached } = await tiktok.downloadVideo(data.url, data.platform_id)

        if (cached) {
            this.updateJobData(job.id, { ...data, status: 'Video already cached. Skipping download.' })
            // Small delay to let user see message
            await new Promise(r => setTimeout(r, 1000))
        }

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

        // 4. Create PUBLISH job with video info
        if (data.targetAccounts && data.targetAccounts.length > 0) {
            this.updateJobData(job.id, { ...data, status: 'Scheduling publication...' })
            for (const accId of data.targetAccounts) {
                // Get account info for display
                const acc = storageService.get('SELECT username, display_name FROM publish_accounts WHERE id = ?', [accId])
                storageService.run(
                    `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'PUBLISH', 'pending', datetime('now'), ?)`,
                    [
                        job.campaign_id,
                        JSON.stringify({
                            video_path: finalPath,
                            platform_id: data.platform_id,
                            account_id: accId,
                            account_name: acc?.display_name || acc?.username || 'Unknown',
                            account_username: acc?.username || '',
                            caption: data.description || '',
                            thumbnail: data.thumbnail || '',
                            videoStats: data.videoStats || {},
                            status: 'Queued: Publish'
                        })
                    ]
                )
            }
        }

        // Store result path for "Open Folder" feature
        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify({ video_path: finalPath, folder_path: require('path').dirname(finalPath) }), job.id])
    }

    private async handlePublish(job: any, data: any, tiktok: TikTokModule) {
        const { video_path, account_id, caption, account_name } = data

        this.updateJobData(job.id, { ...data, status: `Publishing to @${account_name || 'account'}...` })

        // 1. Load account cookies
        const cookies = publishAccountService.getAccountCookies(Number(account_id))
        if (!cookies || cookies.length === 0) {
            throw new Error(`No valid cookies for account ${account_id}. Please re-login.`)
        }

        // 2. Verify video file exists
        const fs = require('fs')
        if (!fs.existsSync(video_path)) {
            throw new Error(`Video file not found: ${video_path}`)
        }

        // 3. Publish using TikTok module with Progress Callback
        this.updateJobData(job.id, { ...data, status: `Initializing upload...` })

        const result = await tiktok.publishVideo(
            video_path,
            caption || '',
            cookies,
            (msg) => {
                this.updateJobData(job.id, { ...data, status: msg })
            },
            { advancedVerification: data.advancedVerification }
        )

        if (!result.success) {
            throw new Error(result.error || 'Upload failed (unknown error)')
        }

        if (result.isReviewing && result.videoId) {
            // Update video status to 'reviewing'
            if (data.platform_id) {
                storageService.run("UPDATE videos SET status = 'reviewing', platform_id = ? WHERE platform_id = ?", [result.videoId, data.platform_id])
            }

            // Start background polling (10 mins, every 30s)
            this.startBackgroundStatusCheck(result.videoId, job.id, data.account_username || account_name)

            this.updateJobData(job.id, { ...data, status: `In Review (Polling started)...` })
        } else {
            // Mark video as published in DB
            if (data.platform_id) {
                storageService.run("UPDATE videos SET status = 'published' WHERE platform_id = ?", [data.platform_id])
            }
            this.updateJobData(job.id, { ...data, status: `Published to @${account_name}` })
        }

        // Store result with video URL & ID
        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [
            JSON.stringify({
                account: account_name,
                video_path,
                video_url: result.videoUrl,
                video_id: result.videoId,
                published_at: new Date().toISOString(),
                is_reviewing: result.isReviewing
            }),
            job.id
        ])
    }

    private checkCampaignCompletion(campaignId: number) {
        try {
            // Check for any pending or running jobs for this campaign
            const pendingJobs = storageService.get(
                "SELECT COUNT(*) as count FROM jobs WHERE campaign_id = ? AND status IN ('pending', 'running')",
                [campaignId]
            ).count

            if (pendingJobs === 0) {
                const campaign = storageService.get('SELECT * FROM campaigns WHERE id = ?', [campaignId])
                if (campaign) {
                    const config = JSON.parse(campaign.config_json || '{}')

                    const hasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)
                    const isRecurring = !!config.schedule?.interval

                    console.log(`[CampaignCheck] ID: ${campaignId} Pending: ${pendingJobs} HasSources: ${hasSources} IsRecurring: ${isRecurring}`)

                    if (!hasSources || !isRecurring) {
                        storageService.run("UPDATE campaigns SET status = 'completed' WHERE id = ?", [campaignId])
                        console.log(`Campaign ${campaignId} completed (all jobs finished).`)

                        try {
                            const stats = campaignService.getCampaignStats(campaignId)
                            notificationService.notifyCampaignComplete(campaign.name, stats)
                        } catch (e) { /* ignore */ }
                    } else {
                        console.log(`Campaign ${campaignId} kept active (Recurring/Sources present)`)
                    }
                }
            } else {
                console.log(`[CampaignCheck] ID: ${campaignId} has ${pendingJobs} pending jobs.`)
            }
        } catch (e) {
            console.error('Error checking campaign completion:', e)
        }
    }

    private updateJobData(jobId: number, data: any) {
        try {
            storageService.run("UPDATE jobs SET data_json = ? WHERE id = ?", [JSON.stringify(data), jobId])
            this.broadcastUpdate()
        } catch (e) {
            console.error('Failed to update job data:', e)
        }
    }

    private startBackgroundStatusCheck(videoId: string, jobId: number, username: string) {
        console.log(`[JobQueue] Starting background check for video ${videoId} (@${username})`)
        let attempts = 0
        const MAX_ATTEMPTS = 20 // 10 mins / 30s = 20

        const poller = setInterval(async () => {
            attempts++
            try {
                // 1. Get TikTok module
                const tiktok = moduleManager.getModule('tiktok') as TikTokModule
                if (!tiktok) { clearInterval(poller); return }

                const status = await tiktok.checkVideoStatus(videoId, username)
                console.log(`[JobQueue] Polling ${videoId}: ${status}`)

                if (status === 'public') {
                    storageService.run("UPDATE videos SET status = 'published' WHERE platform_id = ?", [videoId])

                    // Update job status text (even if completed)
                    const job = storageService.get('SELECT data_json FROM jobs WHERE id = ?', [jobId])
                    if (job) {
                        const data = JSON.parse(job.data_json || '{}')
                        this.updateJobData(jobId, { ...data, status: `Published (Verified Public)` })

                        // Update Result JSON to define is_reviewing = false
                        const result = JSON.parse(job.result_json || '{}')
                        result.is_reviewing = false
                        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify(result), jobId])
                    }

                    clearInterval(poller)
                    return
                }

                // Update text to show alive
                const job = storageService.get('SELECT data_json FROM jobs WHERE id = ?', [jobId])
                if (job) {
                    const data = JSON.parse(job.data_json || '{}')
                    this.updateJobData(jobId, { ...data, status: `Reviewing... (Check ${attempts}/${MAX_ATTEMPTS})` })
                }

                if (attempts >= MAX_ATTEMPTS) {
                    clearInterval(poller)
                    console.log(`[JobQueue] Polling finished for ${videoId}. Video might still be in review.`)

                    // Final status update
                    const job = storageService.get('SELECT data_json FROM jobs WHERE id = ?', [jobId])
                    if (job) {
                        const data = JSON.parse(job.data_json || '{}')
                        this.updateJobData(jobId, { ...data, status: `Finished (Check later)` })
                    }
                    return
                }

            } catch (e) {
                console.error(`[JobQueue] Polling error for ${videoId}:`, e)
            }
        }, 30000) // 30s
    }


    async manualStatusCheck(jobId: number): Promise<string> {
        const job = storageService.get('SELECT * FROM jobs WHERE id = ?', [jobId])
        if (!job) return 'Job not found'

        const data = JSON.parse(job.data_json || '{}')
        const result = JSON.parse(job.result_json || '{}')

        if (!result.video_id || !data.account_username) {
            return 'Cannot check status: Missing video ID or username'
        }

        const tiktok = moduleManager.getModule('tiktok') as TikTokModule
        if (!tiktok) return 'TikTok module not ready'

        try {
            this.updateJobData(jobId, { ...data, status: `Checking status...` })
            const status = await tiktok.checkVideoStatus(result.video_id, data.account_username)
            console.log(`[JobQueue] Manual check ${result.video_id}: ${status}`)

            if (status === 'public') {
                storageService.run("UPDATE videos SET status = 'published' WHERE platform_id = ?", [result.video_id])
                this.updateJobData(jobId, { ...data, status: `Published (Verified Public)` })

                result.is_reviewing = false
                storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify(result), jobId])
                return 'Video is Public'
            } else if (status === 'private') {
                this.updateJobData(jobId, { ...data, status: `In Review / Private` })
                return 'Video is Private/Reviewing'
            } else {
                this.updateJobData(jobId, { ...data, status: `Status Unavailable` })
                return 'Status Unavailable'
            }
        } catch (e: any) {
            return `Check failed: ${e.message}`
        }
    }

    private broadcastUpdate() {
        try {
            const jobs = storageService.getAll("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50")
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('jobs-updated', jobs))

            // Broadcast campaigns too (for realtime stats)
            const campaigns = campaignService.getAll()
            BrowserWindow.getAllWindows().forEach(win => win.webContents.send('campaigns-updated', campaigns))
        } catch (e) { /* ignore */ }
    }
}

export const jobQueue = new JobQueue()
