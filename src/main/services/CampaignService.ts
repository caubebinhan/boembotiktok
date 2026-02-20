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
    advancedVerification?: boolean
    autoSchedule?: boolean
}

class CampaignService {

    getAll() {
        return storageService.getAll(`
            SELECT c.*, 
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.status IN ('queued', 'scheduled')) as queued_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'EXECUTE' AND j.status IN ('downloading', 'editing')) as preparing_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'EXECUTE' AND j.status = 'publishing') as uploading_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'EXECUTE' AND j.status = 'published') as published_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'EXECUTE' AND j.status = 'downloaded') as downloaded_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.status LIKE '%_failed') as failed_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.status IN ('skipped', 'cancelled')) as skipped_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'SCAN' AND j.status = 'running') as scanning_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'SCAN' AND j.status IN ('queued', 'scheduled', 'pending')) as scan_pending_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.type = 'SCAN' AND j.status = 'completed') as scanned_count,
            (SELECT COUNT(*) FROM jobs j WHERE j.campaign_id = c.id AND j.created_at > datetime('now', '-1 day')) as total_recent
            FROM campaigns c 
            ORDER BY c.created_at DESC
        `)
    }

    create(name: string, type: string, cron: string, config: any) {
        console.log(`[CampaignService] Creating campaign: "${name}" | Type: ${type} | Cron: ${cron}`);
        console.log(`[CampaignService] Initial Config:`, JSON.stringify(config, null, 2));
        return storageService.run(
            `INSERT INTO campaigns (name, platform, type, status, schedule_cron, config_json) 
             VALUES (?, ?, ?, 'active', ?, ?)`,
            [name, 'tiktok', type, cron, JSON.stringify(config)]
        )
    }

    updateStatus(id: number, status: 'active' | 'paused' | 'needs_captcha' | 'finished') {
        console.log(`[CampaignService] Updating status of campaign #${id} to: ${status}`);
        return storageService.run('UPDATE campaigns SET status = ? WHERE id = ?', [status, id])
    }

    updateConfig(id: number, config: any) {
        const json = JSON.stringify(config)
        console.log(`[CampaignService] Updating config for campaign #${id}. New Config:`, JSON.stringify(config, null, 2));
        // Reset 'needs_review' status to 'active' on save
        storageService.run("UPDATE campaigns SET status = 'active' WHERE id = ? AND status = 'needs_review'", [id])
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
                COUNT(CASE WHEN status IN ('queued', 'scheduled') THEN 1 END) as total_queued,
                COUNT(CASE WHEN type = 'EXECUTE' AND status IN ('downloading', 'editing') THEN 1 END) as total_preparing,
                COUNT(CASE WHEN type = 'EXECUTE' AND status = 'publishing' THEN 1 END) as total_uploading,
                COUNT(CASE WHEN type = 'EXECUTE' AND status = 'published' THEN 1 END) as total_published,
                COUNT(CASE WHEN status LIKE '%_failed' THEN 1 END) as total_failed,
                COUNT(CASE WHEN status IN ('skipped', 'cancelled') THEN 1 END) as total_skipped,
                COUNT(CASE WHEN type = 'EXECUTE' AND status = 'downloaded' THEN 1 END) as total_downloaded
            FROM jobs 
            WHERE campaign_id = ?
        `, [id])

        return {
            queued: jobStats?.total_queued || 0,
            preparing: jobStats?.total_preparing || 0,
            uploading: jobStats?.total_uploading || 0,
            published: jobStats?.total_published || 0,
            failed: jobStats?.total_failed || 0,
            skipped: jobStats?.total_skipped || 0,
            downloaded: jobStats?.total_downloaded || 0
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
