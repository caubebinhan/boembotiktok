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
                // Check if there's already a pending/running job for this campaign
                const existingJob = storageService.get(
                    "SELECT id FROM jobs WHERE campaign_id = ? AND status IN ('pending', 'running') LIMIT 1",
                    [campaign.id]
                )
                if (existingJob) {
                    console.log(`Scheduler: Campaign ${campaign.name} already has active jobs, skipping`)
                    continue
                }

                console.log(`Scheduler: Scheduling job for campaign ${campaign.name}`)
                this.createScanJob(campaign)
            } catch (err) {
                console.error(`Scheduler error for campaign ${campaign.id}:`, err)
            }
        }
    }

    private createScanJob(campaign: any) {
        let config: any = {}
        try {
            config = campaign.config_json ? JSON.parse(campaign.config_json) : {}
        } catch { }

        // Create a SCAN job with full config data (sources, postOrder, etc.)
        const jobData = {
            sources: config.sources || { channels: [], keywords: [] },
            videos: config.videos || [],
            postOrder: config.postOrder || 'newest',
            campaignName: campaign.name
        }

        storageService.run(
            `INSERT INTO jobs (campaign_id, type, status, data_json) VALUES (?, 'SCAN', 'pending', ?)`,
            [campaign.id, JSON.stringify(jobData)]
        )
    }

    async triggerCampaign(id: number) {
        console.log(`Scheduler: Manual trigger for campaign ${id}`)
        const campaign = campaignService.getCampaign(id)
        if (campaign) {
            this.createScanJob(campaign)
            return { success: true }
        }
        return { success: false, error: 'Campaign not found' }
    }
}

export const schedulerService = new SchedulerService()
