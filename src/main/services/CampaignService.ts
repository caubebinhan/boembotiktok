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
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'SCAN' AND j.status = 'completed') as scanned_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'PUBLISH' AND j.status = 'completed') as published_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.status = 'failed') as failed_count,
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

    clone(id: number) {
        const original = storageService.get('SELECT * FROM campaigns WHERE id = ?', [id])
        if (!original) throw new Error('Campaign not found')

        const newName = `${original.name} (Copy)`
        return storageService.run(
            `INSERT INTO campaigns (name, platform, type, status, schedule_cron, config_json, created_at) 
             VALUES (?, ?, ?, 'paused', ?, ?, CURRENT_TIMESTAMP)`,
            [newName, original.platform, original.type, original.schedule_cron, original.config_json]
        )
    }

    getCampaign(id: number) {
        return storageService.get('SELECT * FROM campaigns WHERE id = ?', [id])
    }

    async getCampaignStats(id: number) {
        const jobStats = await storageService.get(`
            SELECT 
                COUNT(CASE WHEN type = 'SCAN' AND status = 'completed' THEN 1 END) as scans_completed,
                COUNT(CASE WHEN type = 'DOWNLOAD' AND status = 'completed' THEN 1 END) as downloads_completed,
                COUNT(CASE WHEN type = 'DOWNLOAD' AND status = 'pending' THEN 1 END) as downloads_pending,
                COUNT(CASE WHEN type = 'PUBLISH' AND status = 'completed' THEN 1 END) as publishes_completed,
                COUNT(CASE WHEN type = 'PUBLISH' AND status = 'pending' THEN 1 END) as publishes_pending,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as total_failed
            FROM jobs 
            WHERE campaign_id = ?
        `, [id])

        return {
            scanned: jobStats?.scans_completed || 0,
            downloaded: jobStats?.downloads_completed || 0,
            scheduled: jobStats?.downloads_pending || 0,
            published: jobStats?.publishes_completed || 0,
            failed: jobStats?.total_failed || 0
        }
    }

    async getScheduledJobs(start: string, end: string) {
        return storageService.getAll(`
            SELECT j.*, c.name as campaign_name, c.config_json
            FROM jobs j
            LEFT JOIN campaigns c ON j.campaign_id = c.id
            WHERE j.scheduled_for >= ? AND j.scheduled_for <= ?
            ORDER BY j.scheduled_for ASC
        `, [start, end])
    }

    getCampaignJobs(id: number) {
        return storageService.getAll(`
            SELECT j.*, c.name as campaign_name 
            FROM jobs j
            LEFT JOIN campaigns c ON j.campaign_id = c.id
            WHERE j.campaign_id = ?
            ORDER BY j.created_at DESC
            LIMIT 100
        `, [id])
    }
}

export const campaignService = new CampaignService()
