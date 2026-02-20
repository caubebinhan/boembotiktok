import { Downloader } from '@tobyg74/tiktok-api-dl'
import { browserService } from '../../../services/BrowserService'
import { VideoMetadata } from '../types'

// ─── Video metadata extractor (library + browser fallback) ───────────────────

export class MetadataExtractor {
    /**
     * Extract video metadata from URL.
     * Tries the @tobyg74 library first; falls back to Playwright DOM scraping.
     */
    async extract(url: string): Promise<VideoMetadata> {
        try {
            return await this.extractFromLibrary(url)
        } catch {
            return await this.extractFromBrowser(url)
        }
    }

    async extractFromLibrary(url: string): Promise<VideoMetadata> {
        const TIMEOUT = 60 * 1000
        let timeoutId: NodeJS.Timeout

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('TikTok library metadata timeout')), TIMEOUT)
        })

        // @ts-ignore
        const workPromise = Downloader(url, { version: 'v1' })
        const result = await Promise.race([workPromise, timeoutPromise]) as any
        clearTimeout(timeoutId!)

        if (result.status !== 'success' || !result.result) {
            throw new Error('Library extraction failed or returned no result')
        }

        return {
            description: result.result.desc || '',
            author: result.result.author ? {
                nickname: result.result.author.nickname,
                avatar: result.result.author.avatar,
            } : null,
        }
    }

    async extractFromBrowser(url: string): Promise<VideoMetadata> {
        console.log('[MetadataExtractor] Starting browser fallback metadata extraction...')
        if (!browserService.isConnected()) {
            await browserService.init(true)
        }

        const page = await browserService.newPage()
        if (!page) throw new Error('Failed to create page for metadata extraction')

        let description = ''
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

            try {
                await page.waitForSelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]', { timeout: 10000 })
            } catch {
                console.warn('[MetadataExtractor] Selector wait timeout, extracting immediately...')
            }

            description = await page.evaluate(() => {
                const descEl = document.querySelector('[data-e2e="browse-video-desc"]') ||
                    document.querySelector('[data-e2e="video-desc"]')
                if (descEl && descEl.textContent) return descEl.textContent.trim()

                const metaDesc = document.querySelector('meta[property="og:description"]')
                if (metaDesc) return metaDesc.getAttribute('content') || ''

                const title = document.querySelector('title')
                if (title) return (title as any).innerText.replace(' | TikTok', '').trim()
                return ''
            })
        } catch (e) {
            console.error('[MetadataExtractor] Browser extraction error:', e)
        } finally {
            await page.close()
        }

        return { description }
    }
}
