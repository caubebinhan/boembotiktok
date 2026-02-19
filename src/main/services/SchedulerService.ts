import { campaignService } from './CampaignService'
import { storageService } from './StorageService'

class SchedulerService {
    private intervalId: NodeJS.Timeout | null = null
    private readonly CHECK_INTERVAL = 60 * 1000 // Check every minute

    start() {
        if (this.intervalId) return
        console.log('SchedulerService started')
        this.intervalId = setInterval(() => this.checkAndSchedule(), this.CHECK_INTERVAL)
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
    }

    async checkAndSchedule() {
        console.log(`Scheduler: Checking active campaigns... System Time: ${new Date().toISOString()}`)
        const campaigns = campaignService.getDueCampaigns()

        for (const campaign of campaigns) {
            try {
                // Check Schedule Timing
                let config: any = {}
                try { config = campaign.config_json ? JSON.parse(campaign.config_json) : {} } catch { }

                console.log(`[Campaign ${campaign.id} "${campaign.name}"] Checking... Status: ${campaign.status}`)

                if (config.schedule && config.schedule.runAt) {
                    const runAtVal = config.schedule.runAt
                    const runAt = new Date(runAtVal)
                    const now = new Date()

                    console.log(`  > Schedule RunAt: ${runAtVal} (Parsed: ${runAt.toISOString()}) vs Now: ${now.toISOString()}`)

                    if (runAt > now) {
                        // Future campaign, skip
                        console.log(`  > Future campaign, skipping.`)
                        continue
                    }
                } else {
                    // No runAt set — campaign needs manual trigger or runAt to be configured
                    console.log(`  > No schedule.runAt found. Skipping (requires manual trigger or scheduler config).`)
                    continue
                }

                // Check if there's already a pending/running job for this campaign
                const existingJob = storageService.get(
                    "SELECT id, status, scheduled_for FROM jobs WHERE campaign_id = ? AND status IN ('pending', 'running') LIMIT 1",
                    [campaign.id]
                )
                if (existingJob) {
                    console.log(`  > Active Job Found: ID ${existingJob.id} (${existingJob.status}) Scheduled: ${existingJob.scheduled_for}. Skipping trigger.`)
                    continue
                }

                console.log(`[Scheduler] Triggering scheduled campaign ${campaign.name} (ID: ${campaign.id})`);
                const result = await this.triggerCampaign(campaign.id, false)

                // Advance RunAt for next cycle if successful
                if (result && result.success && config.schedule) {
                    const interval = parseInt(config.schedule.interval) || 60
                    const intervalMs = interval * 60000

                    // Logic: Next run = NOW + Interval (to avoid catching up on missed runs)
                    const nextRun = new Date(Date.now() + intervalMs)

                    config.schedule.runAt = nextRun.toISOString()

                    console.log(`Scheduler: Updating next run for campaign ${campaign.name} to ${config.schedule.runAt}`)
                    campaignService.updateConfig(campaign.id, config)
                } else {
                    console.log(`  > Trigger failed or no result:`, result)
                }

            } catch (err) {
                console.error(`Scheduler error for campaign ${campaign.id}:`, err)
            }
        }
    }



    async triggerCampaign(id: number, ignoreSchedule = false) {
        console.log(`Scheduler: Manual trigger for campaign ${id} (ignoreSchedule=${ignoreSchedule})`)
        const campaign = campaignService.getCampaign(id)
        if (!campaign) return { success: false, error: 'Campaign not found' }

        if (campaign.status === 'needs_captcha') {
            await campaignService.updateStatus(id, 'active')
            // Refresh campaign object
            campaign.status = 'active'
        }

        let config: any = {}
        try { config = campaign.config_json ? JSON.parse(campaign.config_json) : {} } catch { }

        const hasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)
        const hasVideos = (config.videos?.length > 0)

        if (!hasSources && !hasVideos) {
            console.log(`Scheduler: Campaign ${id} has no sources or videos to process`)
            return { success: false, error: 'No sources or videos configured' }
        }

        // Prevent duplicate runs
        // Prevent duplicate runs
        // If it's a manual run (ignoreSchedule=true), we want to pull a pending job forward if one exists.
        // If it's a scheduled check, we abort if anything is pending or running.

        const runningJob = storageService.get(
            "SELECT id FROM jobs WHERE campaign_id = ? AND status = 'running' LIMIT 1",
            [id]
        )
        if (runningJob) {
            console.log(`Scheduler: Campaign ${id} is already RUNNING (Job ${runningJob.id}). Skipping trigger.`)
            return { success: false, error: 'Campaign is already running', jobId: runningJob.id }
        }

        const pendingJob = storageService.get(
            "SELECT id, scheduled_for FROM jobs WHERE campaign_id = ? AND status = 'pending' ORDER BY scheduled_for ASC LIMIT 1",
            [id]
        )

