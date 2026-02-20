import { PlatformModule } from '../../services/ModuleManager'
import { storageService } from '../../services/StorageService'
import axios from 'axios'
import * as Sentry from '@sentry/electron/main'

// ─── Sub-modules ──────────────────────────────────────────────────────────────
import { ProfileScanner } from './scanners/ProfileScanner'
import { KeywordScanner } from './scanners/KeywordScanner'
import { VideoDownloader } from './downloaders/VideoDownloader'
import { VideoPublisher } from './publishers/VideoPublisher'

// ─── Types ────────────────────────────────────────────────────────────────────
export type { ScanOptions, ScanResult, DownloadResult, PublishResult, PublishOptions } from './types'

// ─── TikTokModule: thin entry point ──────────────────────────────────────────

export class TikTokModule implements PlatformModule {
    name = 'TikTok'
    id = 'tiktok'

    private profileScanner = new ProfileScanner()
    private keywordScanner = new KeywordScanner()
    private videoDownloader = new VideoDownloader()
    private videoPublisher = new VideoPublisher()

    async initialize(): Promise<void> {
        console.log('TikTokModule initializing...')
    }

    async shutdown(): Promise<void> {
        console.log('TikTokModule shutting down...')
    }

    // ─── Scanning ─────────────────────────────────────────────────────────────

    async scanProfile(username: string, options: any = {}): Promise<any> {
        return this.profileScanner.scan(username, options)
    }

    async scanKeyword(keyword: string, options: any = {}): Promise<any> {
        return this.keywordScanner.scan(keyword, options)
    }

    // ─── Download ─────────────────────────────────────────────────────────────

    async downloadVideo(url: string, platformId: string): Promise<any> {
        return this.videoDownloader.download(url, platformId)
    }

    // ─── Publish ──────────────────────────────────────────────────────────────

    async publishVideo(
        filePath: string,
        caption: string,
        cookies?: any[],
        onProgress?: (msg: string) => void,
        options?: any
    ): Promise<any> {
        return this.videoPublisher.publish(filePath, caption, cookies || [], onProgress, options)
    }

    // ─── Video Management ─────────────────────────────────────────────────────

    async addVideo(url: string): Promise<void> {
        console.log(`[TikTokModule] Adding single video: ${url}`)
        const idMatch = url.match(/\/video\/(\d+)/)
        if (!idMatch) throw new Error('Invalid TikTok video URL')
        const id = idMatch[1]

        const exists = storageService.get('SELECT id FROM videos WHERE platform = ? AND platform_id = ?', ['tiktok', id])
        if (!exists) {
            storageService.run(
                `INSERT INTO videos (platform, platform_id, url, description, status, metadata) VALUES (?, ?, ?, ?, 'discovered', ?)`,
                ['tiktok', id, url, '', JSON.stringify({ manual: true })]
            )
            console.log(`[TikTokModule] Added video: ${id}`)
        } else {
            console.warn(`[TikTokModule] Video ${id} already exists`)
        }
    }

    async removeVideo(id: number): Promise<void> {
        storageService.run('DELETE FROM videos WHERE id = ?', [id])
        console.log(`[TikTokModule] Removed video: ${id}`)
    }

    async removeAllVideos(): Promise<void> {
        storageService.run('DELETE FROM videos WHERE platform = ?', ['tiktok'])
        console.log('[TikTokModule] Removed all TikTok videos')
    }

    async checkVideosExistence(ids: string[]): Promise<string[]> {
        if (ids.length === 0) return []
        const placeholders = ids.map(() => '?').join(',')
        const rows = storageService.getAll(
            `SELECT platform_id FROM videos WHERE platform = 'tiktok' AND platform_id IN (${placeholders})`, ids
        )
        return rows.map((r: any) => r.platform_id)
    }

    async getCollection(): Promise<any[]> {
        return storageService.getAll(
            `SELECT id, platform, platform_id, url, description, status, metadata, created_at FROM videos WHERE platform = 'tiktok' ORDER BY created_at DESC`
        )
    }

    // ─── Source Management ────────────────────────────────────────────────────

