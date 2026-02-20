import { BrowserWindow, ipcMain, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs-extra'
import * as Sentry from '@sentry/electron/main'
import { storageService } from './StorageService'
import { moduleManager } from './ModuleManager'
import { TikTokModule, ScanOptions } from '../modules/tiktok/TikTokModule'
import { publishAccountService } from './PublishAccountService'
import { campaignService } from './CampaignService'
import { notificationService } from './NotificationService'
import { CaptionGenerator } from './CaptionGenerator'
import { fileLogger } from './FileLogger'
import { applyCampaignEvent } from './CampaignStateMachine'

class JobQueue {
    private interval: NodeJS.Timeout | null = null
    private isRunning = false
    private isPaused = false
    private globalThrottleUntil = 0 // Timestamp until which global throttling is active
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
        console.log('[JobQueue] >>> STARTING WORKER CYCLE <<<');

        // BƯỚC 1: Recovery — reset stuck 'running' jobs
        try {
            console.log('[JobQueue] [Recovery] Checking for stuck jobs (status=running)...');
            storageService.run("UPDATE jobs SET status = 'queued' WHERE status = 'running' AND type = 'DOWNLOAD'")
            storageService.run("UPDATE jobs SET status = 'queued' WHERE status = 'running' AND type = 'PUBLISH'")
            storageService.run("UPDATE jobs SET status = 'pending' WHERE status = 'running' AND type IN ('SCAN', 'MONITOR')")
        } catch (e) {
            console.error('[JobQueue] [Recovery] Error during startup recovery:', e)
        }

        // BƯỚC 2: Kiểm tra missed jobs TRƯỚC KHI pause
        try {
            const nowIso = new Date().toISOString()
            const missedJobs = storageService.getAll(`
                SELECT j.*, c.config_json 
                FROM jobs j JOIN campaigns c ON j.campaign_id = c.id
                WHERE j.status IN ('queued', 'scheduled')
                AND j.scheduled_for <= ?
                AND c.status = 'active'
            `, [nowIso])

            console.log(`[JobQueue] Missed Jobs Check: Found ${missedJobs.length} jobs`)

            if (missedJobs.length > 0) {
                const campaignGroups: Record<number, any[]> = {}
                missedJobs.forEach(job => {
                    if (!campaignGroups[job.campaign_id]) campaignGroups[job.campaign_id] = []
                    campaignGroups[job.campaign_id].push(job)
                })

                for (const [campId, jobs] of Object.entries(campaignGroups)) {
                    const id = parseInt(campId)
                    const config = jobs[0].config_json ? JSON.parse(jobs[0].config_json) : {}

                    if (config.autoReschedule !== false) {
                        console.log(`[JobQueue] Auto-rescheduling ${jobs.length} jobs for campaign ${id}`)
                        await this.shiftCampaignSchedule(id)
                    } else {
                        console.log(`[JobQueue] Marking ${jobs.length} jobs as 'missed' for campaign ${id}`)
                        const ids = jobs.map(j => j.id)
                        const placeholders = ids.map(() => '?').join(',')
                        storageService.run(
                            `UPDATE jobs SET status = 'missed' WHERE id IN (${placeholders})`,
                            ids
                        )
                        storageService.run("UPDATE campaigns SET has_missed_jobs = 1 WHERE id = ?", [id])
                    }
                }
            }

            // BƯỚC 3: Pause tất cả active campaigns (sau khi đã xử lý missed)
            console.log('[JobQueue] [Startup] Pausing all active campaigns...');
            const pauseRes = storageService.run(
                "UPDATE campaigns SET status = 'paused', paused_at_startup = 1 WHERE status = 'active'"
            )
            if (pauseRes && pauseRes.changes > 0) {
                // Chỉ pause jobs trong tương lai
                storageService.run(`
                    UPDATE jobs SET status = 'paused' 
                    WHERE status IN ('queued', 'scheduled') 
                    AND campaign_id IN (SELECT id FROM campaigns WHERE paused_at_startup = 1)
                    AND scheduled_for > ?
                `, [nowIso])
                console.log(`[JobQueue] [Startup] Paused ${pauseRes.changes} active campaigns.`);
            }
        } catch (e) {
            console.error('[JobQueue] [Startup] Error processing missed jobs or pausing:', e)
        }

        // BƯỚC 4: Start polling interval
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
            WHERE status IN ('queued', 'scheduled')
            AND (scheduled_for IS NULL OR scheduled_for <= ?)
            ORDER BY scheduled_for ASC
        `, [nowIso])
    }

    getCampaignMissedJobs(campaignId: number) {
        const nowIso = new Date().toISOString()
        return storageService.getAll(`
            SELECT * FROM jobs 
            WHERE campaign_id = ? 
            AND (status = 'missed' OR (status IN ('queued', 'scheduled') AND scheduled_for <= ?))
            ORDER BY scheduled_for ASC
        `, [campaignId, nowIso])
    }

    resumeFromRecovery(rescheduleItems: { id: number, scheduled_for: string }[] = []) {
        console.log(`[JobQueue] Resuming from recovery mode with ${rescheduleItems.length} rescheduled items`)

        // 1. Update rescheduled times
        for (const item of rescheduleItems) {
            try {
                if (item.scheduled_for) {
                    storageService.run("UPDATE jobs SET scheduled_for = ?, status = 'scheduled' WHERE id = ?", [item.scheduled_for, item.id])
                } else {
                    // If no time provided, just set to queued (run now)
                    storageService.run("UPDATE jobs SET status = 'queued' WHERE id = ?", [item.id])
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
        // 1. Get all queued/scheduled/missed jobs ordered by time
        const jobs = storageService.getAll(
            `SELECT id, scheduled_for FROM jobs WHERE campaign_id = ? AND status IN ('queued', 'scheduled', 'missed') ORDER BY scheduled_for ASC`,
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
                storageService.run("UPDATE jobs SET scheduled_for = ?, status = 'scheduled' WHERE id = ?", [u.scheduled_for, u.id])
            })
        } catch (e) {
            console.error('[JobQueue] Failed to shift schedule:', e)
        }
    }

    async rescheduleMissedJobs(campaignId: number) {
        console.log(`[JobQueue] Rescheduling missed jobs for campaign ${campaignId}...`)
        // Use the shift logic to preserve gaps
        await this.shiftCampaignSchedule(campaignId)

        // Ensure strictly all 'missed' are set to 'scheduled' (shiftCampaignSchedule does this for the ones it touches, but just in case)
        const res = storageService.run(
            `UPDATE jobs SET status = 'scheduled' WHERE campaign_id = ? AND status = 'missed'`,
            [campaignId]
        )
        return res.changes
    }

    async pauseCampaign(campaignId: number) {
        console.log(`[JobQueue] Pausing campaign ${campaignId}...`)
        // Update campaign status
        storageService.run("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId])

        const res = storageService.run(
            `UPDATE jobs SET status = 'paused' WHERE campaign_id = ? AND status IN ('queued', 'scheduled', 'missed', 'pending')`,
            [campaignId]
        )
        return res.changes
    }

    async resumeCampaign(campaignId: number) {
        console.log(`[JobQueue] Resuming campaign ${campaignId} (setting paused to queued/scheduled/pending)...`)
        // Update campaign status
        storageService.run("UPDATE campaigns SET status = 'active' WHERE id = ?", [campaignId])

        // EXECUTE/DOWNLOAD queued jobs without schedule
        const res = storageService.run(
            `UPDATE jobs SET status = 'queued' WHERE campaign_id = ? AND status = 'paused' AND scheduled_for IS NULL AND type != 'SCAN'`,
            [campaignId]
        )
        // SCHEDULED jobs
        storageService.run(
            `UPDATE jobs SET status = 'scheduled' WHERE campaign_id = ? AND status = 'paused' AND scheduled_for IS NOT NULL AND type != 'SCAN'`,
            [campaignId]
        )
        // PENDING scan jobs
        storageService.run(
            `UPDATE jobs SET status = 'pending' WHERE campaign_id = ? AND status = 'paused' AND type = 'SCAN'`,
            [campaignId]
        )
        return res.changes
    }

    setGlobalThrottle(minutes: number = 15) {
        this.globalThrottleUntil = Date.now() + (minutes * 60 * 1000)
        console.warn(`[JobQueue] GLOBAL THROTTLE ENABLED for ${minutes} minutes.`)
        notificationService.notify({
            title: 'Bot Detection Warning',
            body: `TikTok is rate-limiting the app. Pausing all background tasks for ${minutes} minutes to be safe.`,
            silent: false
        })
    }

    private logQueueState() {
        try {
            const stats = storageService.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
                FROM jobs
            `)
            console.log(`[JobQueue] [STATE] Summary: Total=${stats.total}, Running=${stats.running}, Pending=${stats.pending}, Failed=${stats.failed}, Completed=${stats.completed}`);
        } catch (e) { /* ignore */ }
    }

    async processQueue() {
        if (this.isRunning) {
            console.log('[JobQueue] [Process] Skip: Already running a pull cycle.');
            return;
        }
        if (this.isPaused) {
            console.log('[JobQueue] [Process] Skip: Queue is paused.');
            return;
        }
        if (Date.now() < this.globalThrottleUntil) {
            console.log(`[JobQueue] [Process] Skip: Global throttle active until ${new Date(this.globalThrottleUntil).toISOString()}`);
            return;
        }

        this.isRunning = true
        this.logQueueState();

        try {
            const maxConcurrentStr = storageService.get("SELECT value FROM settings WHERE key = 'app.maxConcurrentJobs'")?.value
            const maxConcurrent = parseInt(maxConcurrentStr || '100')

            const nowIso = new Date().toISOString()
            const active = storageService.get("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").count
            const needed = maxConcurrent - active
            console.log(`[JobQueue] [Process] Slot Check: ${active}/${maxConcurrent} slots occupied. Pulling up to ${needed} jobs (Now: ${nowIso})...`);

            if (needed <= 0) {
                console.log('[JobQueue] [Process] Concurrency limit reached. Waiting for next cycle.');
                return
            }

            // SMART SELECTION: Priority DESC, then EXECUTE first, then Oldest Scheduled
            const jobs = storageService.all(`
                SELECT * FROM jobs 
                WHERE status IN ('queued', 'scheduled', 'download_retry', 'edit_retry', 'publish_retry', 'pending')
                AND (scheduled_for IS NULL OR scheduled_for <= ?)
                ORDER BY priority DESC, (CASE WHEN type IN ('DOWNLOAD', 'PUBLISH') THEN 0 ELSE 1 END) ASC, scheduled_for ASC 
                LIMIT ?
            `, [nowIso, needed])

            if (jobs.length > 0) {
                console.log(`[JobQueue] [Process] Found ${jobs.length} jobs to execute.`);

                for (const job of jobs) {
                    console.log(`[JobQueue] [Process] Initiating Job #${job.id} (Type: ${job.type})...`);
                    this.executeJob(job).catch(e => console.error(`Job #${job.id} failed:`, e));

                    // Stagger start by 5s to avoid Browser launch overlaps and CPU spikes
                    if (jobs.indexOf(job) < jobs.length - 1) {
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }

                console.log(`[JobQueue] [Process] All ${jobs.length} job(s) in this cycle have been triggered.`);
            } else {
                console.log('[JobQueue] [Process] No pending jobs due for execution.');
            }

        } catch (error) {
            console.error('[JobQueue] [Process] Cycle Error:', error)
        } finally {
            this.isRunning = false
        }
    }

    async executeJob(job: any) {
        // Determine initial processing status
        let initialStatus = 'running'
        if (job.type === 'DOWNLOAD') {
            if (job.status === 'download_retry' || job.status === 'download_failed' || job.status === 'queued' || job.status === 'scheduled') initialStatus = 'downloading'
        } else if (job.type === 'PUBLISH') {
            if (job.status === 'edit_retry' || job.status === 'edit_failed' || job.status === 'queued' || job.status === 'scheduled') initialStatus = 'editing'
            else if (job.status === 'publish_retry' || job.status === 'publish_failed' || job.status === 'edited') initialStatus = 'publishing'
        }

        // Mark running
        storageService.run("UPDATE jobs SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?", [initialStatus, job.id])
        this.broadcastUpdate()

        try {
            const data = JSON.parse(job.data_json || '{}')
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule

            // Initialize module if needed (e.g. browser context)
            if (!tiktok) throw new Error('TikTok module missing')

            console.log(`[JobQueue] [Execute] Job #${job.id} Loaded Data:`, JSON.stringify(data, null, 2));
            console.log(`[JobQueue] [Execute] Module Context: TikTok Ready=${!!tiktok}`);

            // 5-minute timeout for job execution
            const JOB_TIMEOUT = 5 * 60 * 1000;
            let timeoutId: NodeJS.Timeout;

            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Job timed out after ${JOB_TIMEOUT / 1000 / 60} minutes`));
                }, JOB_TIMEOUT);
            });

            const workPromise = (async () => {
                let publishResult: any = null
                if (job.type === 'SCAN') {
                    console.log(`[JobQueue] [Execute] Handing off to SCAN logic...`);
                    await this.handleScan(job, data, tiktok)
                } else if (job.type === 'MONITOR') {
                    console.log(`[JobQueue] [Execute] Handing off to MONITOR logic...`);
                    await this.handleMonitor(job, data, tiktok)
                } else if (job.type === 'DOWNLOAD' || job.type === 'PUBLISH') {
                    console.log(`[JobQueue] [Execute] Handing off to DOWNLOAD/PUBLISH pipeline...`);
                    publishResult = await this.handleExecutePipeline(job, data, tiktok)
                }
                return publishResult;
            })();

            let publishResult: any = null;
            try {
                publishResult = await Promise.race([workPromise, timeoutPromise]);
            } finally {
                clearTimeout(timeoutId!);
            }

            console.log(`[JobQueue] Job #${job.id} successfully executed via logic handler.`);

            // Mark completed or uploaded based on result
            let finalStatus = 'completed'
            // If it was a publish job and it's reviewing/private, mark as 'uploaded' instead of 'published'
            if (job.type === 'PUBLISH' && publishResult && (publishResult.isReviewing || publishResult.warning)) {
                finalStatus = 'uploaded'
                console.log(`[JobQueue] Job #${job.id} uploaded but under review/verification failed. Status: ${finalStatus}`)
            } else if (job.type === 'PUBLISH') {
                finalStatus = 'published'
                console.log(`[JobQueue] Job #${job.id} marked as PUBLISHED.`)
            } else {
                console.log(`[JobQueue] Job #${job.id} marked as COMPLETED.`)
            }

            storageService.run("UPDATE jobs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [finalStatus, job.id])

        } catch (error: any) {
            Sentry.captureException(error, {
                tags: { service: 'JobQueue', operation: 'executeJob', jobType: job.type },
                extra: { jobId: job.id, campaignId: job.campaign_id }
            })
            console.error(`Job #${job.id} failed:`, error)
            fileLogger.log(`Job #${job.id} failed:`, { error: error.message, stack: error.stack, jobType: job.type })

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

            if (error.message && error.message.includes('CAPTCHA')) {
                storageService.run("UPDATE jobs SET status = 'publish_failed', error_message = ? WHERE id = ?", [error.message, job.id])
            } else {
                // If it's an EXECUTE job we should ideally mark it with *_failed depending on where it failed, but the handleExecutePipeline will do that internally and re-throw.
                // We just update the message here without touching the status if it already contains '_failed'
                const currentStatus = storageService.get("SELECT status FROM jobs WHERE id = ?", [job.id]).status
                if (!currentStatus.includes('_failed')) {
                    storageService.run("UPDATE jobs SET status = 'failed', error_message = ? WHERE id = ?", [error.message, job.id])
                } else {
                    storageService.run("UPDATE jobs SET error_message = ? WHERE id = ?", [error.message, job.id])
                }
            }

            try {
                const campaign = storageService.get('SELECT name FROM campaigns WHERE id = ?', [job.campaign_id])
                notificationService.notifyJobFailed(campaign ? campaign.name : 'Unknown', error.message)
            } catch (e) { /* ignore */ }
        } finally {
            // ALWAYS check completion (including SCAN jobs)
            // Because SCAN creates EXECUTE jobs, and we need to check if campaign is done
            this.checkCampaignCompletion(job.campaign_id)
            this.broadcastUpdate()
        }
    }

    private getNextValidTime(baseTime: Date, dailyStartStr: string = '07:00', dailyEndStr: string = '23:00'): Date {
        const [startH, startM] = dailyStartStr.split(':').map(Number)
        const [endH, endM] = dailyEndStr.split(':').map(Number)
        const startMins = startH * 60 + startM
        const endMins = endH * 60 + endM

        // Clone
        let d = new Date(baseTime)
        const currentMins = d.getHours() * 60 + d.getMinutes()

        if (currentMins < startMins) {
            // Too early: Move to Start Time today
            d.setHours(startH, startM, 0, 0)
        } else if (currentMins >= endMins) {
            // Too late: Move to Start Time tomorrow
            d.setDate(d.getDate() + 1)
            d.setHours(startH, startM, 0, 0)
        }
        return d
    }

    private async handleScan(job: any, data: any, tiktok: TikTokModule) {
        console.log(`[SCAN_DEBUG] ========== SCAN START (Job #${job.id}) ==========`)
        console.log(`[SCAN_DEBUG] Full data.sources:`, JSON.stringify(data.sources, null, 2))
        console.log(`[SCAN_DEBUG] data.postOrder: ${data.postOrder}`)
        console.log(`[SCAN_DEBUG] data.isMonitoring: ${data.isMonitoring}`)
        console.log(`[SCAN_DEBUG] data.targetAccounts:`, JSON.stringify(data.targetAccounts))

        // 1. Get scheduling params
        const intervalMinutes = data.intervalMinutes || 15
        let scheduleTime = data.nextScheduleTime ? new Date(data.nextScheduleTime) : new Date()

        // Enforce Daily Window (Default 7-23 if not set)
        const schedule = data.schedule || {}
        scheduleTime = this.getNextValidTime(scheduleTime, schedule.startTime, schedule.endTime)

        const targetAccounts = data.targetAccounts || []

        // Load account cookies for authenticated scanning
        let accountCookies: any[] = []
        console.log(`[SCAN_DEBUG] targetAccounts raw value:`, JSON.stringify(targetAccounts), `(type: ${typeof targetAccounts[0]})`)
        if (targetAccounts.length > 0) {
            try {
                const accountId = Number(targetAccounts[0])
                console.log(`[SCAN_DEBUG] Looking up cookies for account id=${accountId}`)
                // Use the same method publishVideo uses
                accountCookies = publishAccountService.getAccountCookies(accountId)
                if (accountCookies.length > 0) {
                    console.log(`[SCAN_DEBUG] ✅ Loaded ${accountCookies.length} cookies for account id=${accountId}`)
                } else {
                    // Fallback: try raw SQL for debugging
                    const rawRow = storageService.get('SELECT id, username, length(cookies_json) as clen FROM publish_accounts WHERE id = ?', [accountId])
                    console.log(`[SCAN_DEBUG] ❌ No cookies from service. Raw DB row:`, JSON.stringify(rawRow))
                    const allAccounts = storageService.all('SELECT id, username, length(cookies_json) as clen FROM publish_accounts')
                    console.log(`[SCAN_DEBUG] All publish_accounts:`, JSON.stringify(allAccounts))
                }
            } catch (e) {
                console.warn('[SCAN_DEBUG] Failed to load account cookies:', e)
            }
        } else {
            console.log('[SCAN_DEBUG] ⚠️ targetAccounts is empty — no account selected for this campaign')
        }
        const isMonitoring = data.isMonitoring || false // Are we in the future monitoring loop?
        let totalScheduled = data.totalScheduled || 0
        let monitoredCount = data.monitoredCount || 0

        // 2. Scan ALL sources
        let allVideos: any[] = []
        let scannedCount = 0

        // Helper to map new UI modes to TikTokModule options
        const resolveTimeRange = (mode: string | undefined): 'from_now' | 'include_history' => {
            if (mode === 'future_only') return 'from_now'
            return 'include_history'
        }

        // Helper: Check continuous
        const shouldContinue = (source: any): boolean => {
            const mode = source.timeRange
            if (!mode) return true
            if (mode === 'future_only' || mode === 'history_and_future') return true
            if (mode === 'custom_range' && !source.endDate) return true
            return false
        }

        if (data.sources) {
            console.log(`[SCAN_DEBUG] Has sources. Channels: ${data.sources.channels?.length || 0}, Keywords: ${data.sources.keywords?.length || 0}`)
            // 2a. Scan Channels
            if (data.sources.channels) {
                for (const ch of data.sources.channels) {
                    console.log(`[SCAN_DEBUG] --- Channel: @${ch.name} ---`)
                    console.log(`[SCAN_DEBUG]   timeRange: ${ch.timeRange}`)
                    console.log(`[SCAN_DEBUG]   maxScanCount: ${ch.maxScanCount}`)
                    console.log(`[SCAN_DEBUG]   historyLimit: ${ch.historyLimit}`)
                    console.log(`[SCAN_DEBUG]   startDate: ${ch.startDate}, endDate: ${ch.endDate}`)
                    console.log(`[SCAN_DEBUG]   sortOrder: ${ch.sortOrder}`)
                    console.log(`[SCAN_DEBUG]   autoSchedule: ${ch.autoSchedule}`)
                    console.log(`[SCAN_DEBUG]   isMonitoring: ${isMonitoring}`)
                    this.updateJobData(job.id, { ...data, status: `Scanning channel @${ch.name}...`, scannedCount })

                    // Determine Fetch Limit based on Phase
                    let fetchLimit = ch.maxScanCount
                    if (!isMonitoring && ch.historyLimit && ch.historyLimit !== 'unlimited') {
                        fetchLimit = ch.historyLimit
                    }
                    console.log(`[SCAN_DEBUG]   Resolved fetchLimit: ${fetchLimit}`)

                    const scanOptions: ScanOptions = {
                        limit: fetchLimit,
                        timeRange: resolveTimeRange(ch.timeRange) as any,
                        startDate: ch.startDate,
                        endDate: ch.endDate,
                        isBackground: true, // Critical: scanProfile only returns videos when isBackground=true
                        cookies: accountCookies.length > 0 ? accountCookies : undefined,
                        onProgress: (p) => {
                            this.updateJobData(job.id, { ...data, status: `Scanning @${ch.name}: ${p}`, scannedCount })
                        }
                    }
                    console.log(`[SCAN_DEBUG]   scanOptions:`, JSON.stringify({ limit: scanOptions.limit, timeRange: scanOptions.timeRange, startDate: scanOptions.startDate, endDate: scanOptions.endDate, isBackground: scanOptions.isBackground }))

                    let result
                    try {
                        result = await tiktok.scanProfile(ch.name, scanOptions) || { videos: [] }
                    } catch (err: any) {
                        if (err.message && (err.message.includes('CAPTCHA') || err.message === 'CAPTCHA_REQUIRED')) {
                            this.updateJobData(job.id, { ...data, status: `Scan Failed: CAPTCHA Required` })
                            // Mark campaign as needing captcha
                            await campaignService.updateStatus(job.campaign_id, 'needs_captcha')
                            throw err // Rethrow to mark job as failed
                        }
                        throw err
                    }
                    let newVideos = result.videos || []
                    console.log(`[SCAN_DEBUG]   scanProfile returned ${newVideos.length} videos`)
                    if (newVideos.length > 0) {
                        console.log(`[SCAN_DEBUG]   First video:`, JSON.stringify({ id: newVideos[0].id, desc: newVideos[0].desc?.substring(0, 50) }))
                    }

                    // Apply source-level sorting
                    const sortOrder = ch.sortOrder || data.postOrder || 'newest'
                    newVideos.sort((a: any, b: any) => {
                        if (sortOrder === 'oldest') return (a.id || '').localeCompare(b.id || '')
                        if (sortOrder === 'most_likes') return (b.stats?.likes || 0) - (a.stats?.likes || 0)
                        return (b.id || '').localeCompare(a.id || '')
                    })

                    // Attach source info
                    newVideos.forEach((v: any) => v.source = { type: 'channel', name: ch.name })

                    // Strict Fetch Limit (if module over-fetched)
                    if (fetchLimit !== 'unlimited' && typeof fetchLimit === 'number') {
                        newVideos = newVideos.slice(0, fetchLimit)
                    }

                    allVideos.push(...newVideos)
                    scannedCount += newVideos.length
                    const dupMsg = result.duplicatesCount ? ` (${result.duplicatesCount} existing)` : ''
                    this.updateJobData(job.id, { ...data, status: `Scanned @${ch.name}: found ${newVideos.length} new videos${dupMsg}`, scannedCount })
                }
            }

            // 2b. Scan Keywords
            if (data.sources.keywords) {
                for (const kw of data.sources.keywords) {
                    console.log(`[JobQueue] [SCAN] Processing keyword: "${kw.name}"`)

                    let fetchLimit = kw.maxScanCount
                    if (!isMonitoring && kw.historyLimit && kw.historyLimit !== 'unlimited') {
                        fetchLimit = kw.historyLimit
                    }

                    const scanOptions: ScanOptions = {
                        limit: fetchLimit,
                        timeRange: resolveTimeRange(kw.timeRange) as any,
                        startDate: kw.startDate,
                        endDate: kw.endDate,
                        isBackground: true,
                        cookies: accountCookies.length > 0 ? accountCookies : undefined,
                        onProgress: (p) => {
                            this.updateJobData(job.id, { ...data, status: `Scanning keyword "${kw.name}": ${p}`, scannedCount })
                        }
                    }

                    let result
                    try {
                        result = await tiktok.scanKeyword(kw.name, scanOptions) || { videos: [] }
                    } catch (err: any) {
                        if (err.message && (err.message.includes('CAPTCHA') || err.message === 'CAPTCHA_REQUIRED')) {
                            this.updateJobData(job.id, { ...data, status: `Scan Failed: CAPTCHA Required` })
                            // Mark campaign as needing captcha
                            await campaignService.updateStatus(job.campaign_id, 'needs_captcha')
                            throw err
                        }
                        throw err
                    }
                    const newVideos = result.videos || []

                    // Attach source info
                    newVideos.forEach((v: any) => v.source = { type: 'keyword', name: kw.name })

                    allVideos.push(...newVideos)
                    scannedCount += newVideos.length
                    this.updateJobData(job.id, { ...data, status: `Scanned keyword "${kw.name}": found ${newVideos.length} videos`, scannedCount })
                }
            }
        } else {
            console.log(`[SCAN_DEBUG] WARNING: data.sources is FALSY! No sources to scan.`)
        }

        console.log(`[SCAN_DEBUG] Total allVideos before dedup: ${allVideos.length}`)

        // 3. Deduplicate
        const uniqueVideos = Array.from(new Map(allVideos.map(v => [v.id, v])).values())
        console.log(`[SCAN_DEBUG] After dedup: ${uniqueVideos.length} unique videos`)

        // 4. Global sort
        const postOrder = data.postOrder || 'newest'
        uniqueVideos.sort((a: any, b: any) => {
            const aLikes = (a.stats?.likes || 0)
            const bLikes = (b.stats?.likes || 0)
            if (postOrder === 'most_likes') return bLikes - aLikes
            if (postOrder === 'least_likes') return aLikes - bLikes
            if (postOrder === 'oldest') return a.id.localeCompare(b.id)
            return b.id.localeCompare(a.id)
        })

        // 4b. APPLY GLOBAL/LIFECYCLE LIMITS (The "Stop" Logic)
        // We need to check: 
        // - Total Limit (across all time)
        // - Future Limit (during monitoring phase)

        // Assume simplified single-source limit config for now (taken from first source or merged)
        // In real app, limits might be per-source, but CampaignWizard UI seems to show per-source. 
        // For simplicity in this loop, we enforce the LIMIT defined on the source that generated the video? 
        // No, 'JobQueue' aggregates. Let's assume the limits are roughly enforcing the 'Campaign' goal. 
        // If multiple sources have different limits, handling is complex. 
        // Current Plan: CampaignWizard UI sets limits PER SOURCE. 
        // But here we merged videos. 
        // STRATEGY: We will proceed with scheduling, but if we hit a "Global Campaign Limit" we stop.
        // Wait, the UI sets `historyLimit` on the SOURCE. 
        // So `allVideos` should already be limited by `fetchLimit` (lines 465/483 above). 
        // So `historyLimit` is handled!

        // NOW: Handle `futureLimit` and `totalLimit`.
        // These are tricky if per-source. 
        // Let's assume for the "Monitoring" phase, we check the limits of the *Continuous* sources.

        // Let's look at the First Channel/Keyword to get the "Campaign Config" for limits.
        // (Assuming uniform config for now, or taking the most restrictive/lax?)
        // Let's iterate and schedule, checking
        console.log(`[JobQueue] [SCAN] Checks: TotalScheduled=${totalScheduled}, Monitored=${monitoredCount}. Monitoring=${isMonitoring}`)

        // 5. Create Scheduled DOWNLOAD Jobs
        let newlyScheduled = 0

        for (let i = 0; i < uniqueVideos.length; i++) {
            const v = uniqueVideos[i]

            // CHECK LIMITS BEFORE SCHEDULING
            // We need to find the Source config for this video to be precise, or just use the first available config.
            // Let's use a heuristic: Get config from the first channel/keyword.
            const sourceConfig = data.sources?.channels?.[0] || data.sources?.keywords?.[0] || {}

            // Check TOTAL limit
            if (sourceConfig.totalLimit && sourceConfig.totalLimit !== 'unlimited') {
                if (totalScheduled >= sourceConfig.totalLimit) {
                    console.log(`[JobQueue] [LIMIT] Total limit (${sourceConfig.totalLimit}) reached. Stopping scheduling.`)
                    break
                }
            }

            // Check FUTURE limit (only if monitoring)
            if (isMonitoring && sourceConfig.futureLimit && sourceConfig.futureLimit !== 'unlimited') {
                if (monitoredCount >= sourceConfig.futureLimit) {
                    console.log(`[JobQueue] [LIMIT] Future limit (${sourceConfig.futureLimit}) reached. Stopping scheduling.`)
                    break
                }
            }

            // Check if already processed
            const exists = storageService.get("SELECT id FROM videos WHERE platform_id = ? AND status IN ('downloaded', 'published')", [v.id])
            if (exists) {
                continue
            }

            // Schedule
            const sourceOfVideo = data.sources?.channels?.find((c: any) => c.name === v.channelName) ||
                data.sources?.keywords?.find((k: any) => k.name === v.keyword) ||
                sourceConfig;

            const isAutoSchedule = sourceOfVideo.autoSchedule !== false;

            if (isAutoSchedule) {
                // Determine target account via round robin if multiple exist
                let targetAccount = targetAccounts[0]; // fallback
                if (targetAccounts && targetAccounts.length > 0) {
                    targetAccount = targetAccounts[totalScheduled % targetAccounts.length];
                }

                storageService.run(
                    `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'DOWNLOAD', 'queued', ?, ?)`,
                    [
                        job.campaign_id,
                        scheduleTime.toISOString(),
                        JSON.stringify({
                            url: v.url,
                            platform_id: v.platform_id || v.id,
                            video_id: v.id,
                            targetAccount,
                            description: v.desc || v.description,
                            thumbnail: v.thumbnail || v.cover || '',
                            videoStats: v.stats || { views: 0, likes: 0 },
                            source: v.source,
                            editPipeline: data.editPipeline,
                            advancedVerification: data.advancedVerification,
                            status: `Queued`
                        })
                    ]
                )
                newlyScheduled++
                totalScheduled++
                if (isMonitoring) monitoredCount++

                // Advance time and check window
                scheduleTime = new Date(scheduleTime.getTime() + intervalMinutes * 60000)
                scheduleTime = this.getNextValidTime(scheduleTime, schedule.startTime, schedule.endTime)
            } else {
                // Manual Review Needed
                console.log(`[JobQueue] [SCAN] Video ${v.id} requires manual approval (autoSchedule=false). Saving to metadata.`)
                // Mark campaign as needing review
                storageService.run("UPDATE campaigns SET status = 'needs_review' WHERE id = ?", [job.campaign_id])
                // Save found video info to campaign config or metadata for later preview
                // For now, we can create a record in 'videos' with status 'pending_review'
                storageService.run(
                    `INSERT OR REPLACE INTO videos (platform_id, campaign_id, data_json, status) VALUES (?, ?, ?, 'pending_review')`,
                    [v.platform_id || v.id, job.campaign_id, JSON.stringify({ ...v, source: v.source }), 'pending_review']
                )
            }
        }

        // Update Job Result
        const result = { found: uniqueVideos.length, scheduled: newlyScheduled, skipped: uniqueVideos.length - newlyScheduled }
        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [JSON.stringify(result), job.id])
        this.updateJobData(job.id, {
            ...data,
            status: `Scanned (Found ${newlyScheduled} new videos). Queued for download.`,
            scannedCount,
            totalScheduled,
            monitoredCount
        })

        // 6. Reschedule Next Scan (Continuous Loop) or FINISH
        const hasAnyFutureSource = data.sources?.channels?.some((c: any) =>
            c.timeRange === 'future_only' || c.timeRange === 'history_and_future'
        ) || data.sources?.keywords?.some((k: any) =>
            k.timeRange === 'future_only' || k.timeRange === 'history_and_future'
        )

        // Filter Future Sources helper
        const filterFutureSources = (sources: any) => ({
            channels: (sources.channels || []).filter((c: any) => c.timeRange === 'future_only' || c.timeRange === 'history_and_future'),
            keywords: (sources.keywords || []).filter((k: any) => k.timeRange === 'future_only' || k.timeRange === 'history_and_future'),
        })

        if (hasAnyFutureSource) {
            console.log(`[JobQueue] [SCAN] Creating MONITOR job for continuous polling. Time: ${new Date(Date.now() + intervalMinutes * 60000).toISOString()}`);
            storageService.run(
                `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'MONITOR', 'queued', ?, ?)`,
                [
                    job.campaign_id,
                    new Date(Date.now() + intervalMinutes * 60000).toISOString(),
                    JSON.stringify({
                        ...data,
                        lastScannedAt: new Date().toISOString(), // From now
                        sources: filterFutureSources(data.sources)
                    })
                ]
            )
            applyCampaignEvent(job.campaign_id, 'SCAN_COMPLETED_CONTINUOUS')
        } else {
            console.log(`[JobQueue] [SCAN] History scan complete, no future monitoring required.`);
            applyCampaignEvent(job.campaign_id, 'SCAN_COMPLETED_HISTORY')
        }

        // Check autoSchedule
        const hasManualSource = data.sources?.channels?.some((c: any) => c.autoSchedule === false)
            || data.sources?.keywords?.some((k: any) => k.autoSchedule === false)

        if (hasManualSource && newlyScheduled === 0) {
            applyCampaignEvent(job.campaign_id, 'NEEDS_REVIEW')
        }
    }

    private async handleMonitor(job: any, data: any, tiktok: TikTokModule) {
        console.log(`[MONITOR_DEBUG] ========== MONITOR RUN (Job #${job.id}) ==========`)
        const intervalMinutes = data.intervalMinutes || 15
        const lastScannedAt = data.lastScannedAt ? new Date(data.lastScannedAt) : new Date(0)

        let targetAccounts = data.targetAccounts || []
        let accountCookies: any[] = []
        if (targetAccounts.length > 0) {
            try { accountCookies = publishAccountService.getAccountCookies(Number(targetAccounts[0])) } catch (e) { }
        }

        const scanOptions: ScanOptions = {
            timeRange: 'from_now',
            sinceTimestamp: lastScannedAt.getTime(),
            limit: data.sources?.channels?.[0]?.futureLimit || 50,
            isBackground: true,
            cookies: accountCookies.length > 0 ? accountCookies : undefined
        }

        let newVideos: any[] = []

        // Channels
        if (data.sources?.channels) {
            for (const ch of data.sources.channels) {
                try {
                    const result = await tiktok.scanProfile(ch.name, scanOptions) || { videos: [] }
                    const videos = result.videos || []
                    videos.forEach((v: any) => v.source = { type: 'channel', name: ch.name })
                    newVideos.push(...videos)
                } catch (err: any) {
                    if (err.message && err.message.includes('CAPTCHA')) {
                        applyCampaignEvent(job.campaign_id, 'CAPTCHA_DETECTED')
                        throw err
                    }
                }
            }
        }

        // Keywords
        if (data.sources?.keywords) {
            for (const kw of data.sources.keywords) {
                try {
                    const result = await tiktok.scanKeyword(kw.name, scanOptions) || { videos: [] }
                    const videos = result.videos || []
                    videos.forEach((v: any) => v.source = { type: 'keyword', name: kw.name })
                    newVideos.push(...videos)
                } catch (err: any) {
                    if (err.message && err.message.includes('CAPTCHA')) {
                        applyCampaignEvent(job.campaign_id, 'CAPTCHA_DETECTED')
                        throw err
                    }
                }
            }
        }

        // Processing New Videos
        const uniqueVideos = Array.from(new Map(newVideos.map(v => [v.id, v])).values())
        if (uniqueVideos.length > 0) {
            console.log(`[MONITOR_DEBUG] Found ${uniqueVideos.length} new videos.`)
            let scheduleTime = new Date()

            for (const v of uniqueVideos) {
                // Check if already processed
                const exists = storageService.get("SELECT id FROM videos WHERE platform_id = ?", [v.id])
                if (exists) continue

                const sourceConfig = data.sources?.channels?.find((c: any) => c.name === v.source?.name) ||
                    data.sources?.keywords?.find((k: any) => k.name === v.source?.name) || {}

                if (sourceConfig.autoSchedule !== false) {
                    storageService.run(
                        `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'DOWNLOAD', 'queued', ?, ?)`,
                        [
                            job.campaign_id,
                            scheduleTime.toISOString(),
                            JSON.stringify({
                                url: v.url, platform_id: v.platform_id || v.id, video_id: v.id,
                                description: v.desc || v.description, source: v.source, editPipeline: data.editPipeline,
                                advancedVerification: data.advancedVerification, status: `Queued`, targetAccount: targetAccounts[0]
                            })
                        ]
                    )
                } else {
                    storageService.run(
                        `INSERT OR REPLACE INTO videos (platform_id, campaign_id, data_json, status) VALUES (?, ?, ?, 'pending_review')`,
                        [v.platform_id || v.id, job.campaign_id, JSON.stringify({ ...v, source: v.source }), 'pending_review']
                    )
                    applyCampaignEvent(job.campaign_id, 'NEEDS_REVIEW')
                }
            }
        }

        // Loop execution
        const campaign = storageService.get('SELECT status FROM campaigns WHERE id = ?', [job.campaign_id])
        if (campaign && campaign.status !== 'paused' && campaign.status !== 'finished') {
            storageService.run(
                `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'MONITOR', 'queued', ?, ?)`,
                [
                    job.campaign_id,
                    new Date(Date.now() + intervalMinutes * 60000).toISOString(),
                    JSON.stringify({ ...data, lastScannedAt: new Date().toISOString() })
                ]
            )
        }
    }


    private async handleExecutePipeline(job: any, data: any, tiktok: TikTokModule) {
        let finalPath = data.video_path || '';
        let publishResult: any = null;

        // Step 1: Download job handling
        if (job.type === 'DOWNLOAD' && (job.status === 'download_retry' || job.status === 'download_failed' || job.status === 'downloading' || job.status === 'queued' || job.status === 'scheduled')) {
            this.updateJobData(job.id, { ...data, status: 'Downloading video...' })
            console.log(`[JobQueue] [DOWNLOAD] Initiating download for URL: ${data.url} (Platform ID: ${data.platform_id})`)

            try {
                const { filePath, cached, meta } = await tiktok.downloadVideo(data.url, data.platform_id)

                // CRITICAL FIX: If video doesn't exist (because handleScan didn't insert it), create it now!
                let video = storageService.get("SELECT id, metadata, description FROM videos WHERE platform_id = ?", [data.platform_id])
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
                            const isPlaceholder = oldDesc === 'No description' || oldDesc === ''

                            if (newDesc && newDesc !== 'No description') {
                                if (newDesc !== oldDesc || isPlaceholder) {
                                    console.log(`[DEBUG_DESC] Updating video caption in DB.`)
                                    storageService.run("UPDATE videos SET description = ? WHERE id = ?", [newDesc, video.id])
                                    data.description = newDesc // Update job data's description
                                }
                            }
                        }
                        if (meta.author) {
                            dbMeta = { ...dbMeta, author: meta.author }
                            storageService.run("UPDATE videos SET metadata = ? WHERE id = ?", [JSON.stringify(dbMeta), video.id])
                        }
                    }
                    storageService.run("UPDATE videos SET local_path = ?, status = 'downloaded' WHERE id = ?", [filePath, video.id])
                }

                finalPath = filePath
                data.video_path = filePath

                this.updateJobStatus(job.id, 'downloaded', data)
                job.status = 'downloaded' // advance state

                console.log(`[JobQueue] [DOWNLOAD] Completed. Queuing PUBLISH job.`)
                storageService.run(
                    `INSERT INTO jobs (campaign_id, parent_job_id, type, status, data_json) VALUES (?, ?, 'PUBLISH', 'queued', ?)`,
                    [job.campaign_id, job.id, JSON.stringify({ ...data, status: 'Queued to publish' })]
                )
                return null // Download complete, wait for PUBLISH job
            } catch (e: any) {
                this.updateJobStatus(job.id, 'download_failed')
                throw e
            }
        }

        // Step 2: Edit (Part of PUBLISH phase now)
        if (job.type === 'PUBLISH' && (job.status === 'edit_retry' || job.status === 'edit_failed' || job.status === 'queued' || job.status === 'scheduled' || job.status === 'editing')) {
            this.updateJobData(job.id, { ...data, status: 'Processing video (AI editing)...' })

            try {
                const campaign = storageService.get('SELECT * FROM campaigns WHERE id = ?', [job.campaign_id])
                if (campaign && campaign.config_json) {
                    const config = JSON.parse(campaign.config_json)
                    if (config.editPipeline && config.editPipeline.effects && config.editPipeline.effects.length > 0) {
                        const { videoEditEngine } = require('./video-edit/VideoEditEngine')
                        const processedPath = finalPath.replace('.mp4', '_edited.mp4')
                        await videoEditEngine.render(finalPath, config.editPipeline, processedPath)
                        finalPath = processedPath
                        data.video_path = finalPath
                    }
                }
                this.updateJobStatus(job.id, 'edited', data)
                job.status = 'edited'
            } catch (e: any) {
                this.updateJobStatus(job.id, 'edit_failed')
                throw e
            }
        }

        // Step 3: Publish
        if (job.type === 'PUBLISH' && (job.status === 'publish_retry' || job.status === 'publish_failed' || job.status === 'edited' || job.status === 'publishing')) {
            this.updateJobData(job.id, { ...data, status: 'Preparing publication...' })

            try {
                let accountId = data.targetAccount
                const acc = storageService.get('SELECT username, display_name FROM publish_accounts WHERE id = ?', [accountId])

                let captionPattern = data.customCaption // Use customCaption if present
                if (captionPattern === undefined || captionPattern === null) {
                    // Fallback to campaign template if no custom caption
                    const campaign = storageService.get('SELECT config_json FROM campaigns WHERE id = ?', [job.campaign_id])
                    if (campaign && campaign.config_json) {
                        const config = JSON.parse(campaign.config_json)
                        if (config.captionTemplate) captionPattern = config.captionTemplate
                    }
                }
                // If still no pattern, use original description
                if (captionPattern === undefined || captionPattern === null) {
                    captionPattern = data.description || ''
                }

                // Ensure no "No description" leaks
                const originalDescription = (data.description === 'No description' ? '' : data.description) || ''

                const finalCaption = CaptionGenerator.generate(captionPattern, {
                    original: originalDescription,
                    time: new Date(),
                    author: data.source?.name || 'user'
                })

                const cookies = publishAccountService.getAccountCookies(Number(accountId))
                if (!cookies || cookies.length === 0) throw new Error(`No valid cookies for account ${accountId}.`)

                this.updateJobData(job.id, { ...data, status: `Publishing to @${acc?.username || 'account'}...` })

                const result = await tiktok.publishVideo(
                    finalPath,
                    finalCaption,
                    cookies,
                    (msg) => this.updateJobData(job.id, { ...data, status: msg }),
                    { advancedVerification: data.advancedVerification, username: acc?.username }
                )

                if (!result.success) {
                    if (result.debugArtifacts) {
                        storageService.run("UPDATE jobs SET result_json = ? WHERE id = ?", [
                            JSON.stringify({ error: result.error, debugArtifacts: result.debugArtifacts }), job.id
                        ])
                    }
                    throw new Error(result.error || 'Upload failed')
                }

                publishResult = result
                // record success
                storageService.run("UPDATE jobs SET result_json = ?, metadata = ? WHERE id = ?", [
                    JSON.stringify({
                        account: acc?.username,
                        video_path: finalPath,
                        video_url: result.videoUrl,
                        video_id: result.videoId,
                        published_at: new Date().toISOString(),
                        is_reviewing: result.isReviewing
                    }),
                    JSON.stringify({ publish_url: result.videoUrl, publish_id: result.videoId }),
                    job.id
                ])

                // Update video status in DB
                if (data.platform_id) {
                    storageService.run("UPDATE videos SET status = 'published' WHERE platform_id = ?", [data.platform_id])
                }

                if (result.isReviewing && result.videoId) {
                    this.startBackgroundStatusCheck(result.videoId, job.id, acc?.username)
                }
            } catch (e: any) {
                this.updateJobStatus(job.id, 'publish_failed')
                throw e
            }
        }

        return publishResult
    }


    private checkCampaignCompletion(campaignId: number) {
        try {
            // Check for any pending or running jobs (SCAN, EXECUTE)
            const activeJobs = storageService.get(
                "SELECT COUNT(*) as count FROM jobs WHERE campaign_id = ? AND status IN ('queued', 'scheduled', 'downloading', 'edited', 'editing', 'publishing', 'running', 'pending')",
                [campaignId]
            ).count

            if (activeJobs > 0) {
                console.log(`[CampaignCheck] ID: ${campaignId} has ${activeJobs} active/queued jobs. Skipping.`)
                return
            }

            const campaign = storageService.get('SELECT * FROM campaigns WHERE id = ?', [campaignId])
            if (!campaign) return

            const config = JSON.parse(campaign.config_json || '{}')
            const hasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)

            // Safety: If campaign has sources, require at least 1 completed PUBLISH job
            // to avoid marking as finished before the pipeline runs.
            if (hasSources) {
                const completedPublish = storageService.get(
                    "SELECT COUNT(*) as count FROM jobs WHERE campaign_id = ? AND type = 'PUBLISH' AND status IN ('published', 'uploaded', 'completed')",
                    [campaignId]
                ).count
                if (completedPublish === 0) {
                    console.log(`[CampaignCheck] ID: ${campaignId} No completed PUBLISH jobs yet. Waiting for pipeline to finish.`)
                    return
                }
            }

            // Check if ALL sources have determinate video counts
            // Determinate = history_only, or custom_range with endDate
            // Indeterminate = future_only, history_and_future, custom_range without endDate
            const allSources = [
                ...(config.sources?.channels || []),
                ...(config.sources?.keywords || [])
            ]
            const isDeterminate = !hasSources || allSources.every((src: any) => {
                const mode = src.timeRange
                if (!mode || mode === 'future_only' || mode === 'history_and_future') return false
                if (mode === 'custom_range' && !src.endDate) return false
                return true
            })

            console.log(`[CampaignCheck] ID: ${campaignId} Pending: 0 HasSources: ${hasSources} isDeterminate: ${isDeterminate}`)

            if (isDeterminate || !hasSources) {
                // All videos are finite and all published → campaign finished
                storageService.run("UPDATE campaigns SET status = 'finished' WHERE id = ?", [campaignId])
                console.log(`Campaign ${campaignId} finished (all jobs complete, determinate video count).`)

                try {
                    const stats = campaignService.getCampaignStats(campaignId)
                    notificationService.notifyCampaignComplete(campaign.name, stats)
                } catch (e) { /* ignore */ }
            } else {
                // Indeterminate sources → keep active, waiting for next scan (monitoring)
                console.log(`Campaign ${campaignId} stays active → Monitoring mode (waiting for new videos via next scan).`)
            }
        } catch (e) {
            console.error('Error checking campaign completion:', e)
        }
    }

    private updateJobStatus(jobId: number, status: string, data?: any) {
        try {
            if (data) {
                storageService.run("UPDATE jobs SET status = ?, data_json = ? WHERE id = ?", [status, JSON.stringify(data), jobId])
            } else {
                storageService.run("UPDATE jobs SET status = ? WHERE id = ?", [status, jobId])
            }
            this.broadcastUpdate()
        } catch (e) {
            console.error('Failed to update job status:', e)
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
