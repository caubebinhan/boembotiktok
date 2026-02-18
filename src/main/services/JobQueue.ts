import { BrowserWindow, ipcMain, app } from 'electron'
import { storageService } from './StorageService'
import { moduleManager } from './ModuleManager'
import { TikTokModule } from '../modules/tiktok/TikTokModule'
import { publishAccountService } from './PublishAccountService'
import { campaignService } from './CampaignService'
import { notificationService } from './NotificationService'
import { CaptionGenerator } from './CaptionGenerator'

class JobQueue {
    private interval: NodeJS.Timeout | null = null
    private isRunning = false
    private isPaused = false
    private readonly POLL_INTERVAL = 5000

    constructor() {
        this.registerDebugHandlers()
    }

    private registerDebugHandlers() {
        ipcMain.handle('debug:test-caption-flow', async () => {
            return this.runFullFlowSelfTest()
        })
    }

    private async runFullFlowSelfTest() {
        const log = (msg: string) => console.log(`[SELF-TEST] ${msg}`)
        log('Starting Full Flow Self-Test...')

        try {
            const original = 'Tết này vui quá #vtv24 #xuhuong2026 #bò'
            log(`Original: "${original}"`)

            // 1. Test Tag Stripping
            const { CaptionGenerator } = require('./CaptionGenerator')
            const template = '{original_no_tags} #repost'
            const result = CaptionGenerator.generate(template, { original })
            log(`Template: "${template}"`)
            log(`Result: "${result}"`)

            if (result.includes('#vtv24') || result.includes('#bò')) {
                throw new Error('Hashtag removal FAILED (matched Vietnamese/Unicode tags check)')
            }
            log('✅ Hashtag removal logic passed.')

            // 2. Test Unique Tag
            const useUniqueTag = true
            const uniqueTag = '#' + Math.random().toString(36).substring(2, 8)
            const final = result + ' ' + uniqueTag
            log(`Final with Unique Tag: "${final}"`)

            log('✅ All logic checks passed.')
            return { success: true, log: 'Logic verified. Check console for details.' }
        } catch (e: any) {
            log(`❌ TEST FAILED: ${e.message}`)
            return { success: false, error: e.message }
        }
    }

    async start() {
        if (this.interval) return
        console.log('[JobQueue] Starting...')

        // 0. Reset stuck 'running' jobs to 'pending' (crash recovery)
        try {
            const resetResult = storageService.run("UPDATE jobs SET status = 'pending' WHERE status = 'running'")
            if (resetResult.changes > 0) {
                console.log(`[JobQueue] Reset ${resetResult.changes} stuck 'running' jobs to 'pending'`)
            }
        } catch (e) {
            console.error('[JobQueue] Failed to reset stuck jobs:', e)
        }

        // 1. Check for missed scheduled jobs (pending and in the past)
        try {
            console.log('[JobQueue] Checking for missed scheduled jobs...')
            const nowIso = new Date().toISOString()
            const missedJobs = storageService.getAll(`
                SELECT j.id, j.scheduled_for, j.campaign_id, c.config_json 
                FROM jobs j
                JOIN campaigns c ON j.campaign_id = c.id
                WHERE j.status = 'pending' 
                AND (j.scheduled_for IS NULL OR j.scheduled_for <= ?)
                ORDER BY j.scheduled_for ASC
            `, [nowIso])

            console.log(`[JobQueue] Missed Jobs Check: Found ${missedJobs.length} jobs`)

            if (missedJobs.length > 0) {
                // Group by Campaign
                const campaignGroups: Record<number, any[]> = {}
                missedJobs.forEach(job => {
                    if (!campaignGroups[job.campaign_id]) campaignGroups[job.campaign_id] = []
                    campaignGroups[job.campaign_id].push(job)
                })

                for (const [campId, jobs] of Object.entries(campaignGroups)) {
                    const id = parseInt(campId)
                    const config = jobs[0].config_json ? JSON.parse(jobs[0].config_json) : {}
                    const autoSchedule = config.autoSchedule !== false // Default to true if undefined

                    if (autoSchedule) {
                        console.log(`[JobQueue] Auto-rescheduling ${jobs.length} jobs for campaign ${id} (Preserving gaps)`)
                        await this.shiftCampaignSchedule(id)
                    } else {
                        console.log(`[JobQueue] Marking ${jobs.length} jobs as 'missed' for campaign ${id} (Manual action required)`)
                        const ids = jobs.map(j => j.id)
                        const placeholders = ids.map(() => '?').join(',')
                        storageService.run(
                            `UPDATE jobs SET status = 'missed' WHERE id IN (${placeholders})`,
                            ids
                        )
                    }
                }
            }
        } catch (e) {
            console.error('[JobQueue] Failed to check missed jobs:', e)
        }

        this.interval = setInterval(() => this.processQueue(), this.POLL_INTERVAL)
        console.log('[JobQueue] Started. Queue Active:', !this.isPaused)
    }

