import { storageService } from './StorageService'

export interface CampaignConfig {
    sources: {
        channels: { name: string }[]
        keywords: { name: string }[]
    }
    videos: {
        id: string
        url: string
        description: string
        thumbnail: string
        stats: { views: number; likes: number; comments: number }
        channelName?: string
    }[]
    postOrder: 'oldest' | 'newest' | 'most_likes' | 'least_likes'
    editPipeline: any
    targetAccounts: string[]
    schedule: any
}

class CampaignService {

    getAll() {
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
            `INSERT INTO campaigns (name, platform, type, status, schedule_cron, config_json) 
             VALUES (?, ?, ?, 'active', ?, ?)`,
            [name, 'tiktok', type, cron, JSON.stringify(config)]
        )
    }

    updateStatus(id: number, status: 'active' | 'paused') {
        return storageService.run('UPDATE campaigns SET status = ? WHERE id = ?', [status, id])
    }

    updateConfig(id: number, config: any) {
        const json = JSON.stringify(config)
        // Also update source_config based on new config?
        // Ideally we keep source_config in sync or deprecate it.
        // For now, update config_json.
        return storageService.run('UPDATE campaigns SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [json, id])
    }

    delete(id: number) {
        // Delete associated jobs first?
        storageService.run('DELETE FROM jobs WHERE campaign_id = ?', [id])
        return storageService.run('DELETE FROM campaigns WHERE id = ?', [id])
    }

    getDueCampaigns() {
        return storageService.getAll("SELECT * FROM campaigns WHERE status = 'active'")
    }

    getCampaign(id: number) {
        return storageService.get('SELECT * FROM campaigns WHERE id = ?', [id])
    }
}

export const campaignService = new CampaignService()
