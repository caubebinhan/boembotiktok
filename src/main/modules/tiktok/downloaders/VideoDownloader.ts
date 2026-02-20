import { Downloader } from '@tobyg74/tiktok-api-dl'
import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'
import { DownloadResult } from '../types'
import { MetadataExtractor } from './MetadataExtractor'
import { FallbackDownloader } from './FallbackDownloader'

// ─── Primary video downloader ─────────────────────────────────────────────────

export class VideoDownloader {
    private metadataExtractor = new MetadataExtractor()
    private fallbackDownloader = new FallbackDownloader()

    async download(url: string, platformId: string): Promise<DownloadResult> {
        console.log(`[VideoDownloader] Downloading: ${url}`)

        // E2E mock
        if (url.includes('@test/video')) {
            console.log('[VideoDownloader] Mock download for E2E test.')
            const mockPath = path.join(app.getPath('userData'), 'mock_video_e2e.mp4')
            if (!fs.existsSync(mockPath)) fs.writeFileSync(mockPath, 'fake video content')
            return { filePath: mockPath, cached: false }
        }

        const downloadsDir = path.join(app.getPath('userData'), 'downloads', 'tiktok')
        await fs.ensureDir(downloadsDir)
        const filePath = path.join(downloadsDir, `tiktok_${platformId}.mp4`)

        let videoStreamUrl = ''
        const downloadHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        }
        let meta = { description: '', author: null as any }

        // Phase 1: Extract stream URL via library
        try {
            console.log('[VideoDownloader] Extracting via @tobyg74 library...')
            const TIMEOUT = 60 * 1000
            let timeoutId: NodeJS.Timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Library extraction timed out after 60s')), TIMEOUT)
            })
            // @ts-ignore
            const result = await Promise.race([Downloader(url, { version: 'v1' }), timeoutPromise]) as any
            clearTimeout(timeoutId!)

            if (result.status === 'success' && result.result) {
                const videoData = result.result.video
                if (videoData) {
                    if (Array.isArray(videoData.playAddr) && videoData.playAddr.length > 0) {
                        videoStreamUrl = videoData.playAddr[0]
                    } else if (typeof videoData.playAddr === 'string') {
                        videoStreamUrl = videoData.playAddr
                    }
                }
                meta = {
                    description: result.result.desc || '',
                    author: result.result.author ? {
                        nickname: result.result.author.nickname,
                        avatar: result.result.author.avatar,
                    } : null,
                }
            }

            if (!videoStreamUrl) throw new Error('No stream URL from library')

            // Phase 1b: Fallback metadata if desc missing
            if (!meta.description) {
                try {
                    const fallbackMeta = await this.metadataExtractor.extractFromBrowser(url)
                    if (fallbackMeta.description) {
                        meta.description = fallbackMeta.description
                        console.log(`[VideoDownloader] Got description via browser fallback`)
                    }
                } catch (e: any) {
                    console.error('[VideoDownloader] Metadata browser fallback failed:', e.message)
                }
            }

        } catch (e: any) {
            Sentry.captureException(e, { tags: { module: 'tiktok', operation: 'downloadVideo_library', url } })
            console.error('[VideoDownloader] Library extraction failed:', e.message)
            console.log('[VideoDownloader] Redirecting to Puppeteer fallback...')
            return this.fallbackDownloader.download(url, filePath)
        }

        // Phase 2: Check cache
        const cacheResult = await this.checkCache(filePath, meta)
        if (cacheResult) return cacheResult

        // Phase 3: Download via Axios
        try {
            console.log(`[VideoDownloader] Streaming download to: ${filePath}`)
            const writer = fs.createWriteStream(filePath)
            const response = await axios({
                url: videoStreamUrl,
                method: 'GET',
                responseType: 'stream',
                headers: downloadHeaders,
                timeout: 60000,
            })

            let downloadedBytes = 0
            response.data.on('data', (chunk: Buffer) => {
                downloadedBytes += chunk.length
                if (downloadedBytes % (5 * 1024 * 1024) < chunk.length) {
                    console.log(`[VideoDownloader] Progress: ${(downloadedBytes / 1024 / 1024).toFixed(2)}MB`)
                }
            })
            response.data.pipe(writer)

            return new Promise((resolve, reject) => {
                writer.on('finish', async () => {
                    const stats = await fs.stat(filePath)
                    if (stats.size < 50 * 1024) {
                        try {
                            const fallbackResult = await this.fallbackDownloader.download(url, filePath)
                            resolve(fallbackResult)
                        } catch (err: any) {
                            reject(new Error(`File too small (${stats.size}B) and fallback failed: ${err.message}`))
                        }
                    } else {
                        resolve({ filePath, cached: false, meta })
                    }
                })
                writer.on('error', reject)
            })

        } catch (error: any) {
            if (error.response?.status === 429) {
                console.warn('[VideoDownloader] Rate limit (429) detected')
                try {
                    const { jobQueue } = require('../../services/JobQueue')
                    jobQueue.setGlobalThrottle(30)
                } catch { }
            }
            Sentry.captureException(error, { tags: { module: 'tiktok', operation: 'downloadVideo_axios' } })
            throw error
        }
    }

    private async checkCache(filePath: string, meta: any): Promise<DownloadResult | null> {
        if (await fs.pathExists(filePath)) {
            const stats = await fs.stat(filePath)
            if (stats.size > 50 * 1024) {
                console.log(`[VideoDownloader] Cache hit: ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`)
                return { filePath, cached: true, meta }
            } else {
                console.log(`[VideoDownloader] Corrupt cache (${stats.size}B). Deleting...`)
                await fs.remove(filePath)
            }
        }
        return null
    }
}