        if (pendingJob) {
            if (ignoreSchedule) {
                // Manual override: Update the existing pending job to run NOW
                console.log(`Scheduler: Found pending job ${pendingJob.id} scheduled for ${pendingJob.scheduled_for}. Updating to run NOW due to manual trigger.`)
                const nowIso = new Date().toISOString()
                storageService.run("UPDATE jobs SET scheduled_for = ? WHERE id = ?", [nowIso, pendingJob.id])
                return { success: true, jobId: pendingJob.id, message: 'Existing pending job updated to run now' }
            } else {
                // Scheduled check: Just respect the existing pending job
                console.log(`Scheduler: Campaign ${id} already has a PENDING job (${pendingJob.id}). Skipping new trigger.`)
                return { success: false, error: 'Campaign already has pending job', jobId: pendingJob.id }
            }
        }

        const schedule = config.schedule || {}
        const intervalMinutes = parseInt(schedule.interval) || 15

        // Determine start time: use schedule.runAt or now
        let scheduleTime: Date
        if (!ignoreSchedule && schedule.runAt) {
            const runAt = new Date(schedule.runAt)
            scheduleTime = runAt > new Date() ? runAt : new Date()
        } else {
            // If ignoreSchedule is true OR no runAt set, start NOW
            scheduleTime = new Date()
        }

        // ── STRAEGY: Use Execution Order (Mixed) OR Default (Singles First) ────────
        // If executionOrder exists (from Drag & Drop UI), use it.
        // Otherwise, fall back to "Singles First" logic.

        let latestScheduledTime = new Date(scheduleTime)

        if (config.executionOrder && Array.isArray(config.executionOrder) && config.executionOrder.length > 0) {
            console.log(`Scheduler: Using custom execution order with ${config.executionOrder.length} items`)

            let currentScheduleTime = new Date(scheduleTime)

            // Helper parsing HH:mm
            const getMinutes = (timeStr: string) => {
                if (!timeStr) return null
                const [h, m] = timeStr.split(':').map(Number)
                return (h || 0) * 60 + (m || 0)
            }

            const dailyStart = getMinutes(schedule.startTime) ?? 9 * 60
            const dailyEnd = getMinutes(schedule.endTime) ?? 21 * 60
            const hasJitter = !!schedule.jitter

            // Helper to ensure valid time
            const ensureValidTime = (date: Date): Date => {
                let d = new Date(date)
                let currentMins = d.getHours() * 60 + d.getMinutes()

                if (currentMins < dailyStart) {
                    d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
                } else if (currentMins >= dailyEnd) {
                    d.setDate(d.getDate() + 1)
                    d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
                }
                return d
            }

            for (const item of config.executionOrder) {
                // 1. Ensure time is within valid daily window
                currentScheduleTime = ensureValidTime(currentScheduleTime)

                // 2. Use this time for the job
                // IF item has a specific time (from manual edit in UI), use it!
                // Backend should respect UI's calculated time (which includes Jitter/ActiveHours).
                // BUT we still need to validate/ensure it's not in the past? 
                // Creating jobs in the past runs them immediately. That's fine.
                let itemTime = new Date(currentScheduleTime)

                if (item.time) {
                    // Item time comes from UI (TimelineItem).
                    // If it's a valid date string/object, use it.
                    const manualTime = new Date(item.time)
                    if (!isNaN(manualTime.getTime())) {
                        itemTime = manualTime
                        // Sync currentScheduleTime to this manual time so subsequent relative items track correctly?
                        // OR do we assume the LIST is sequential?
                        // If we use manualTime, we should probably update currentScheduleTime to manualTime 
                        // so the NEXT item (calculated by duration) starts from here?
                        // YES. If user drags Item 3 to 10:00. Item 4 should be 10:05.
                        // But wait, the loop iterates `currentScheduleTime` independently.
                        // If `item.time` exists, we use it for THIS job.
                        // Should we update `currentScheduleTime`?
                        // If we do, then following items shift.
                        // But the UI *already* calculated the following items' times!
                        // So `item[next]` should also have `time` set?
                        // Yes! `SchedulePreview` updates ALL items' times.
                        // So we should ALWAYS use `item.time` if available.
                        // `currentScheduleTime` calculation is a fallback for items WITHOUT time (e.g. newly added or legacy params).

                        currentScheduleTime = manualTime
                    }
                }

                if (item.type === 'post' && item.video) {
                    const v = item.video
                    console.log(`[Scheduler] [Campaign ${id}] Creating DOWNLOAD job for ${v.id}.`);
                    console.log(`[Scheduler] [Campaign ${id}] Job Data:`, JSON.stringify({
                        url: v.url,
                        id: v.id,
                        captionTemplate: config.captionTemplate,
                        customCaption: item.customCaption
                    }, null, 2));
                    storageService.run(
                        `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'DOWNLOAD', 'pending', ?, ?)`,
                        [
                            id,
                            itemTime.toISOString(),
                            JSON.stringify({
                                url: v.url,
                                platform_id: v.platform_id || v.id,
                                video_id: v.id,
                                targetAccounts: config.targetAccounts || [],
                                description: v.description || '',
                                customCaption: item.customCaption, // Pass custom caption from execution item
                                thumbnail: v.thumbnail || '',
                                videoStats: v.stats || { views: 0, likes: 0 },
                                editPipeline: config.editPipeline,
                                advancedVerification: config.advancedVerification,
                                status: 'Waiting to download'
                            })
                        ]
                    )
                    // Mark video as scheduled (clear pending_review)
                    storageService.run("UPDATE videos SET status = 'scheduled' WHERE campaign_id = ? AND platform_id = ? AND status = 'pending_review'", [id, v.platform_id || v.id])
                } else if (item.type === 'scan' && item.sourceId) {
                    // Strict Check: ONLY create Scan job if sources exist in config
                    // Even if item is type 'scan', if config.sources is empty, it's invalid
                    const campaignHasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)

                    if (campaignHasSources) {
                        const sourceId = item.sourceId
                        // Find the source details
                        const channel = config.sources?.channels?.find((c: any) => c.name === sourceId)
                        const keyword = config.sources?.keywords?.find((k: any) => k.name === sourceId)

                        const singleSource = {
                            channels: channel ? [channel] : [],
                            keywords: keyword ? [keyword] : []
                        }

                        // Create SCAN job
                        // Use `itemTime` calculated above (respects manual edits)
                        const scheduledFor = itemTime.toISOString().replace('T', ' ').slice(0, 19)

                        const jobData = {
                            sources: singleSource,
                            videos: [],
                            postOrder: config.postOrder,
                            campaignName: campaign.name,
                            isPartialScan: true
                        }

                        console.log(`[Scheduler] [Campaign ${id}] Creating SCAN job for source: ${sourceId}`);
                        console.log(`[Scheduler] [Campaign ${id}] Scheduled for: ${scheduledFor}`);
                        storageService.run(
                            `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'SCAN', 'pending', ?, ?)`,
                            [id, scheduledFor, JSON.stringify(jobData)]
                        )
                    }
                } else {
                    // DOWNLOAD or PUBLISH
                    const video = item.video
                    if (video) {
                        const scheduledFor = itemTime.toISOString().replace('T', ' ').slice(0, 19) // SQLite format
                        console.log(`[DEBUG_DESC] Scheduler: Creating job for ${video.id} (Type: ${item.type}). Description: "${video.description}"`);
                        const jobData = {
                            video,
                            postOrder: config.postOrder,
                            campaignName: campaign.name,
                            advancedVerification: config.advancedVerification
                        }

                        const type = item.type === 'download' ? 'DOWNLOAD' : 'PUBLISH'

                        storageService.run(
                            `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, ?, 'pending', ?, ?)`,
                            [id, type, scheduledFor, JSON.stringify(jobData)]
                        )
                    }
                }

                // 3. Increment time for NEXT item
                let duration = intervalMinutes * 60000
                if (hasJitter) {
                    // Random factor: 0.5 to 1.5 (±50%)
                    const factor = 0.5 + Math.random()
                    duration = duration * factor
                }
                currentScheduleTime = new Date(currentScheduleTime.getTime() + duration)
            }

