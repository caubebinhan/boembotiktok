import { browserService } from '../../../services/BrowserService'
import { storageService } from '../../../services/StorageService'
import * as Sentry from '@sentry/electron/main'
import { ScannerBase } from './ScannerBase'
import { CaptchaHelper } from '../helpers/CaptchaHelper'
import { DateParser } from '../helpers/DateParser'
import { ScanOptions, ScanResult } from '../types'

// ─── TikTok Keyword / Search Scanner ─────────────────────────────────────────

export class KeywordScanner extends ScannerBase {
    async scan(keyword: string, options: ScanOptions = {}): Promise<ScanResult> {
        if (this.isScanning) {
            console.warn('[KeywordScanner] Scan already in progress')
            return { videos: [] }
        }
        this.isScanning = true

        const maxVideos = options.limit === 'unlimited' ? 1000 : (options.limit || 50)
        console.log(`[KeywordScanner] Starting for: "${keyword}" (Max: ${maxVideos})`)

        await this.ensureBrowser()
        const page = await browserService.newPage()
        if (!page) return { videos: [] }

        await this.injectCookies(page, options.cookies || [], 'KeywordScanner')

        const foundVideos: any[] = []

        try {
            await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, { waitUntil: 'networkidle', timeout: 60000 })
            await this.handleCaptcha(page, `keyword_${keyword}`)

            const startDate = options.startDate ? new Date(options.startDate) : null
            const endDate = options.endDate ? new Date(options.endDate) : null

            const MAX_ROUNDS = options.limit === 'unlimited' ? 200 : Math.ceil(maxVideos / 10) + 5
            let prevCount = 0, rounds = 0

            // ─── Scroll Loop ───
            while (rounds < MAX_ROUNDS) {
                rounds++
                const currentCount = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length)

                if (currentCount >= maxVideos) { console.log(`[KeywordScanner] Reached limit at round ${rounds}`); break }

                console.log(`[KeywordScanner] Round ${rounds}/${MAX_ROUNDS}: ${currentCount}/${maxVideos}`)
                if (options.onProgress) options.onProgress(`Scanning round ${rounds}: found ${currentCount}/${maxVideos} videos...`)

                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                try { await page.waitForTimeout(2000 + Math.random() * 3000) } catch { break }

                if (currentCount === prevCount && currentCount > 0) { console.log('[KeywordScanner] No new videos. Stopping.'); break }
                prevCount = currentCount
            }

            // ─── Extract Data ───
            const videos = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a'))
                return anchors
                    .filter(a => a.href.includes('/video/') && !a.href.includes('/search'))
                    .map(a => {
                        const m = a.href.match(/\/video\/(\d+)/)
                        const container = a.closest('[data-e2e="search_top-item"]') || a.closest('div[class*="DivItemContainer"]') || a.parentElement
                        const dateEl = container?.querySelector('[data-e2e="search-card-video-time"]') || container?.querySelector('span[class*="-SpanTime"]')
                        return {
                            id: m ? m[1] : '',
                            url: a.href,
                            desc: a.textContent || '',
                            thumb: a.querySelector('img')?.src || '',
                            dateStr: dateEl ? dateEl.textContent : '',
                            stats: { views: '0', likes: '0', comments: '0' },
                        }
                    })
                    .filter(v => v.id)
            })

            // ─── Date filter ───
            const filtered = videos.filter(v => {
                if (!startDate && !endDate) return true
                const vDate = DateParser.parseVideoDate(v.dateStr || '')
                return DateParser.isInRange(vDate, startDate, endDate)
            })

            console.log(`[KeywordScanner] Date filter: ${videos.length} -> ${filtered.length}`)

            // ─── DB Insert ───
            const target: any[] = filtered.slice(0, maxVideos)
            for (const v of target) {
                const exists = storageService.get('SELECT id FROM videos WHERE platform_id = ?', [v.id])
                if (!exists) {
                    storageService.run(
                        `INSERT INTO videos (platform, platform_id, url, description, status, metadata) VALUES ('tiktok', ?, ?, ?, 'discovered', ?)`,
                        [v.id, v.url, v.desc, JSON.stringify({ thumbnail: v.thumb, stats: v.stats, keyword })]
                    )
                    const newId = storageService.get('SELECT last_insert_rowid() as id').id
                    foundVideos.push({ id: newId, url: v.url, platform_id: v.id, thumbnail: v.thumb, stats: v.stats })
                }
            }

            console.log(`[KeywordScanner] Done: ${foundVideos.length} new videos found.`)
            return { videos: foundVideos }

        } catch (error: any) {
            if (error.message === 'CAPTCHA_REQUIRED') throw error
            Sentry.captureException(error, { tags: { module: 'tiktok', operation: 'scanKeyword', keyword } })
            console.error('[KeywordScanner] Error:', error)
            return { videos: [] }
        } finally {
            await page.close()
            this.isScanning = false
        }
    }
}