    stop() {
        if (this.interval) clearInterval(this.interval)
        this.interval = null
        this.isRunning = false
    }

    getMissedJobs() {
        const nowIso = new Date().toISOString()
        return storageService.getAll(`
            SELECT * FROM jobs 
            WHERE status = 'pending' 
            AND (scheduled_for IS NULL OR scheduled_for <= ?)
            ORDER BY scheduled_for ASC
        `, [nowIso])
    }

    resumeFromRecovery(rescheduleItems: { id: number, scheduled_for: string }[] = []) {
        console.log(`[JobQueue] Resuming from recovery mode with ${rescheduleItems.length} rescheduled items`)

        // 1. Update rescheduled times
        for (const item of rescheduleItems) {
            try {
                if (item.scheduled_for) {
                    storageService.run("UPDATE jobs SET scheduled_for = ?, status = 'pending' WHERE id = ?", [item.scheduled_for, item.id])
                } else {
                    // If no time provided, just set to pending (run now)
                    storageService.run("UPDATE jobs SET status = 'pending' WHERE id = ?", [item.id])
                }
            } catch (e) {
                console.error(`[JobQueue] Failed to reschedule job ${item.id}`, e)
            }
        }

        this.isPaused = false
        // Trigger immediate check
        setImmediate(() => this.processQueue())
    }

    discardRecovery(jobIds: number[]) {
        console.log(`[JobQueue] Discarding recovery for ${jobIds.length} jobs (setting to 'paused')`)
        for (const id of jobIds) {
            try {
                storageService.run("UPDATE jobs SET status = 'paused' WHERE id = ?", [id])
            } catch (e) {
                console.error(`[JobQueue] Failed to pause job ${id}`, e)
            }
        }
        this.isPaused = false
        // Trigger immediate check to process other pending jobs
        setImmediate(() => this.processQueue())
    }

    async shiftCampaignSchedule(campaignId: number) {
        // 1. Get all pending/missed jobs ordered by time
        const jobs = storageService.getAll(
            `SELECT id, scheduled_for FROM jobs WHERE campaign_id = ? AND status IN ('pending', 'missed') ORDER BY scheduled_for ASC`,
            [campaignId]
        )

        if (jobs.length === 0) return

        // 2. Calculate time shift needed
        // Find the earliest scheduled time
        const firstJob = jobs[0]
        const scheduledTime = new Date(firstJob.scheduled_for).getTime()
        const now = Date.now()

        // If scheduled in future, no shift needed naturally, but if this is called explicitly (e.g. reschedule), we might force it?
        // Logic: Shift so first job starts NOW (plus small buffer)

        let shiftMs = now - scheduledTime
        if (shiftMs < 0) shiftMs = 0 // Don't shift backwards if already in future?

        // Add 1 minute buffer if we are shifting
        if (shiftMs > 0) {
            shiftMs += 1000 * 60
        }

        console.log(`[JobQueue] Shifting schedule for Campaign ${campaignId} by ${(shiftMs / 1000 / 60).toFixed(2)} mins`)

        if (shiftMs <= 0) return

        // 3. Update all jobs
        const updates = jobs.map(j => {
            const oldTime = new Date(j.scheduled_for).getTime()
            const newTime = new Date(oldTime + shiftMs).toISOString()
            return { id: j.id, scheduled_for: newTime }
        })

        // Batch update
        try {
            // Use storageService.run in a loop since we don't have transaction exposed
            updates.forEach(u => {
                storageService.run("UPDATE jobs SET scheduled_for = ?, status = 'pending' WHERE id = ?", [u.scheduled_for, u.id])
            })
        } catch (e) {
            console.error('[JobQueue] Failed to shift schedule:', e)
        }
    }

