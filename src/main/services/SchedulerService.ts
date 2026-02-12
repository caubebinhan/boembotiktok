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
        console.log('Scheduler: Checking active campaigns...')
        const campaigns = campaignService.getDueCampaigns()

        for (const campaign of campaigns) {
            try {
                // Check if a job is already running for this campaign to prevent overlap?
                // For MVP, simplistic check: don't spawn if there's a PENDING/RUNNING generic scan job
                // Actually, let's just spawn. Queue handles concurrency.

                // For MVP: Treat "Active" as "Run now" if we rely on the 1-min interval
                // Or implement simple cron check. 
                // Let's assume for now: Every active campaign runs every check cycle (temporary for testing)
                // TODO: Implement actual cron parsing check.

                console.log(`Scheduler: Scheduling job for campaign ${campaign.name}`)
                this.createScanJob(campaign)

            } catch (err) {
                console.error(`Scheduler error for campaign ${campaign.id}:`, err)
            }
        }
    }

    private createScanJob(campaign: any) {
        // Insert a SCAN job
        storageService.run(
            `INSERT INTO jobs (campaign_id, type, status, data_json) VALUES (?, 'SCAN', 'pending', ?)`,
            [campaign.id, campaign.config_json]
        )
    }
    async triggerCampaign(id: number) {
        console.log(`Scheduler: Manual trigger for campaign ${id}`)
        const campaign = storageService.get('SELECT * FROM campaigns WHERE id = ?', [id])
        if (campaign) {
            this.createScanJob(campaign)
            return { success: true }
        }
        return { success: false, error: 'Campaign not found' }
    }
}

export const schedulerService = new SchedulerService()
