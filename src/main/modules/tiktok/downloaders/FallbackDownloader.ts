import { Page, Response } from 'playwright-core'
import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import { app } from 'electron'
import { browserService } from '../../../services/BrowserService'
import * as Sentry from '@sentry/electron/main'
import { DownloadResult } from '../types'

// ─── Puppeteer-based fallback downloader ──────────────────────────────────────

export class FallbackDownloader {
    /**
     * Download a TikTok video using Playwright network interception.
     * Used when the library-based extraction fails.
     */
    async download(url: string, filePath: string): Promise<DownloadResult> {
        console.log('[FallbackDownloader] Starting Puppeteer fallback download...')

        if (!browserService.isConnected()) {
            await browserService.init(true)
        }

        const page = await browserService.newPage()
        if (!page) throw new Error('Failed to create page for download')

        let videoStreamUrl = ''
        let largestVideoSize = 0
        let videoHeaders: any = {}
        let description = ''

        try {
            // 1. Setup Network Interception for video stream
            page.on('response', async (response: Response) => {
                const respUrl = response.url()
                const headers = await response.allHeaders()
                const contentType = headers['content-type'] || ''
                const contentLength = parseInt(headers['content-length'] || '0')

                const isVideo = contentType.includes('video/') ||
                    (respUrl.includes('video/tos') && contentLength > 1024 * 1024)

                if (isVideo && contentLength > 1 * 1024 * 1024) {
                    console.log(`[FallbackDownloader] Found video stream: ${respUrl} (${contentLength} bytes)`)
                    if (contentLength > largestVideoSize) {
                        largestVideoSize = contentLength
                        videoStreamUrl = respUrl
                        videoHeaders = await response.request().allHeaders()
                    }
                }
            })

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await page.waitForTimeout(5000)

            // 2. DOM fallback if no network intercept caught
            if (!videoStreamUrl) {
                videoStreamUrl = await page.evaluate(() => {
                    const video = document.querySelector('video')
                    return video ? video.src : ''
                })
            }

            // 3. Extract description
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
            console.log(`[FallbackDownloader] Description: "${description}"`)

        } catch (e) {
            Sentry.captureException(e, { tags: { module: 'tiktok', operation: 'FallbackDownloader' } })
            console.error('[FallbackDownloader] Extraction error:', e)
        } finally {
            await page.close()
        }

        if (!videoStreamUrl || videoStreamUrl.startsWith('blob:')) {
            throw new Error(`[FallbackDownloader] Failed to extract valid video URL. Got: ${videoStreamUrl || 'nothing'}`)
        }

        // 4. Download via Axios
        const downloadHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        }

        if (videoHeaders) {
            for (const [key, value] of Object.entries(videoHeaders)) {
                if (key.startsWith(':')) continue
                if (['host', 'connection', 'content-length', 'accept-encoding'].includes(key.toLowerCase())) continue
                downloadHeaders[key] = value as string
            }
        }

        const writer = fs.createWriteStream(filePath)
        const response = await axios({ url: videoStreamUrl, method: 'GET', responseType: 'stream', headers: downloadHeaders, timeout: 60000 })
        response.data.pipe(writer)

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                const stats = await fs.stat(filePath)
                if (stats.size < 50 * 1024) {
                    reject(new Error(`[FallbackDownloader] Downloaded file too small (${stats.size} bytes)`))
                } else {
                    resolve({ filePath, cached: false, meta: { description } })
                }
            })
            writer.on('error', reject)
        })
    }
}