            // Note: Loops end here. The last scheduled time implies end of this batch.
            // If overlapping schedules occur, JobQueue manages concurrency.


        } else {
            // ── DEFAULT LEGACY LOGIC: Singles First, then Scans ──────────────────────

            // ── PHASE 1: Schedule single videos FIRST
            if (hasVideos) {
                console.log(`Scheduler: Scheduling ${config.videos.length} single videos starting at ${scheduleTime.toISOString()}`)
                for (const v of config.videos) {
                    storageService.run(
                        `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'DOWNLOAD', 'pending', ?, ?)`,
                        [
                            id,
                            scheduleTime.toISOString().replace('T', ' ').slice(0, 19),
                            JSON.stringify({
                                url: v.url,
                                platform_id: v.platform_id || v.id,
                                video_id: v.id,
                                targetAccounts: config.targetAccounts || [],
                                description: v.description || '',
                                thumbnail: v.thumbnail || '',
                                videoStats: v.stats || { views: 0, likes: 0 },
                                editPipeline: config.editPipeline,
                                advancedVerification: config.advancedVerification,
                                status: 'Waiting to download'
                            })
                        ]
                    )
                    scheduleTime = new Date(scheduleTime.getTime() + intervalMinutes * 60000)
                }
            }

            // ── PHASE 2: Schedule SCAN jobs AFTER single videos
            if (hasSources) {
                console.log(`Scheduler: Scheduling SCAN after singles, starting at ${scheduleTime.toISOString()}`)
                const jobData = {
                    sources: config.sources,
                    postOrder: config.postOrder || 'newest',
                    campaignName: campaign.name,
                    targetAccounts: config.targetAccounts || [],
                    editPipeline: config.editPipeline,
                    // Tell handleScan where to start scheduling scanned videos
                    nextScheduleTime: scheduleTime.toISOString(),
                    intervalMinutes,
                    advancedVerification: config.advancedVerification
                }

                storageService.run(
                    `INSERT INTO jobs (campaign_id, type, status, scheduled_for, data_json) VALUES (?, 'SCAN', 'pending', ?, ?)`,
                    [
                        id,
                        hasVideos ? scheduleTime.toISOString().replace('T', ' ').slice(0, 19) : null,
                        JSON.stringify(jobData)
                    ]
                )
            }
        }

        return { success: true }
    }
}

export const schedulerService = new SchedulerService()