    async addAccount(username: string, filterCriteria?: string, metadata?: any): Promise<void> {
        const exists = storageService.get('SELECT id FROM accounts WHERE platform = ? AND username = ?', ['tiktok', username])
        if (!exists) {
            storageService.run(
                `INSERT INTO accounts (platform, username, role, session_valid, proxy_url, metadata) VALUES ('tiktok', ?, 'target', 1, ?, ?)`,
                [username, filterCriteria || '{}', metadata ? JSON.stringify(metadata) : null]
            )
        } else {
            storageService.run(
                `UPDATE accounts SET proxy_url = ?, metadata = ? WHERE platform = 'tiktok' AND username = ?`,
                [filterCriteria || '{}', metadata ? JSON.stringify(metadata) : null, username]
            )
        }
        console.log(`[TikTokModule] Account upserted: @${username}`)
    }

    async addKeyword(keyword: string, filterCriteria?: string): Promise<void> {
        const exists = storageService.get('SELECT id FROM keywords WHERE platform = ? AND keyword = ?', ['tiktok', keyword])
        if (!exists) {
            storageService.run(
                `INSERT INTO keywords (platform, keyword, filter_criteria) VALUES ('tiktok', ?, ?)`,
                [keyword, filterCriteria || '{}']
            )
        } else {
            storageService.run(
                `UPDATE keywords SET filter_criteria = ? WHERE platform = 'tiktok' AND keyword = ?`,
                [filterCriteria || '{}', keyword]
            )
        }
        console.log(`[TikTokModule] Keyword upserted: "${keyword}"`)
    }

    async getSources(): Promise<{ channels: any[]; keywords: any[] }> {
        const channels = storageService.getAll(
            `SELECT id, platform, username, proxy_url as filter_criteria, created_at FROM accounts WHERE platform = 'tiktok' AND role = 'target' ORDER BY created_at DESC`
        )
        const keywords = storageService.getAll(
            `SELECT id, platform, keyword, filter_criteria, created_at FROM keywords WHERE platform = 'tiktok' ORDER BY created_at DESC`
        )
        return { channels, keywords }
    }

    async removeSource(type: 'channel' | 'keyword', id: number): Promise<void> {
        if (type === 'channel') {
            storageService.run('DELETE FROM accounts WHERE id = ?', [id])
        } else {
            storageService.run('DELETE FROM keywords WHERE id = ?', [id])
        }
        console.log(`[TikTokModule] Removed ${type}: ${id}`)
    }

    // ─── Video Status & Stats ─────────────────────────────────────────────────

    async checkVideoStatus(videoId: string, username: string): Promise<'public' | 'private' | 'unavailable'> {
        try {
            const url = `https://www.tiktok.com/@${username}/video/${videoId}`
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                validateStatus: () => true
            })

            if (response.status === 429) {
                try { const { jobQueue } = require('../../services/JobQueue'); jobQueue.setGlobalThrottle(15) } catch { }
                return 'private'
            }
            if (response.status === 404) return 'unavailable'
            if (response.status === 200) {
                if (response.data.includes('Video currently unavailable') || response.data.includes('not_found')) return 'private'
                return 'public'
            }
            return 'private'
        } catch (e) {
            console.error('[TikTokModule] checkVideoStatus failed:', e)
            return 'unavailable'
        }
    }

    async refreshVideoStats(videoId: string, username: string): Promise<any> {
        try {
            const url = `https://www.tiktok.com/@${username}/video/${videoId}`
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 60000
            })

            if (response.status === 200) {
                const html = response.data
                const stats = {
                    likes: parseInt((html.match(/"diggCount":(\d+)/) || [])[1] || '0'),
                    views: parseInt((html.match(/"playCount":(\d+)/) || [])[1] || '0'),
                    comments: parseInt((html.match(/"commentCount":(\d+)/) || [])[1] || '0'),
                }
                const video = storageService.get('SELECT id, metadata FROM videos WHERE platform_id = ?', [videoId])
                if (video) {
                    const meta = JSON.parse(video.metadata || '{}')
                    meta.stats = stats
                    storageService.run('UPDATE videos SET metadata = ? WHERE id = ?', [JSON.stringify(meta), video.id])
                    return stats
                }
            }
        } catch (e) {
            Sentry.captureException(e, { tags: { module: 'tiktok', operation: 'refreshVideoStats' } })
            console.error('[TikTokModule] refreshVideoStats failed:', e)
        }
        return null
    }
}