    async rescheduleMissedJobs(campaignId: number) {
        console.log(`[JobQueue] Rescheduling missed jobs for campaign ${campaignId}...`)
        // Use the shift logic to preserve gaps
        await this.shiftCampaignSchedule(campaignId)

        // Ensure strictly all 'missed' are set to 'pending' (shiftCampaignSchedule does this for the ones it touches, but just in case)
        const res = storageService.run(
            `UPDATE jobs SET status = 'pending' WHERE campaign_id = ? AND status = 'missed'`,
            [campaignId]
        )
        return res.changes
    }

    async processQueue() {
        if (this.isRunning || this.isPaused) return
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

            const nowIso = new Date().toISOString()
            const job = storageService.get(`
                SELECT * FROM jobs 
                WHERE status = 'pending'
                AND (scheduled_for IS NULL OR scheduled_for <= ?)
                ORDER BY scheduled_for ASC, created_at ASC 
                LIMIT 1
            `, [nowIso])

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

            let publishResult: any = null
            if (job.type === 'SCAN') {
                await this.handleScan(job, data, tiktok)
            } else if (job.type === 'DOWNLOAD') {
                await this.handleDownload(job, data, tiktok)
            } else if (job.type === 'PUBLISH') {
                publishResult = await this.handlePublish(job, data, tiktok)
            }

            // Mark completed or uploaded based on result
            let finalStatus = 'completed'
            // If it was a publish job and it's reviewing/private, mark as 'uploaded' instead of 'completed'
            if (job.type === 'PUBLISH' && publishResult && (publishResult.isReviewing || publishResult.warning)) {
                finalStatus = 'uploaded'
                console.log(`Job #${job.id} uploaded but under review/verification failed. Status: ${finalStatus}`)
            } else {
                console.log(`Job #${job.id} completed`)
            }

            storageService.run("UPDATE jobs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [finalStatus, job.id])

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

            console.log(`[DEBUG_DESC] handleScan: Creating DOWNLOAD job for ${v.id}. Desc: "${v.desc || v.description}"`);
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
                        advancedVerification: data.advancedVerification,
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
        const { filePath, cached, meta } = await tiktok.downloadVideo(data.url, data.platform_id)

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

        // 3. Update video record (including valid caption from library)
        // CRITICAL FIX: Update data.description from meta IMMEDIATELY, regardless of DB state
        if (meta && meta.description) {
            console.log(`[DEBUG_DESC] JobQueue received new caption from TikTokModule: "${meta.description}"`)
            data.description = meta.description
        }

        let video = storageService.get("SELECT id, metadata, description FROM videos WHERE platform_id = ?", [data.platform_id])

        // CRITICAL FIX: If video doesn't exist (because handleScan didn't insert it), create it now!
        if (!video) {
            console.log(`[DEBUG_DESC] Video record missing for ${data.platform_id}. Creating new record...`)
            try {
                const now = new Date().toISOString()
                const initialMeta = {
                    author: meta ? meta.author : null,
                    stats: data.videoStats
                }
                storageService.run(
                    `INSERT INTO videos (platform, platform_id, url, description, status, metadata, created_at)
            VALUES ('tiktok', ?, ?, ?, 'downloading', ?, ?)`,
                    [
                        data.platform_id,
                        data.url,
                        data.description || '', // Use the description we just updated from meta
                        JSON.stringify(initialMeta),
                        now
                    ]
                )
                // Fetch the newly created video so we can update it below (or just proceed)
                video = storageService.get("SELECT id, metadata, description FROM videos WHERE platform_id = ?", [data.platform_id])
            } catch (e: any) {
                console.error(`[JobQueue] Failed to create video record:`, e)
            }
        }

        if (video) {
            let dbMeta = {}
            try { dbMeta = JSON.parse(video.metadata || '{}') } catch (e) { }

            // Merge new metadata if available
            if (meta) {
                if (meta.description) {
                    const oldDesc = video.description || ''
                    const newDesc = meta.description
                    // Update if different, OR if old description was likely a placeholder
                    const isPlaceholder = oldDesc === 'No description' || oldDesc === ''

                    // Force update if we have a better description (even if it's just cleaned)
                    // and ensure we NEVER save "No description" back to DB
                    if (newDesc && newDesc !== 'No description') {
                        if (newDesc !== oldDesc || isPlaceholder) {
                            console.log(`[DEBUG_DESC] Updating video caption in DB.`)
                            storageService.run("UPDATE videos SET description = ? WHERE id = ?", [newDesc, video.id])
                            data.description = newDesc
                        }
                    }
                }
                if (meta.author) {
                    dbMeta = { ...dbMeta, author: meta.author }
                    storageService.run("UPDATE videos SET metadata = ? WHERE id = ?", [JSON.stringify(dbMeta), video.id])
                }
            }

            storageService.run("UPDATE videos SET local_path = ?, status = 'downloaded' WHERE id = ?", [finalPath, video.id])
        }

        // 4. Create PUBLISH job with video info
        if (data.targetAccounts && data.targetAccounts.length > 0) {
            this.updateJobData(job.id, { ...data, status: 'Scheduling publication...' })

            // Critical Safeguard: Ensure no "No description" leaks to publish job
            const originalDescription = (data.description === 'No description' ? '' : data.description) || ''
            let captionPattern = originalDescription // Default to just original description

            // 1. Determine Pattern (Custom Override OR Campaign Template)
            if (data.customCaption !== undefined && data.customCaption !== null) {
                console.log(`[JobQueue] Using custom caption pattern: "${data.customCaption}"`)
                captionPattern = data.customCaption
            } else {
                // Fetch Campaign Config for Template
                const campaign = storageService.get('SELECT config_json FROM campaigns WHERE id = ?', [job.campaign_id])
                if (campaign && campaign.config_json) {
                    try {
                        const config = JSON.parse(campaign.config_json)
                        console.log(`[JobQueue] Campaign config loaded. Template: "${config.captionTemplate}"`)
                        if (config.captionTemplate) {
                            captionPattern = config.captionTemplate
                        }
                    } catch (e) {
                        console.error('Failed to load campaign config for caption:', e)
                    }
                } else {
                    console.log(`[JobQueue] No campaign config found or empty. Using default pattern (original).`)
                }
            }

            console.log(`[JobQueue] Resolving caption. Pattern: "${captionPattern}", Original: "${originalDescription.substring(0, 30)}..."`)

            // 2. Generate Final Caption using Pattern
            const finalCaption = CaptionGenerator.generate(captionPattern, {
                original: originalDescription,
                time: new Date(), // Or use scheduleTime if we knew it
                author: meta ? meta.author : 'user'
            })
            console.log(`[JobQueue] Generated final caption: "${finalCaption}" (Base: "${originalDescription.substring(0, 20)}...")`)

            console.log(`[DEBUG_DESC] Creating PUBLISH jobs with caption: "${finalCaption}"`)
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
                            caption: finalCaption,
                            thumbnail: data.thumbnail || '',
                            videoStats: data.videoStats || {},
                            advancedVerification: data.advancedVerification,
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
        let { video_path, account_id, caption, account_name } = data

        // Setup dedicated job logger
        const jobLogPath = require('path').join(require('electron').app.getPath('userData'), 'logs', `job_${job.id}_publish.log`)
        require('fs').mkdirSync(require('path').dirname(jobLogPath), { recursive: true })

        const log = (msg: string) => {
            const line = `[${new Date().toISOString()}] ${msg}\n`
            console.log(`[Job ${job.id}] ${msg}`)
            try { require('fs').appendFileSync(jobLogPath, line) } catch (e) { }
        }

        log(`Starting Publish Job for Account: ${account_name || 'Unknown'}`)
        this.updateJobData(job.id, { ...data, status: `Publishing to @${account_name || 'account'}...` })

        // 1. Load account cookies
        log(`Loading cookies for account ID ${account_id}...`)
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

        // Final Fallback for empty caption
        if (!caption || caption === 'No description') {
            const videoRec = storageService.get("SELECT description FROM videos WHERE platform_id = ?", [data.video_id || data.platform_id])
            if (videoRec && videoRec.description && videoRec.description !== 'No description') {
                log(`Caption was empty, using fallback from DB: "${videoRec.description}"`)
                caption = videoRec.description
            } else {
                caption = '' // Force empty if still "No description"
            }
        }

        log(`Invoking TikTokModule.publishVideo`)
        log(`  - Video: ${video_path}`)
        log(`  - Caption (Job Data): "${data.caption}"`)
        log(`  - Caption (Final Passed): "${caption}"`)
        log(`  - AdvancedVerification: ${data.advancedVerification}`)

        const result = await tiktok.publishVideo(
            video_path,
            caption || '',
            cookies,
            (msg) => {
                log(`Progress: ${msg}`)
                this.updateJobData(job.id, { ...data, status: msg })
            },
            { advancedVerification: data.advancedVerification, username: data.account_username }
        )

        if (!result.success) {
            log(`❌ Publish Failed: ${result.error}`)
            // Ensure artifacts are saved with absolute paths
            const res = result as any;
            if (res.debugArtifacts) {
                log(`[CRITICAL] Saving debug artifacts to database...`)
                log(`  Screenshot: ${res.debugArtifacts.screenshot}`)
                storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [
                    JSON.stringify({
                        video_path,
                        account: account_name,
                        error: result.error,
                        debugArtifacts: res.debugArtifacts,
                        logPath: jobLogPath, // Added log path
                        failed_at: new Date().toISOString()
                    }),
                    job.id
                ])
            }
            throw new Error(result.error || 'Upload failed (unknown error)')
        }

        // Handle Partial Success (Uploaded but Verification Failed)
        if (!result.videoId) {
            console.warn(`[JobQueue] Published but unverified (No ID).`)
            this.updateJobData(job.id, { ...data, status: `Published (Unverified - Check manually)` })

            // Mark as published anyway since we confirmed the "Post" success message
            if (data.platform_id) {
                storageService.run("UPDATE videos SET status = 'published' WHERE platform_id = ?", [data.platform_id])
            }

            // Store result without ID
            storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [
                JSON.stringify({
                    account: account_name,
                    video_path,
                    published_at: new Date().toISOString(),
                    warning: 'Verification failed'
                }),
                job.id
            ])
            return;
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
        // Store result with video URL & ID
        storageService.run("UPDATE jobs SET result_json = ?, metadata = ? WHERE id = ?", [
            JSON.stringify({
                account: account_name,
                video_path,
                video_url: result.videoUrl,
                video_id: result.videoId,
                published_at: new Date().toISOString(),
                is_reviewing: result.isReviewing
            }),
            JSON.stringify({
                publish_url: result.videoUrl,
                publish_id: result.videoId
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
                        console.log(`Campaign ${campaignId} kept active (Recurring / Sources present)`)
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
