import { storageService } from './StorageService'

export interface CampaignConfig {
    source_ids: number[] // IDs of followed channels/keywords
    source_type: 'channel' | 'keyword'
}

class CampaignService {

    getAll() {
        // Includes a subquery or join to get recent job stats?
        // For MVP: Just get campaigns. The Progress Bar might need a separate 'get-active-campaign-stats' call 
        // OR we just count jobs for them.
        // Let's try to join with jobs.
        // "Progress" usually implies a specific "Run". Identifying "Runs" is tricky without a `run_id`.
        // Heuristic: Count pending/running jobs for this campaign.
        return storageService.getAll(`
            SELECT c.*, 
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.status IN ('pending', 'running')) as pending_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.created_at > datetime('now', '-1 day')) as total_recent
            FROM campaigns c 
            ORDER BY c.created_at DESC
        `)
    }

    create(name: string, type: string, cron: string, config: any) {
        return storageService.run(
            `INSERT INTO campaigns (name, type, status, schedule_cron, config_json) 
             VALUES (?, ?, 'active', ?, ?)`,
            [name, type, cron, JSON.stringify(config)]
        )
    }

    updateStatus(id: number, status: 'active' | 'paused') {
        return storageService.run('UPDATE campaigns SET status = ? WHERE id = ?', [status, id])
    }

    delete(id: number) {
        return storageService.run('DELETE FROM campaigns WHERE id = ?', [id])
    }

    getDueCampaigns() {
        // Simple logic: returns active campaigns. 
        // Real logic would parse Cron, but for MVP we might just loop all active 
        // and let the Scheduler decide if it's time (or just run every X minutes)
        return storageService.getAll("SELECT * FROM campaigns WHERE status = 'active'")
    }
}

export const campaignService = new CampaignService()
