import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { browserService } from '../../../services/BrowserService'
import { storageService } from '../../../services/StorageService'
import * as Sentry from '@sentry/electron/main'
import { fileLogger } from '../../../services/FileLogger'
import { ScannerBase } from './ScannerBase'
import { CaptchaHelper } from '../helpers/CaptchaHelper'
import { DateParser } from '../helpers/DateParser'
import { DebugHelper } from '../helpers/DebugHelper'
import { EMPTY_PROFILE_INDICATORS } from '../constants/messages'
import { ScanOptions, ScanResult, VideoResult } from '../types'

// ─── TikTok Profile / Channel Scanner ────────────────────────────────────────

export class ProfileScanner extends ScannerBase {
    async scan(username: string, options: ScanOptions = {}): Promise<ScanResult> {
        if (this.isScanning) {
            console.warn('[ProfileScanner] Scan already in progress')
            return { videos: [], channel: null }
        }
        this.isScanning = true

        const isBackground = options.isBackground || false
        const limit = options.limit === 'unlimited' ? 2000 : (options.limit || 50)
        console.log(`[ProfileScanner] Starting scan for: @${username} (Background: ${isBackground})`)
        fileLogger.log(`[ProfileScanner] Starting scan for: @${username}`)

        await this.ensureBrowser()
        const page = await browserService.newPage()
        if (!page) return { videos: [], channel: null }

        await this.injectCookies(page, options.cookies || [], 'ProfileScanner')

        const foundVideos: VideoResult[] = []
        let channelInfo: any = null

        try {
            await page.goto(`https://www.tiktok.com/@${username}`, { waitUntil: 'networkidle', timeout: 60000 })

            // Debug dump immediately after navigation
            await DebugHelper.dumpScanState(page, username)

            // ─── CAPTCHA Check ───
            const captcha = new CaptchaHelper(page)
            if (await captcha.isBasicCaptchaVisible()) {
                await captcha.waitForResolutionInScan(username)
            }
            await captcha.detectAndWait(`profile_${username}`)

            // ─── Channel Metadata ───
            channelInfo = await page.evaluate(() => {
                return {
                    avatar: document.querySelector('img[src*="tiktokcdn"]')?.getAttribute('src') || '',
                    nickname: document.querySelector('[data-e2e="user-title"]')?.textContent || '',
                    bio: document.querySelector('[data-e2e="user-bio"]')?.textContent || '',
                    followers: document.querySelector('[data-e2e="followers-count"]')?.textContent || '0',
                    following: document.querySelector('[data-e2e="following-count"]')?.textContent || '0',
                    likes: document.querySelector('[data-e2e="likes-count"]')?.textContent || '0',
                }
            })
            if (channelInfo) {
                storageService.run(
                    `UPDATE accounts SET metadata = ? WHERE platform = 'tiktok' AND username = ?`,
                    [JSON.stringify(channelInfo), username]
                )
            }

            // ─── Wait for content ───
            const CONTENT_SELECTORS = [
                '[data-e2e="user-post-item"]', '[data-e2e="search_top-item"]',
                'div[class*="DivItemContainer"]', '.tiktok-feed-item', 'a[href*="/video/"]'
            ].join(',')

            try {
                await page.waitForSelector(CONTENT_SELECTORS, { timeout: 15000 })
            } catch {
                console.log('[ProfileScanner] Timeout for content selector, rechecking CAPTCHA...')
                if (await captcha.isBasicCaptchaVisible()) {
                    await captcha.waitForResolutionInScan(username)
                    await page.waitForSelector(CONTENT_SELECTORS, { timeout: 15000 }).catch(() => { })
                }
            }

            // ─── Date range setup ───
            const startDate = options.startDate ? new Date(options.startDate) : null
            const endDate = options.endDate ? new Date(options.endDate) : null
            console.log(`[ProfileScanner] Range: ${startDate?.toISOString() || 'Earliest'} -> ${endDate?.toISOString() || 'Latest'}`)

            // ─── Incremental mode: stop at last known ID ───
            let stopId: string | null = null
            if (options.timeRange === 'from_now' || options.timeRange === 'future_only') {
                try {
                    const lastRow = storageService.get(`SELECT platform_id FROM videos WHERE platform='tiktok' AND url LIKE '%/@${username}/video/%' ORDER BY platform_id DESC LIMIT 1`)
                    if (lastRow) { stopId = lastRow.platform_id; console.log(`[ProfileScanner] Incremental: stop at ID <= ${stopId}`) }
                } catch { }
            }

            const MAX_ROUNDS = options.limit === 'unlimited' ? 300 : Math.ceil(limit / 12) + 5
            let prevCount = 0, rounds = 0, zeroCountRetries = 0

            // ─── Scroll & Extract Loop ───
            while (rounds < MAX_ROUNDS) {
                rounds++
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                await page.waitForTimeout(2000)

                const scannedBatch = await page.evaluate(() => {
                    const results: any[] = []
                    const seen = new Set()
                    Array.from(document.querySelectorAll('a'))
                        .filter(a => a.href.includes('/video/') && !a.href.includes('/search'))
                        .forEach(link => {
                            const idMatch = (link.getAttribute('href') || '').match(/\/video\/(\d+)/)
                            if (!idMatch || seen.has(idMatch[1])) return
                            seen.add(idMatch[1])
                            const id = idMatch[1]
                            const container = link.closest('[data-e2e="user-post-item"]') ||
                                link.closest('div[class*="DivItemContainer"]') || link.parentElement

                            let views = '0', likes = '0'
                            if (container) {
                                const viewsEl = (container as Element).querySelector('[data-e2e="video-views"]')
                                if (viewsEl) views = viewsEl.textContent || '0'
                                const likesEl = (container as Element).querySelector('[data-e2e="video-likes"]')
                                if (likesEl) likes = likesEl.textContent || '0'
                            }

                            let thumb = ''
                            const img = link.querySelector('img')
                            if (img) thumb = (img as HTMLImageElement).src

                            const badge = container?.querySelector('[data-e2e="video-card-badge"]')
                            const isPinned = !!(badge && (badge.textContent?.toLowerCase().includes('pinned') || badge.textContent?.toLowerCase().includes('top')))

                            results.push({ id, platform_id: id, url: (link as HTMLAnchorElement).href, desc: '', thumb, stats: { views, likes, comments: '0' }, isPinned })
                        })
                    return results
                })

                const currentCount = scannedBatch.length
                let newInRound = 0
                for (const v of scannedBatch) {
                    if (!foundVideos.some(fv => fv.platform_id === v.platform_id)) {
                        foundVideos.push(v)
                        newInRound++
                    }
                }

                console.log(`[ProfileScanner] Round ${rounds}: ${newInRound} new (Total: ${foundVideos.length})`)
                if (options.onProgress) options.onProgress(`Scanning round ${rounds}: found ${foundVideos.length} videos...`)

                if (options.limit !== 'unlimited' && foundVideos.length >= limit) break
                if (currentCount === prevCount && newInRound === 0 && currentCount > 0) { console.log('[ProfileScanner] End of feed.'); break }
                if (currentCount === 0 && ++zeroCountRetries >= 3) { console.log('[ProfileScanner] No videos after 3 attempts.'); break }
                else if (currentCount > 0) zeroCountRetries = 0

                if (stopId) {
                    const last = scannedBatch[scannedBatch.length - 1]
                    if (last && last.platform_id <= stopId) { console.log(`[ProfileScanner] Hit known ID ${stopId}. Stopping.`); break }
                }

                if (startDate && scannedBatch.length > 0) {
                    const last = scannedBatch[scannedBatch.length - 1]
                    if (last && !last.isPinned) {
                        const date = DateParser.fromVideoId(last.platform_id)
                        if (date < startDate) { console.log(`[ProfileScanner] Date ${date.toISOString()} < start. Stopping.`); break }
                    }
                }
                prevCount = currentCount
            }

            // ─── Zero video fallback ───
            if (foundVideos.length === 0) {
                const isEmptyProfile = await page.evaluate(() => {
                    const text = document.body.innerText.toLowerCase()
                    return ['no content', 'user has not published', 'no videos yet', 'private account'].some(t => text.includes(t))
                })

                if (!isEmptyProfile) {
                    const html = await page.content()
                    const regex = /href=["'](?:https:\/\/www\.tiktok\.com)?\/+@[\w.-]+\/video\/(\d+)["']/g
                    for (const m of [...html.matchAll(regex)]) {
                        const vid = m[1]
                        if (!foundVideos.some(fv => fv.platform_id === vid)) {
                            foundVideos.push({ id: vid, platform_id: vid, url: `https://www.tiktok.com/@${username}/video/${vid}`, desc: 'Extracted via Fallback', thumb: '', stats: { views: '0', likes: '0', comments: '0' } })
                        }
                    }
                    if (foundVideos.length === 0) throw new Error('CAPTCHA_REQUIRED')
                }
            }

            // ─── DB Insert & Date Filter ───
            let duplicatesCount = 0
            for (const v of foundVideos) {
                const postedAt = DateParser.fromVideoId(v.id!)
                if (startDate && postedAt < startDate && !v.isPinned) continue
                if (endDate && postedAt > endDate) continue

                const exists = storageService.get('SELECT id FROM videos WHERE platform_id = ?', [v.id])
                if (!exists) {
                    storageService.run(
                        `INSERT INTO videos (platform, platform_id, url, description, status, metadata, posted_at) VALUES ('tiktok', ?, ?, ?, 'discovered', ?, ?)`,
                        [v.id, v.url, v.desc || '', JSON.stringify({ thumbnail: v.thumb, stats: v.stats, isPinned: v.isPinned }), postedAt.toISOString()]
                    )
                } else {
                    duplicatesCount++
                }
            }

            console.log(`[ProfileScanner] Done. Found ${foundVideos.length} videos, ${duplicatesCount} duplicates.`)
            fileLogger.log(`[ProfileScanner] Done for @${username}: ${foundVideos.length} videos`)
            return { videos: foundVideos, channel: channelInfo, duplicatesCount }

        } catch (error: any) {
            if (error.message === 'CAPTCHA_REQUIRED') throw error
            Sentry.captureException(error, { tags: { module: 'tiktok', operation: 'scanProfile', username } })
            console.error('[ProfileScanner] Error:', error)
            return { videos: [], channel: null }
        } finally {
            await page.close()
            this.isScanning = false
        }
    }
}
