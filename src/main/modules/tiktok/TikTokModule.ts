import { PlatformModule } from '../../services/ModuleManager'
import { browserService } from '../../services/BrowserService'
import { storageService } from '../../services/StorageService'
import { Page, Response } from 'playwright-core'
import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import { app } from 'electron'
import { Downloader } from '@tobyg74/tiktok-api-dl'
import * as Sentry from '@sentry/electron/main'
import { fileLogger } from '../../services/FileLogger'

export interface ScanOptions {
    limit?: number | 'unlimited'
    mode?: 'incremental' | 'batch'
    sortOrder?: 'newest' | 'oldest' | 'most_likes' | 'most_viewed'
    // New filtering options
    timeRange?: 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom_range' | 'future_only' | 'history_only' | 'history_and_future' | 'from_now'
    isBackground?: boolean
    startDate?: string // ISO date string
    endDate?: string   // ISO date string
    onProgress?: (progress: string) => void
    cookies?: any[]    // Account cookies for authenticated scan
}

// Helper to get date from TikTok Snowflake ID
// ID >> 32 = Unix Timestamp (seconds)
function getDateFromVideoId(id: string): Date {
    try {
        const bin = BigInt(id).toString(2);
        const timeBin = bin.slice(0, 32);
        const unixSeconds = parseInt(timeBin, 2);
        return new Date(unixSeconds * 1000);
    } catch (e) {
        console.error('Error parsing date from ID:', id, e);
        return new Date(); // Fallback to now if fails
    }
}


export class TikTokModule implements PlatformModule {
    name = 'TikTok'
    id = 'tiktok'
    private isScanning = false


    async initialize(): Promise<void> {
        console.log('TikTokModule initializing...')
        // Register IPC handlers here if needed
    }

    async shutdown(): Promise<void> {
        console.log('TikTokModule shutting down...')
    }

    async scanKeyword(keyword: string, options: ScanOptions = {}): Promise<any> {
        const maxVideos = options.limit === 'unlimited' ? 1000 : (options.limit || 50)
        if (this.isScanning) {
            console.warn('Scan already in progress')
            return { videos: [] }
        }
        this.isScanning = true
        console.log(`Starting keyword scan for: ${keyword} (Max: ${maxVideos})`)

        if (!browserService.isConnected()) {
            await browserService.init(false) // Headless: false for manual CAPTCHA solving
        }

        const page = await browserService.newPage()
        if (!page) return { videos: [] }

        // Restore account session cookies if provided (for authenticated scans)
        if (options.cookies && options.cookies.length > 0) {
            try {
                const sanitized = options.cookies.map((c: any) => {
                    if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None'
                    if (c.sameSite === 'lax') c.sameSite = 'Lax'
                    if (c.sameSite === 'strict') c.sameSite = 'Strict'
                    if (c.sameSite === 'None') c.secure = true
                    return c
                })
                await page.context().addCookies(sanitized)
                console.log(`[scanKeyword] Restored ${sanitized.length} account cookies for authenticated scan`)
            } catch (e) {
                console.warn('[scanKeyword] Failed to set cookies, proceeding without auth:', e)
            }
        } else {
            console.log('[scanKeyword] No account cookies provided, scanning as guest')
        }

        const foundVideos: any[] = []

        try {
            await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, { waitUntil: 'networkidle', timeout: 60000 })

            // Detection check
            await (this as any).handleCaptchaDetection(page, `keyword_${keyword}`)

            // === Scroll to End & Filter Logic ===
            let prevCount = 0
            let rounds = 0
            // If unlimited, go up to 200 rounds (approx 2000-3000 videos), else calc needed rounds
            const MAX_ROUNDS = options.limit === 'unlimited' ? 200 : Math.ceil(maxVideos / 10) + 5

            // Date Parsing Helper (Relative to absolute)
            const parseRelativeDate = (text: string) => {
                const now = new Date()
                if (text.includes('m ago')) now.setMinutes(now.getMinutes() - parseInt(text))
                else if (text.includes('h ago')) now.setHours(now.getHours() - parseInt(text))
                else if (text.includes('d ago')) now.setDate(now.getDate() - parseInt(text))
                else if (text.match(/\d{4}-\d{1,2}-\d{1,2}/)) return new Date(text)
                else return now // Fallback or standard date format like "12-25" (assume current year if missing)
                return now
            }

            while (rounds < MAX_ROUNDS) {
                rounds++

                // Optimized: Check dates during scroll if startDate is set
                if (options.startDate) {
                    const oldestVideoDate = await page.evaluate(() => {
                        const dates = Array.from(document.querySelectorAll('[data-e2e="search-card-video-time"], .video-date-selector')) // Adjust selector as needed
                        if (dates.length === 0) return null
                        return dates[dates.length - 1].textContent
                    })

                    // If we see a date older than startDate, we can stop scrolling
                    // Note: Implementation depends on reliable date selectors in DOM. 
                    // For now, we'll rely on post-fetch filtering mainly, unless we find a stable DOM element.
                }

                const currentCount = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length)

                if (currentCount >= maxVideos) {
                    console.log(`[TikTokModule] Reached max videos limit (${maxVideos}) at round ${rounds}`)
                    break
                }

                console.log(`[TikTokModule] Scanning round ${rounds}/${MAX_ROUNDS}... Found ${currentCount}/${maxVideos}`)
                if (options.onProgress) {
                    options.onProgress(`Scanning round ${rounds}: found ${currentCount}/${maxVideos} videos...`)
                }
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                try {
                    // Randomized delay to mimic human behavior and avoid rate limits (2s - 5s)
                    const delay = 2000 + Math.random() * 3000
                    await page.waitForTimeout(delay)
                } catch { break }

                if (currentCount === prevCount && currentCount > 0) {
                    console.log(`[TikTokModule] No new videos found after scrolling. Stopping.`)
                    break
                }
                prevCount = currentCount
            }

            // === Extract Data ===
            const videos = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a'))
                return anchors
                    .filter(a => a.href.includes('/video/') && !a.href.includes('/search')) // Filter out search nav links
                    .map(a => {
                        const m = a.href.match(/\/video\/(\d+)/)
                        const container = a.closest('[data-e2e="search_top-item"]') || a.closest('div[class*="DivItemContainer"]') || a.parentElement
                        const viewsText = container ? container.textContent?.match(/(\d+(\.\d+)?[KMB]?)/)?.[0] : ''

                        // Try to find date element
                        const dateEl = container?.querySelector('[data-e2e="search-card-video-time"]') || container?.querySelector('span[class*="-SpanTime"]')
                        const dateText = dateEl ? dateEl.textContent : ''

                        return {
                            id: m ? m[1] : '',
                            url: a.href,
                            desc: a.textContent || '', // This often grabs views too, needs cleaning
                            thumb: a.querySelector('img')?.src || '',
                            dateStr: dateText,
                            stats: {
                                views: viewsText || '0',
                                likes: '0',
                                comments: '0'
                            }
                        }
                    })
                    .filter(v => v.id)
            })

            // Filter by Date Range
            const startDate = options.startDate ? new Date(options.startDate) : null
            const endDate = options.endDate ? new Date(options.endDate) : null

            // Helper to parse harvested dates
            // TikTok dates are "2d ago", "2023-5-1", or "5-1" (current year)
            const parseVideoDate = (str: string) => {
                if (!str) return new Date() // Default to now if not found
                const now = new Date()
                if (str.includes('ago')) {
                    const num = parseInt(str)
                    if (str.includes('m')) now.setMinutes(now.getMinutes() - num)
                    if (str.includes('h')) now.setHours(now.getHours() - num)
                    if (str.includes('d')) now.setDate(now.getDate() - num)
                    if (str.includes('w')) now.setDate(now.getDate() - (num * 7))
                    return now
                }
                if (str.match(/^\d{1,2}-\d{1,2}$/)) { // "5-20"
                    return new Date(`${now.getFullYear()}-${str}`)
                }
                return new Date(str) // Try standard parse
            }

            const filteredVideos = videos.filter(v => {
                if (!startDate && !endDate) return true
                const vDate = parseVideoDate(v.dateStr || '')

                if (startDate && vDate < startDate) return false
                if (endDate) {
                    // Set endDate to end of day
                    const end = new Date(endDate)
                    end.setHours(23, 59, 59, 999)
                    if (vDate > end) return false
                }
                return true
            })

            console.log(`[TikTokModule] Date Filtering: ${videos.length} -> ${filteredVideos.length} videos within range (${options.startDate || 'Any'} to ${options.endDate || 'Any'})`)


            console.log(`[TikTokModule] Extraction Results: Found ${videos.length} potential videos. Applying max limit (${maxVideos}) and deduplication check...`)

            // Limit to maxVideos
            const targetVideos = videos.slice(0, maxVideos)
            let uniqueNewCount = 0;
            let skippedCount = 0;

            for (const v of targetVideos) {
                const exists = storageService.get('SELECT id FROM videos WHERE platform_id = ?', [v.id])

                if (!exists) {
                    storageService.run(
                        `INSERT INTO videos (platform, platform_id, url, description, status, metadata)
                         VALUES ('tiktok', ?, ?, ?, 'discovered', ?)`,
                        [v.id, v.url, v.desc, JSON.stringify({ thumbnail: v.thumb, stats: v.stats, keyword })]
                    )
                    console.log(`[TikTokModule] [NEW] Discovered: ${v.id} | Desc: "${v.desc.substring(0, 30)}..."`)

                    // Return found videos (for immediate use if needed)
                    const newId = storageService.get('SELECT last_insert_rowid() as id').id
                    foundVideos.push({
                        id: newId,
                        url: v.url,
                        platform_id: v.id,
                        thumbnail: v.thumb,
                        stats: v.stats
                    })
                    uniqueNewCount++;
                } else {
                    console.log(`[TikTokModule] [SKIP] Already in DB: ${v.id}`);
                    skippedCount++;
                }
            }

            console.log(`[TikTokModule] Scan Completed: ${uniqueNewCount} new unique videos added, ${skippedCount} skipped (duplicates).`);
            return { videos: foundVideos }

        } catch (error: any) {
            if (error.message === 'CAPTCHA_REQUIRED') throw error;
            Sentry.captureException(error, { tags: { module: 'tiktok', operation: 'scanKeyword', keyword } })
            console.error('Error scanning keyword:', error)
            return { videos: [] }
        } finally {
            await page.close()
            this.isScanning = false
        }
    }

    async scanProfile(username: string, options: ScanOptions = {}): Promise<any> {
        const isBackground = options.isBackground || false
        const limit = options.limit === 'unlimited' ? 2000 : (options.limit || 50)
        if (this.isScanning) {
            console.warn('Scan already in progress')
            return { videos: [], channel: null }
        }
        this.isScanning = true
        console.log(`Starting scan for: ${username} (Background: ${isBackground})`)
        fileLogger.log(`Starting scan for: ${username} (Background: ${isBackground})`)

        if (!browserService.isConnected()) {
            await browserService.init(false) // Headless: false for manual CAPTCHA solving
        }

        const page = await browserService.newPage()
        if (!page) return { videos: [], channel: null }

        // Restore account session cookies if provided (for authenticated scans)
        if (options.cookies && options.cookies.length > 0) {
            try {
                const sanitized = options.cookies.map((c: any) => {
                    if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None'
                    if (c.sameSite === 'lax') c.sameSite = 'Lax'
                    if (c.sameSite === 'strict') c.sameSite = 'Strict'
                    if (c.sameSite === 'None') c.secure = true
                    return c
                })
                await page.context().addCookies(sanitized)
                console.log(`[scanProfile] Restored ${sanitized.length} account cookies for authenticated scan`)
            } catch (e) {
                console.warn('[scanProfile] Failed to set cookies, proceeding without auth:', e)
            }
        } else {
            console.log('[scanProfile] No account cookies provided, scanning as guest')
        }

        const foundVideos: any[] = []
        let channelInfo: any = null

        try {
            await page.goto(`https://www.tiktok.com/@${username}`, { waitUntil: 'networkidle', timeout: 60000 })

            // ─── DEBUG DUMP: HTML + Screenshot ───
            try {
                const debugDir = path.join(app.getPath('userData'), 'scan_debug')
                await fs.ensureDir(debugDir)
                const ts = new Date().toISOString().replace(/[:.]/g, '-')
                const screenshotPath = path.join(debugDir, `scan_${username}_${ts}.png`)
                const htmlPath = path.join(debugDir, `scan_${username}_${ts}.html`)
                const logPath = path.join(debugDir, `scan_${username}_${ts}.log`)

                await page.screenshot({ path: screenshotPath, fullPage: true })
                const html = await page.content()
                await fs.writeFile(htmlPath, html, 'utf8')

                const currentUrl = page.url()
                const logContent = [
                    `[${new Date().toISOString()}] scanProfile: @${username}`,
                    `URL: ${currentUrl}`,
                    `Cookies provided: ${options.cookies?.length || 0}`,
                    `Screenshot: ${screenshotPath}`,
                    `HTML: ${htmlPath}`,
                ].join('\n')
                await fs.writeFile(logPath, logContent, 'utf8')
                console.log(`[scanProfile] Debug dump saved: ${debugDir}/scan_${username}_${ts}.*`)
                fileLogger.log(`[scanProfile] Debug saved at ${debugDir}`)
            } catch (dumpErr) {
                console.warn('[scanProfile] Debug dump failed:', dumpErr)
            }

            // ─── CAPTCHA: Check immediately after navigation ───
            const CAPTCHA_WAIT = 300000 // 5 minutes
            // Only check specific captcha container elements (not CSS class names which appear in style tags)
            const captchaCheck = async (): Promise<boolean> => {
                return page.evaluate(() => {
                    const containers = [
                        document.querySelector('.captcha-verify-container'),
                        document.querySelector('#captcha_container'),
                        document.querySelector('.captcha_verify_container'),
                    ]
                    // Only count as CAPTCHA if the element is visible (has dimensions)
                    return containers.some(el => {
                        if (!el) return false
                        const rect = (el as HTMLElement).getBoundingClientRect()
                        return rect.width > 0 && rect.height > 0
                    })
                })
            }

            const waitForCaptcha = async (label: string) => {
                console.log(`[scanProfile] ${label}: CAPTCHA detected! Waiting up to 5 min for user to solve...`)
                fileLogger.log(`[scanProfile] ${label}: CAPTCHA detected — waiting for user.`)

                // Take screenshot so user can see what CAPTCHA looks like
                try {
                    const debugDir = path.join(app.getPath('userData'), 'scan_debug')
                    const ts = new Date().toISOString().replace(/[:.]/g, '-')
                    await page.screenshot({ path: path.join(debugDir, `captcha_${username}_${ts}.png`), fullPage: false })
                } catch { }

                try {
                    await page.waitForFunction(() => {
                        const containers = [
                            document.querySelector('.captcha-verify-container'),
                            document.querySelector('#captcha_container'),
                            document.querySelector('.captcha_verify_container'),
                        ]
                        return !containers.some(el => {
                            if (!el) return false
                            const rect = (el as HTMLElement).getBoundingClientRect()
                            return rect.width > 0 && rect.height > 0
                        })
                    }, { timeout: CAPTCHA_WAIT, polling: 1000 })
                    console.log(`[scanProfile] ${label}: CAPTCHA resolved! Waiting for content to load...`)
                    fileLogger.log(`[scanProfile] ${label}: CAPTCHA resolved. Waiting for content.`)

                    // Wait for content to appear naturally (TikTok often just hides the captcha overlay)
                    try {
                        await page.waitForSelector('[data-e2e="user-post-item"]', { timeout: 15000 })
                        console.log(`[scanProfile] Content detected!`)
                    } catch (e) {
                        console.log(`[scanProfile] Content did not appear after 15s. Reloading page as fallback...`)
                        await page.reload({ waitUntil: 'domcontentloaded' })
                        await page.waitForTimeout(5000)
                    }

                    // Post-CAPTCHA screenshot
                    try {
                        const debugDir = path.join(app.getPath('userData'), 'scan_debug')
                        const ts2 = new Date().toISOString().replace(/[:.]/g, '-')
                        await page.screenshot({ path: path.join(debugDir, `after_captcha_${username}_${ts2}.png`), fullPage: true })
                        console.log(`[scanProfile] Post-CAPTCHA screenshot saved`)
                    } catch { }

                } catch {
                    throw new Error('CAPTCHA_FAILED: User did not solve CAPTCHA in time (5 mins)')
                }
            }

            if (await captchaCheck()) {
                await waitForCaptcha('Initial')
            }

            // Detection check (secondary via handleCaptchaDetection)
            await (this as any).handleCaptchaDetection(page, `profile_${username}`)

            // === Extract Channel Metadata ===
            channelInfo = await page.evaluate(() => {
                const avatar = document.querySelector('img[src*="tiktokcdn"]')?.getAttribute('src') || ''
                const nickname = document.querySelector('[data-e2e="user-title"]')?.textContent || ''
                const bio = document.querySelector('[data-e2e="user-bio"]')?.textContent || ''
                const followers = document.querySelector('[data-e2e="followers-count"]')?.textContent || '0'
                const following = document.querySelector('[data-e2e="following-count"]')?.textContent || '0'
                const likes = document.querySelector('[data-e2e="likes-count"]')?.textContent || '0'
                return { avatar, nickname, bio, followers, following, likes }
            })
            console.log(`Channel Info:`, channelInfo)

            // Update Account Metadata if exists
            if (channelInfo) {
                storageService.run(
                    `UPDATE accounts SET metadata = ? WHERE platform = 'tiktok' AND username = ?`,
                    [JSON.stringify(channelInfo), username]
                )
            }

            // Adaptive Selectors
            const CONTENT_SELECTORS = [
                '[data-e2e="user-post-item"]',
                '[data-e2e="search_top-item"]',
                'div[class*="DivItemContainer"]',
                '.tiktok-feed-item',
                'a[href*="/video/"]'
            ].join(',')

            try {
                // Initial wait for content
                await page.waitForSelector(CONTENT_SELECTORS, { timeout: 15000 })
            } catch (e) {
                console.log('Timeout waiting for video selector, checking for CAPTCHA (secondary)...')
                if (await captchaCheck()) {
                    await waitForCaptcha('Secondary')
                    await page.waitForSelector(CONTENT_SELECTORS, { timeout: 15000 }).catch(() => { })
                } else {
                    console.log('No CAPTCHA found. Possible empty profile or layout change.')
                }
            }

            // === Scroll to End Logic ===
            let prevCount = 0
            let rounds = 0
            let zeroCountRetries = 0 // Safety break for 0 items

            // Check for Incremental Mode (stop at last known video)
            let stopId: string | null = null

            // Start/End Date Filtering Setup
            const startDate = options.startDate ? new Date(options.startDate) : null;
            const endDate = options.endDate ? new Date(options.endDate) : null;

            console.log(`[TikTokModule] Scan Range: ${startDate ? startDate.toISOString() : 'Earliest'} -> ${endDate ? endDate.toISOString() : 'Latest'}`);

            if (options.timeRange === 'from_now' || options.timeRange === 'future_only') {
                try {
                    const lastRow = storageService.get(`SELECT platform_id FROM videos WHERE platform='tiktok' AND url LIKE '%/@${username}/video/%' ORDER BY platform_id DESC LIMIT 1`)
                    if (lastRow) {
                        stopId = lastRow.platform_id
                        console.log(`[TikTokModule] Incremental Mode: Stopping at video ID <= ${stopId}`)
                    }
                } catch (e) { console.error('Error fetching last ID:', e) }
            }

            // Adjust rounds based on limit. Unlimited -> 300 rounds (~3-5k videos), else adaptive.
            const MAX_ROUNDS = options.limit === 'unlimited' ? 300 : Math.ceil(limit / 12) + 5

            while (rounds < MAX_ROUNDS) {
                rounds++

                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                await page.waitForTimeout(2000)

                // === ROBUST SCAN LOGIC (Ported from VideoPicker) ===
                const scannedBatch = await page.evaluate(() => {
                    const results: any[] = [];
                    const anchors = Array.from(document.querySelectorAll('a'));
                    // Filter for video links (exclude search results if any)
                    const videoLinks = anchors.filter(a => a.href.includes('/video/') && !a.href.includes('/search'));

                    const seen = new Set();

                    videoLinks.forEach(link => {
                        const href = link.getAttribute('href') || '';
                        const idMatch = href.match(/\/video\/(\d+)/);

                        // Strict ID check
                        if (idMatch && idMatch[1] && !seen.has(idMatch[1])) {
                            seen.add(idMatch[1]);
                            const id = idMatch[1];
                            const platformId = id;

                            // Try to find container for stats/thumb (VideoPicker Logic)
                            const container = link.closest('[data-e2e="user-post-item"]') ||
                                link.closest('div[class*="DivItemContainer"]') ||
                                link.parentElement;

                            // Scrape Stats
                            let views = '0';
                            let likes = '0'; // Try to get likes if possible
                            let comments = '0';

                            if (container) {
                                // Views
                                const viewsEl = container.querySelector('[data-e2e="video-views"]');
                                if (viewsEl) {
                                    views = viewsEl.textContent || '0';
                                } else {
                                    // Robust: "1.2M Play" or just "1.2M"
                                    const text = container.textContent || '';
                                    const viewMatch = text.match(/(\d+(\.\d+)?[KMB]?)\s*Play/);
                                    if (viewMatch) views = viewMatch[1];
                                    else {
                                        const simpleMatch = text.match(/(\d+(\.\d+)?[KMB]?)/);
                                        if (simpleMatch) views = simpleMatch[0];
                                    }
                                }

                                // Likes
                                const likesEl = container.querySelector('[data-e2e="video-likes"]');
                                if (likesEl) likes = likesEl.textContent || '0';
                            }

                            // Thumbnail
                            let thumb = '';
                            const img = link.querySelector('img');
                            if (img) thumb = (img as HTMLImageElement).src;
                            if (!thumb && container) {
                                const style = window.getComputedStyle(container);
                                const bg = style.backgroundImage;
                                if (bg && bg.startsWith('url(')) {
                                    thumb = bg.slice(5, -2).replace(/['"]/g, '');
                                }
                            }
                            // Fallback for thumbnail: try to get the 'poster' if it's a video element playing
                            if (!thumb && container) {
                                const videoEl = container.querySelector('video');
                                if (videoEl) thumb = videoEl.poster;
                            }

                            // Is Pinned?
                            let isPinned = false;
                            if (container) {
                                const badge = container.querySelector('[data-e2e="video-card-badge"]');
                                isPinned = !!(badge && (badge.textContent?.toLowerCase().includes('pinned') || badge.textContent?.toLowerCase().includes('top')));
                            }

                            results.push({
                                id: platformId, // Critical: JobQueue expects 'id' to be string (Platform ID) for sorting
                                platform_id: platformId,
                                url: (link as HTMLAnchorElement).href,
                                desc: '', // User requested empty desc
                                thumb: thumb,
                                stats: { views, likes, comments },
                                isPinned: isPinned
                            });
                        }
                    });
                    return results;
                });

                const currentCount = scannedBatch.length // Total visible unique videos on page

                // Add new to foundVideos
                let newInRound = 0
                for (const v of scannedBatch) {
                    if (!foundVideos.some(fv => fv.platform_id === v.platform_id)) {
                        foundVideos.push(v)
                        newInRound++
                    }
                }

                console.log(`[TikTokModule] Round ${rounds}: Found ${newInRound} new videos (Total: ${foundVideos.length}).`)
                if (options.onProgress) {
                    options.onProgress(`Scanning round ${rounds}: found ${foundVideos.length} videos so far...`)
                }

                if (options.limit !== 'unlimited' && foundVideos.length >= limit) {
                    console.log(`[TikTokModule] Reached limit (${limit}). Stopping scroll.`)
                    break
                }

                // BREAK if no NEW videos found after multiple rounds
                // Wait, previous logic was "currentCount === prevCount".
                // videoLinks.filter returns ALL links on page.
                // So scannedBatch.length is the total count.
                if (currentCount === prevCount && newInRound === 0) {
                    // Verify if truly stuck or just end of feed
                    if (currentCount > 0) {
                        console.log(`[TikTokModule] Reached end of feed for @${username}.`)
                        break
                    }
                }

                // BREAK if 0 videos found after multiple rounds (Empty Profile or Load Failure)
                if (currentCount === 0) {
                    zeroCountRetries++
                    if (zeroCountRetries >= 3) {
                        console.log('[TikTokModule] No videos found after 3 scroll attempts. Stopping.')
                        break
                    }
                } else {
                    zeroCountRetries = 0 // Reset if we found something
                }


                // Incremental Check: Check the last loaded video ID
                if (stopId) {
                    // Check if *any* of the found videos are <= stopId
                    // Since foundVideos is accumulated, check the last batch
                    const lastBatch = scannedBatch[scannedBatch.length - 1]; // Oldest on page typically at bottom?
                    // Actually TikTok adds to bottom.
                    if (lastBatch && lastBatch.platform_id <= stopId) {
                        console.log(`[TikTokModule] Reached known video (ID <= ${stopId}). Stopping incremental scan.`)
                        break
                    }
                }

                // Date Check
                if (startDate) {
                    // Check last video date
                    const lastV = scannedBatch[scannedBatch.length - 1];
                    if (lastV && !lastV.isPinned) {
                        const date = getDateFromVideoId(lastV.platform_id);
                        if (date < startDate) {
                            console.log(`[TikTokModule] Reached date ${date.toISOString()} < ${startDate.toISOString()}. Stopping.`)
                            break
                        }
                    }
                }

                prevCount = currentCount
            }

            // === Post-Scan Processing ===
            // Use foundVideos which was populated during the scan loop
            let duplicatesCount = 0
            const videos = foundVideos.map(v => ({
                id: v.platform_id,
                url: v.url,
                desc: v.desc,
                thumb: v.thumb,
                stats: v.stats,
                isPinned: v.isPinned
            }));

            console.log(`[TikTokModule] Scan complete. Found ${videos.length} videos total.`)
            fileLogger.log(`[TikTokModule] Scan complete. Found ${videos.length} videos total for @${username}`)

            if (videos.length === 0) {
                const dumpPath = path.join(app.getPath('userData'), `scan_dump_${username}_${Date.now()}.html`)
                try {
                    const html = await page.content()
                    await fs.writeFile(dumpPath, html)
                    console.log(`[TikTokModule] ZERO VIDEOS FOUND. Dumped HTML to: ${dumpPath}`)
                    fileLogger.log(`[TikTokModule] ZERO VIDEOS FOUND. Dumped HTML to: ${dumpPath}`)

                    // Check for "Empty Profile" indicators
                    const isEmptyProfile = await page.evaluate(() => {
                        const text = document.body.innerText.toLowerCase()
                        return text.includes('no content') ||
                            text.includes('user has not published') ||
                            text.includes('no videos yet') ||
                            text.includes('private account')
                    })

                    if (!isEmptyProfile) {
                        console.log('[TikTokModule] 0 videos from DOM. Attempting HTML Fallback Extraction...')
                        fileLogger.log('[TikTokModule] 0 videos from DOM. Attempting HTML Fallback Extraction...')

                        // Fallback 1: Regex on raw HTML
                        const html = await page.content()
                        const regex = /href=["'](?:https:\/\/www\.tiktok\.com)?\/@[\w.-]+\/video\/(\d+)["']/g
                        const regexMatches = [...html.matchAll(regex)]

                        console.log(`[TikTokModule] Fallback Regex found ${regexMatches.length} matches`)

                        regexMatches.forEach(m => {
                            const vid = m[1]
                            const vUrl = `https://www.tiktok.com/@${username}/video/${vid}`
                            // Check for duplicates in foundVideos
                            if (!foundVideos.some(fv => fv.platform_id === vid)) {
                                // Basic mock data since we only have ID
                                const mockVideo = {
                                    id: vid,
                                    url: vUrl,
                                    desc: 'Extracted via Fallback',
                                    thumb: '',
                                    stats: { views: '0', likes: '0', comments: '0' },
                                    isPinned: false
                                }
                                // Add to discovered list (the loop below will process it)
                                videos.push(mockVideo)
                            }
                        })

                        // Fallback 2: Try parsing SIGI_STATE ( hydration data )
                        try {
                            const sigiScript = await page.evaluate(() => {
                                const el = document.getElementById('SIGI_STATE') || document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')
                                return el ? el.textContent : null
                            })
                            if (sigiScript) {
                                const data = JSON.parse(sigiScript)
                                // Structure varies, try to find 'ItemModule' or 'UserModule'
                                const items = data.ItemModule || data.itemList || {}
                                Object.values(items).forEach((item: any) => {
                                    if (item && item.id && !foundVideos.some(fv => fv.platform_id === item.id)) {
                                        videos.push({
                                            id: item.id,
                                            url: `https://www.tiktok.com/@${item.author}/video/${item.id}`,
                                            desc: item.desc || '',
                                            thumb: item.video?.cover || '',
                                            stats: {
                                                views: item.stats?.playCount || '0',
                                                likes: item.stats?.diggCount || '0',
                                                comments: item.stats?.commentCount || '0'
                                            },
                                            isPinned: false
                                        })
                                    }
                                })
                                console.log(`[TikTokModule] SIGI_STATE extraction added ${videos.length} videos`)
                            }
                        } catch (e) { console.warn('SIGI_STATE extraction failed', e) }

                        if (videos.length === 0) {
                            console.log('[TikTokModule] Still 0 videos after fallback. Throwing CAPTCHA_REQUIRED.')
                            throw new Error('CAPTCHA_REQUIRED')
                        }
                    } else {
                        console.log('[TikTokModule] Verified as EMPTY profile. Returning 0 videos.')
                        fileLogger.log('[TikTokModule] Verified as EMPTY profile. Returning 0 videos.')
                    }

                } catch (e: any) {
                    if (e.message === 'CAPTCHA_REQUIRED') throw e
                    console.error('Failed to dump HTML or check empty state:', e)
                }
            }

            for (const v of videos) {
                // Calculate Posted Date
                const postedAt = getDateFromVideoId(v.id);

                // --- DATE FILTERING ---
                // Skip if older than startDate (and not pinned - pinned videos can be old but at top)
                if (startDate && postedAt < startDate && !v.isPinned) {
                    console.log(`[TikTokModule] Skipping ${v.id} (Date: ${postedAt.toISOString()} < Start: ${startDate.toISOString()})`);
                    continue;
                }
                // Skip if newer than endDate
                if (endDate && postedAt > endDate) {
                    console.log(`[TikTokModule] Skipping ${v.id} (Date: ${postedAt.toISOString()} > End: ${endDate.toISOString()})`);
                    continue;
                }
                // ----------------------

                const exists = storageService.get('SELECT id FROM videos WHERE platform_id = ?', [v.id])

                if (!exists) {
                    storageService.run(
                        `INSERT INTO videos (platform, platform_id, url, description, status, metadata, posted_at)
                         VALUES ('tiktok', ?, ?, ?, 'discovered', ?, ?)`,
                        [v.id, v.url, v.desc, JSON.stringify({ thumbnail: v.thumb, stats: v.stats, isPinned: v.isPinned }), postedAt.toISOString()]
                    )
                    console.log(`[DEBUG_DESC] scanProfile: New video found: ${v.id} (${postedAt.toISOString()}). Desc: "${v.desc}"`)

                    // Removed harmful foundVideos.push logic here.
                    // foundVideos is already populated in the scan loop with correct 'id' (String).
                    // Pushing DB IDs (Number) causes JobQueue sort to crash.
                } else {
                    duplicatesCount++
                }
            }
            return { videos: foundVideos, channel: channelInfo, duplicatesCount }

        } catch (error: any) {
            if (error.message === 'CAPTCHA_REQUIRED') throw error;
            Sentry.captureException(error, { tags: { module: 'tiktok', operation: 'scanProfile', username } })
            console.error('Error scanning profile:', error)
            return { videos: [], channel: null }
        } finally {
            await page.close()
            this.isScanning = false
        }
    }

    async downloadVideo(url: string, platformId: string): Promise<{ filePath: string, cached: boolean, meta?: any }> {
        console.log(`Downloading video: ${url}`)

        // MOCK FOR E2E TESTING
        if (url.includes('@test/video')) {
            console.log('[TikTok] Mock download triggered for E2E test.')
            const mockPath = path.join(app.getPath('userData'), 'mock_video_e2e.mp4')
            if (!fs.existsSync(mockPath)) {
                fs.writeFileSync(mockPath, 'fake video content')
            }
            return { filePath: mockPath, cached: false }
        }

        const downloadsDir = path.join(app.getPath('userData'), 'downloads', 'tiktok')
        await fs.ensureDir(downloadsDir)
        const diff = 'tiktok_' + platformId + '.mp4'
        const filePath = path.join(downloadsDir, diff)

        // 0. Check Cache (Moved to after metadata extraction)
        // const filePath = ... (already defined)

        let videoStreamUrl = ''
        let downloadHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        }

        let meta: any = {}

        try {
            console.log('Using @tobyg74/tiktok-api-dl to fetch video URL...')

            // 60-second timeout for library extraction
            const LIBRARY_TIMEOUT = 60 * 1000;
            let libTimeoutId: NodeJS.Timeout;

            const libTimeoutPromise = new Promise((_, reject) => {
                libTimeoutId = setTimeout(() => {
                    reject(new Error('TikTok library extraction timed out after 60s'));
                }, LIBRARY_TIMEOUT);
            });

            // Dynamic import to handle CommonJS/ESM interop if needed, though we compiled to CommonJS in TS
            // @ts-ignore
            const workPromise = Downloader(url, { version: 'v1' });

            const result = await Promise.race([workPromise, libTimeoutPromise]) as any;
            clearTimeout(libTimeoutId!);

            console.log(`[TikTokModule] Library extraction result for: ${url}`)
            console.log(`  - Status: ${result.status}`)

            // meta declared outside try block

            if (result.status === 'success' && result.result) {
                const videoData = result.result.video
                console.log(`[TikTokModule] Library extraction details:`)
                console.log(`  - Has Video Data: ${!!videoData}`)
                console.log(`  - Play Statistics: ${JSON.stringify(result.result.stats)}`)

                if (videoData) {
                    console.log(`[TikTokModule] Investigating playAddr:`, JSON.stringify(videoData.playAddr));
                    // Fix: The library returns `playAddr` as an array of strings inside the `video` object
                    if (Array.isArray(videoData.playAddr) && videoData.playAddr.length > 0) {
                        videoStreamUrl = videoData.playAddr[0]
                        console.log(`[TikTokModule] Using first playAddr from array: ${videoStreamUrl.substring(0, 50)}...`)
                    } else if (typeof videoData.playAddr === 'string') {
                        videoStreamUrl = videoData.playAddr
                        console.log(`[TikTokModule] Using string playAddr: ${videoStreamUrl.substring(0, 50)}...`)
                    }
                }

                // ... (cleaning logic remains same but I'll keep the block to ensure replacement matches)
                // Extract metadata (using shared cleaner)
                meta = {
                    description: result.result.desc || '',
                    author: result.result.author ? {
                        nickname: result.result.author.nickname,
                        avatar: result.result.author.avatar
                    } : null
                }
                console.log(`[TikTokModule] Metadata Resolution:`)
                console.log(`  - Raw Caption: "${result.result.desc || ''}"`)
                console.log(`  - Cleaned Caption: "${meta.description}"`)
                console.log(`  - Author: ${meta.author?.nickname || 'Unknown'} (Avatar: ${meta.author?.avatar ? 'Present' : 'Missing'})`)
            }

            if (!videoStreamUrl) {
                console.warn('[TikTokModule] ! CRITICAL: No video stream URL found in library result.')
                throw new Error('Library result empty')
            }

            // 2. Fallback for Empty Description (User Requirement: "fetch caption in detail page")
            if (!meta.description) {
                console.log('[TikTokModule] Caption missing from library. Initiating Puppeteer fallback...')
                try {
                    const fallbackMeta = await this.getMetadataFallback(url)
                    if (fallbackMeta.description) {
                        meta.description = fallbackMeta.description
                        console.log(`[TikTokModule] Fallback SUCCESS: Extracted caption: "${meta.description}"`)
                    } else {
                        console.log('[TikTokModule] Fallback returned empty caption.')
                    }
                } catch (e: any) {
                    console.error('[TikTokModule] Fallback FAILED:', e.message)
                }
            }

            console.log(`[TikTokModule] Extraction Phase Completed. Selected Stream: ${videoStreamUrl.substring(0, 60)}...`)

        } catch (e: any) {
            Sentry.captureException(e, { tags: { module: 'tiktok', operation: 'downloadVideo_library', url } })
            console.error('[TikTokModule] Library extraction fatal error:', e.message)
            console.log('[TikTokModule] Redirecting to FULL Puppeteer download fallback...')
            return await this.downloadVideoFallback(url, filePath)
        }

        // 2.5. Check Cache
        if (await fs.pathExists(filePath)) {
            const stats = await fs.stat(filePath)
            if (stats.size > 50 * 1024) {
                console.log(`[TikTokModule] [Cache] Pre-existing video found: ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(2)}MB).`)
                return { filePath, cached: true, meta }
            } else {
                console.log(`[TikTokModule] [Cache] Corrupt video found (${stats.size} bytes). Deleting and re-downloading...`)
                await fs.remove(filePath)
            }
        }

        // 3. Download the Extracted URL
        console.log(`[TikTokModule] Initiating stream download via Axios. Path: ${filePath}`);
        try {
            const writer = fs.createWriteStream(filePath)
            const response = await axios({
                url: videoStreamUrl,
                method: 'GET',
                responseType: 'stream',
                headers: downloadHeaders,
                timeout: 60000 // 60 second timeout for initial connection/headers
            })

            console.log(`[TikTokModule] HTTP Response Status: ${response.status} ${response.statusText}`);
            console.log(`[TikTokModule] HTTP Response Headers:`, JSON.stringify(response.headers, null, 2));

            let downloadedBytes = 0;
            response.data.on('data', (chunk: Buffer) => {
                downloadedBytes += chunk.length;
                // Log progress every 5MB
                if (downloadedBytes % (5 * 1024 * 1024) < chunk.length) {
                    console.log(`[TikTokModule] Download Progress: ${(downloadedBytes / 1024 / 1024).toFixed(2)}MB transferred...`);
                }
            });

            response.data.pipe(writer)

            return new Promise((resolve, reject) => {
                writer.on('finish', async () => {
                    // Validate file size
                    try {
                        const stats = await fs.stat(filePath)
                        if (stats.size < 50 * 1024) { // < 50KB
                            console.warn(`Downloaded file too small (${stats.size} bytes). Retrying with fallback...`)
                            // If library gave a bad link (e.g. access denied HTML), try fallback
                            try {
                                const fallbackResult = await this.downloadVideoFallback(url, filePath)
                                resolve(fallbackResult)
                            } catch (err: any) {
                                reject(new Error(`Downloaded file too small (${stats.size} bytes) and fallback failed: ${err.message}`))
                            }
                        } else {
                            resolve({ filePath, cached: false, meta })
                        }
                    } catch (e) {
                        reject(e)
                    }
                })
                writer.on('error', reject)
            })
        } catch (error: any) {
            if (error.response && error.response.status === 429) {
                console.warn('[TikTokModule] Rate limit (429) detected in downloadVideo.')
                try {
                    const { jobQueue } = require('../../services/JobQueue')
                    jobQueue.setGlobalThrottle(30)
                } catch (e) { }
            }
            Sentry.captureException(error, { tags: { module: 'tiktok', operation: 'downloadVideo_axios' } })
            console.error('Download failed:', error)
            throw error
        }
    }

    // Original Puppeteer Logic moved to Fallback
    async downloadVideoFallback(url: string, filePath: string): Promise<{ filePath: string, cached: boolean, meta?: any }> {
        console.log('Starting Puppeteer Fallback Download...')
        // Use Browser to get actual video stream
        if (!browserService.isConnected()) {
            await browserService.init(true)
        }

        const page = await browserService.newPage()
        if (!page) throw new Error('Failed to create page for download')

        let videoStreamUrl = ''
        let largestVideoSize = 0
        let videoHeaders: any = {}
        let description = ''

        // Timeout race: Network Intercept vs DOM Extraction
        try {
            // 1. Setup Network Interception
            page.on('response', async (response: Response) => {
                const url = response.url()
                const headers = await response.allHeaders()
                const contentType = headers['content-type'] || ''
                const contentLength = parseInt(headers['content-length'] || '0')

                // Check for video content type or large media files
                const isVideo = contentType.includes('video/') || (url.includes('video/tos') && contentLength > 1024 * 1024)

                if (isVideo && contentLength > 1 * 1024 * 1024) { // > 1MB
                    console.log(`[Playback] Found candidate video stream: ${url} (${contentLength} bytes)`)

                    if (contentLength > largestVideoSize) {
                        largestVideoSize = contentLength
                        videoStreamUrl = url
                        // Capture request headers to replay the download
                        videoHeaders = await response.request().allHeaders()
                    }
                }
            })

            console.log('Navigating to video page...')
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

            // Wait a bit for media to load
            await page.waitForTimeout(5000)

            // 2. Fallback / DOM Extraction (if no network intercept)
            if (!videoStreamUrl) {
                videoStreamUrl = await page.evaluate(() => {
                    const video = document.querySelector('video')
                    return video ? video.src : ''
                })
            }

            // 3. Extract Description (Critical Fix)
            // 3. Extract Description (Critical Fix)
            description = await page.evaluate(() => {
                const descEl = document.querySelector('[data-e2e="browse-video-desc"]') ||
                    document.querySelector('[data-e2e="video-desc"]')

                let raw = '';
                if (descEl && descEl.textContent) raw = descEl.textContent.trim()
                else {
                    const metaDesc = document.querySelector('meta[property="og:description"]')
                    if (metaDesc) raw = metaDesc.getAttribute('content') || ''
                    else {
                        const title = document.querySelector('title')
                        if (title) raw = title.innerText.replace(' | TikTok', '').trim()
                    }
                }

                if (!raw) return '';
                return raw;
            })
            console.log(`[DEBUG_DESC] Extracted Description (Fallback): "${description}"`)

            console.log(`Extracted Video URL: ${videoStreamUrl} (Size: ${largestVideoSize})`)

        } catch (e) {
            Sentry.captureException(e, { tags: { module: 'tiktok', operation: 'downloadVideoFallback' } })
            console.error('Extraction error:', e)
        } finally {
            await page.close()
        }

        if (!videoStreamUrl || videoStreamUrl.startsWith('blob:')) {
            await (this as any).handleCaptchaDetection(page, `download_fallback_${path.basename(filePath)}`)
            throw new Error(`Failed to extract valid video URL. Got: ${videoStreamUrl || 'nothing'}`)
        }

        // 3. Download the Extracted URL
        const writer = fs.createWriteStream(filePath)

        // Prepare headers: use captured or fallback
        const downloadHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        }

        // Merge safe video headers
        if (videoHeaders) {
            for (const [key, value] of Object.entries(videoHeaders)) {
                // Skip HTTP/2 pseudo-headers (start with :) and other unsafe headers
                if (key.startsWith(':')) continue
                if (['host', 'connection', 'content-length', 'accept-encoding'].includes(key.toLowerCase())) continue
                downloadHeaders[key] = value as string
            }
        }

        const response = await axios({
            url: videoStreamUrl,
            method: 'GET',
            responseType: 'stream',
            headers: downloadHeaders,
            timeout: 60000 // 60s timeout
        })

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                // Validate file size
                try {
                    const stats = await fs.stat(filePath)
                    if (stats.size < 50 * 1024) { // < 50KB
                        reject(new Error(`Downloaded file too small (${stats.size} bytes). Path: ${filePath}`))
                    } else {
                        // CRITICAL FIX: Return the `meta` object populated from Puppeteer
                        const meta = { description }
                        resolve({ filePath, cached: false, meta })
                    }
                } catch (e) {
                    reject(e)
                }
            })
            writer.on('error', reject)
        })
    }

    // New helper to fetch metadata only
    async getMetadataFallback(url: string): Promise<{ description: string }> {
        console.log('[TikTokModule] Starting Puppeteer Metadata Extraction (Lazy)...')
        // Use Browser to get actual video stream
        if (!browserService.isConnected()) {
            await browserService.init(true)
        }

        const page = await browserService.newPage()
        if (!page) throw new Error('Failed to create page for metadata')

        let description = ''
        try {
            console.log(`[TikTokModule] Navigating to ${url} for metadata...`)
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

            // Try to wait for the specific selector requested by user
            try {
                console.log('[TikTokModule] Waiting for selector [data-e2e="browse-video-desc"] or [data-e2e="video-desc"]...')
                await page.waitForSelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]', { timeout: 10000 })
                console.log('[TikTokModule] Selector found!')
            } catch (e) {
                console.warn('[TikTokModule] Selector wait timeout. Attempting immediate extraction...')
            }

            description = await page.evaluate(() => {
                const descEl = document.querySelector('[data-e2e="browse-video-desc"]') ||
                    document.querySelector('[data-e2e="video-desc"]')

                if (descEl && descEl.textContent) return descEl.textContent.trim()

                const metaDesc = document.querySelector('meta[property="og:description"]')
                if (metaDesc) return metaDesc.getAttribute('content') || ''

                const title = document.querySelector('title')
                if (title) return title.innerText.replace(' | TikTok', '').trim()

                return ''
            })
        } catch (e) {
            console.error('[TikTokModule] Metadata extraction error:', e)
        } finally {
            await page.close()
        }
        return { description }
    }

    async publishVideo(filePath: string, caption: string, cookies?: any[], onProgress?: (msg: string) => void, options?: { advancedVerification?: boolean; username?: string }): Promise<{ success: boolean, videoUrl?: string, error?: string, videoId?: string, isReviewing?: boolean, warning?: string, debugArtifacts?: { screenshot?: string, html?: string, logs?: string[] } }> {
        // Generate unique hashtag for verification ONLY if requested
        const useUniqueTag = options?.advancedVerification || false
        const uniqueTag = '#' + Math.random().toString(36).substring(2, 8);
        const finalCaption = useUniqueTag ? (caption + ' ' + uniqueTag) : caption;

        console.log(`[TikTokModule] [PUBLISH] Starting publish workflow:`)
        console.log(`  - File: ${filePath}`)
        console.log(`  - Verification Tag: ${useUniqueTag ? uniqueTag : 'Disabled'}`)
        console.log(`  - Raw Caption: "${caption}"`)
        console.log(`  - Final Caption: "${finalCaption}"`)

        if (onProgress) onProgress('Initializing browser...')
        let page: Page | null = null

        let uploadStartTime = 0 // Timestamp to match video creation time if tag is disabled

        try {
            // Ensure headed browser for upload reliability
            await browserService.init(false)

            page = await browserService.newPage()
            if (!page) throw new Error('Failed to create page')

            // ─── INJECT COOKIES ───
            if (cookies && cookies.length > 0) {
                try {
                    const sanitized = cookies.map((c: any) => {
                        if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None'
                        if (c.sameSite === 'lax') c.sameSite = 'Lax'
                        if (c.sameSite === 'strict') c.sameSite = 'Strict'
                        if (c.sameSite === 'None') c.secure = true
                        return c
                    })
                    await page.context().addCookies(sanitized)
                    console.log(`Restored ${cookies.length} session cookies`)
                } catch (e) { console.error('Cookie injection failed:', e) }
            } else {
                throw new Error('No cookies provided. Please re-login the publish account.')
            }

            // ─── Helper: Smart Overlay/Modal Cleaner ───
            // ─── Helper: Smart Overlay/Modal Cleaner ───
            const cleanOverlays = async (targetSelector?: string) => {
                if (onProgress) onProgress('Checking for overlays...')
                console.log(`[TikTokModule] [cleanOverlays] Start (Target: ${targetSelector || 'None'})`)

                const commonSelectors = [
                    'button[aria-label="Close"]', 'button[aria-label="close"]',
                    'svg[data-icon="close"]', 'div[role="dialog"] button[aria-label="Close"]',
                    '[data-e2e="modal-close-inner-button"]', '[data-e2e="modal-close-button"]',
                    'div[role="dialog"] button:first-child', // Risky but often close button is first
                    // Cookie Banner Specifics
                    '.tiktok-cookie-setting-modal-close',
                    'button:has-text("Decline all")', 'button:has-text("Accept all")',
                    'button:has-text("Từ chối tất cả")', 'button:has-text("Chấp nhận tất cả")',
                    'button:has-text("Allow all cookies")', 'button:has-text("Decline")',
                    'div[classList*="cookie"] button'
                ]

                // Add debug dump if it gets stuck
                const safetyTimer = setTimeout(async () => {
                    console.log('[TikTokModule] [cleanOverlays] [WARNING] Timeout reached (10s)! Dumping state...')
                    try {
                        const ts = Date.now()
                        const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                        await fs.ensureDir(debugDir)
                        await page?.screenshot({ path: path.join(debugDir, `overlay_stuck_${ts}.png`) })
                        const html = await page?.content() || ''
                        await fs.writeFile(path.join(debugDir, `overlay_stuck_${ts}.html`), html)
                        console.log(`[TikTokModule] [cleanOverlays] Snapshot saved: overlay_stuck_${ts}.html`)
                    } catch (e) { console.error('[TikTokModule] [cleanOverlays] Failed to dump stuck state:', e) }
                }, 10000) // 10s warning

                try {
                    // Maximum time for overlay cleaning: 15 seconds
                    await Promise.race([
                        (async () => {
                            for (const sel of commonSelectors) {
                                try {
                                    // Ultra short timeout check
                                    console.log(`[TikTokModule] [cleanOverlays] Checking selector: ${sel}`)
                                    const btn = await page!.$(sel)
                                    if (btn) {
                                        const visible = await btn.isVisible()
                                        console.log(`[TikTokModule] [cleanOverlays] Result for ${sel}: Found=${!!btn}, Visible=${visible}`)
                                        if (visible) {
                                            console.log(`[TikTokModule] [cleanOverlays] Action: Clicking ${sel}...`)
                                            await btn.click({ force: true, timeout: 500 }).catch(() => { })
                                            await page!.waitForTimeout(300)
                                            console.log(`[TikTokModule] [cleanOverlays] Action: Done.`)
                                        }
                                    } else {
                                        console.log(`[TikTokModule] [cleanOverlays] Result for ${sel}: Not on page.`)
                                    }
                                } catch (e: any) {
                                    console.log(`[TikTokModule] [cleanOverlays] Error checking ${sel}: ${e.message}`)
                                }
                            }

                            console.log('[TikTokModule] [cleanOverlays] Sending [Escape] key as final fallback.')
                            await page!.keyboard.press('Escape')

                            // Obstruction check (omitted for speed unless strictly needed)
                            if (targetSelector) {
                                console.log(`[TikTokModule] [cleanOverlays] Obstruction check for target: ${targetSelector}`)
                                // (Logic omitted for brevity as per existing code)
                            }
                        })(),
                        new Promise(resolve => setTimeout(resolve, 15000))
                    ])
                } catch (e: any) {
                    console.log(`[TikTokModule] [cleanOverlays] Fatal error during cleanup: ${e.message}`)
                } finally {
                    clearTimeout(safetyTimer)
                    console.log('[TikTokModule] [cleanOverlays] Finished.')
                    if (onProgress) onProgress('Overlays cleared.')
                }
            }

            // Helper to Retry Actions with cleaning
            const interactWithRetry = async (action: () => Promise<any>, targetSel: string) => {
                for (let i = 0; i < 5; i++) {
                    try {
                        await cleanOverlays(targetSel)
                        await action()
                        return
                    } catch (e: any) {
                        if (i === 4) throw e
                        console.log(`   Action failed, retrying after cleaning...`)
                        await page!.waitForTimeout(1000)
                    }
                }
            }

            // ─── Navigate to TikTok Studio Upload ───
            console.log('Navigating to TikTok Studio upload page...')
            uploadStartTime = Math.floor(Date.now() / 1000)
            if (onProgress) onProgress('Navigating to upload page...')
            try {
                await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=webapp', {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                })
            } catch (e: any) {
                if (e.message.includes('interrupted by another navigation') || e.message.includes('navigating to')) {
                    console.log('  ⚠️ Navigation redirected (expected)')
                } else {
                    throw e
                }
            }
            await page.waitForTimeout(3000)
            console.log('Upload page URL:', page.url())

            if (page.url().includes('/login')) {
                throw new Error('Session expired: redirected to login page. Please re-login.')
            }

            // ─── Upload file with retry ───
            const MAX_UPLOAD_RETRIES = 3
            let fileUploaded = false

            for (let uploadAttempt = 1; uploadAttempt <= MAX_UPLOAD_RETRIES; uploadAttempt++) {
                console.log(`[TikTokModule] [PUBLISH] Upload attempt ${uploadAttempt}/${MAX_UPLOAD_RETRIES}...`)
                if (onProgress) onProgress(`Uploading video (Attempt ${uploadAttempt})...`)
                await cleanOverlays()

                if (onProgress) onProgress('Waiting for file input...')

                // Attempt to find file input. If not found, try clicking "Select File" buttons.
                // Attempt to find file input. If not found, try clicking "Select File" buttons.
                let fileInput = await page.$('input[type="file"]')

                if (!fileInput) {
                    console.log('  File input not found immediately. Looking for "Select File" buttons...')

                    // DEBUG: Log all buttons to see what's available
                    try {
                        // FIX: innerText -> textContent for SVG/Element compat
                        const buttons = await page.$$eval('button, div[role="button"]', els => els.map(e => e.textContent?.trim()).filter(Boolean));
                        console.log('  [DEBUG] Visible buttons on page:', buttons.join(', '));
                    } catch (e) { console.log('  [DEBUG] Failed to list buttons'); }

                    // Try to click "Select file" or similar to trigger input
                    const uploadBtns = [
                        // Data-E2E attributes (Primary)
                        '[data-e2e="upload-icon"]',
                        '[data-e2e="file-upload-container"]',
                        '[data-e2e="upload-video-button"]',

                        // Structural/Class-based (Secondary - Language Agnostic)
                        'div[class*="upload-btn"]',
                        'div[class*="upload-container"]',
                        '.upload-btn-input',

                        // Semantic/Role-based
                        'div[role="button"][class*="upload"]',
                        'div[role="button"][class*="select"]',
                    ]

                    for (const btnSel of uploadBtns) {
                        try {
                            // Use a broader search
                            const btn = await page.locator(btnSel).first();
                            if (await btn.isVisible()) {
                                console.log(`  Clicking upload button candidate: ${btnSel}`)
                                await btn.click({ force: true })
                                await page.waitForTimeout(1500)
                                fileInput = await page.$('input[type="file"]')
                                if (fileInput) {
                                    console.log('  Files input appeared!');
                                    break
                                }
                            }
                        } catch (e) { }
                    }
                }

                if (!fileInput) {
                    // Last ditch: Click the CENTER of the screen, as the upload box is usually central
                    console.log('  Last resort: Clicking center of page to trigger upload...')
                    try {
                        const viewport = page.viewportSize();
                        if (viewport) {
                            const x = viewport.width / 2;
                            const y = viewport.height / 2;
                            console.log(`[TikTokModule] [PUBLISH] Last resort: Clicking center coordinates (X:${x}, Y:${y}) on ${viewport.width}x${viewport.height} viewport...`)
                            await page.mouse.click(x, y);
                            await page.waitForTimeout(1500);
                            fileInput = await page.$('input[type="file"]')
                        }
                    } catch (e) { }
                }

                if (!fileInput) {
                    // One last wait
                    try {
                        console.log('  Waiting explicitly for generic file input...')
                        fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 10000 })
                    } catch (e) {
                        console.error('  ❌ File input timeout. Dumping state...')
                        const ts = Date.now()
                        const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                        await fs.ensureDir(debugDir)
                        await page.screenshot({ path: path.join(debugDir, `upload_fail_${ts}.png`) })
                        const html = await page.content()
                        await fs.writeFile(path.join(debugDir, `upload_fail_${ts}.html`), html)
                        console.log(`  [DEBUG] Saved HTML to ${path.join(debugDir, `upload_fail_${ts}.html`)}`)
                        throw new Error('File input not found (Debug saved)')
                    }
                }

                if (!fileInput) throw new Error('File input not found on upload page')

                // Ensure hidden inputs can be triggered
                // await fileInput.setInputFiles(filePath) // Standard Playwright
                // Sometimes Playwright needs the element to be visible-ish? 
                // state: 'attached' allows hidden. setInputFiles handles hidden inputs automatically.

                console.log(`[TikTokModule] [PUBLISH] Selecting file: ${filePath}`)
                try {
                    await fileInput.setInputFiles(filePath)
                } catch (err: any) {
                    console.error('  setInputFiles failed:', err)
                    // Fallback using DOM manipulation if standard way fails?
                    throw err
                }

                console.log('[TikTokModule] [PUBLISH] File selected and upload initiated.')

                let uploadReady = false
                let uploadError = false

                for (let waitCycle = 0; waitCycle < 60; waitCycle++) {
                    await page.waitForTimeout(2000)

                    // Check for ERROR popups (English + Vietnamese)
                    // Check for ERROR popups (Toast/Alert classes)
                    // tiktok-toast, data-e2e="toast-message"
                    try {
                        const errEl = await page.locator('[data-e2e="toast-message"], .tiktok-toast, [role="alert"]').first()
                        if (await errEl.isVisible()) {
                            const errText = await errEl.textContent()
                            console.log(`[TikTokModule] [PUBLISH] ❌ Upload error detected: "${errText}"`)
                            uploadError = true
                        }
                    } catch { /* ignore */ }



                    if (uploadError) {
                        console.log('  Dismissing error popup...')
                        await cleanOverlays()
                        // Try Retry button
                        try {
                            const retryBtn = await page.$('button:has-text("Retry"), button:has-text("Thử lại")')
                            if (retryBtn && await retryBtn.isVisible()) {
                                await retryBtn.click()
                                console.log('  Clicked "Retry"')
                                await page.waitForTimeout(2000)
                                uploadError = false
                                continue
                            }
                        } catch { /* no retry */ }
                        break
                    }

                    // Check for upload completion (English + Vietnamese)
                    // Check for upload completion (Input fields appear)
                    for (const sel of [
                        '[data-e2e="caption-input"]',
                        '.public-DraftEditor-content',
                        '[data-e2e="post-button"]',
                        '[data-e2e="post-video-button"]'
                    ]) {
                        try {
                            const el = await page.$(sel)
                            if (el && await el.isVisible()) {
                                console.log(`  ✅ Upload ready: ${sel}`)
                                uploadReady = true
                                break
                            }
                        } catch { /* ignore */ }
                    }

                    if (uploadReady) break
                    if (waitCycle % 10 === 0 && waitCycle > 0) console.log(`  Still uploading... (${waitCycle * 2}s)`)
                }

                if (uploadReady) { fileUploaded = true; break }
                if (uploadAttempt < MAX_UPLOAD_RETRIES) {
                    console.log(`  Attempt ${uploadAttempt} failed, retrying...`)
                    await cleanOverlays()
                    await page.reload()
                    await page.waitForTimeout(3000)
                }
            }

            if (!fileUploaded) throw new Error(`File upload failed after ${MAX_UPLOAD_RETRIES} attempts`)

            // ─── Handle Content Check Popups & Clear Overlays ───
            console.log('\n🧹 Handling special popups (Content Check, etc)...')
            if (onProgress) onProgress('Checking for content warnings...')
            // Handle "Run a copyright check" or "Automatic content checks"
            try {
                const checkPopup = await page.locator('text="Run a copyright check"').or(page.locator('text="Automatic content checks"'))
                if (await checkPopup.isVisible({ timeout: 5000 })) {
                    console.log('  ⚠️ Detected Content Check popup')
                    const turnOnBtn = await page.locator('button:has-text("Turn on"), button:has-text("Try it now"), button:has-text("Run check")').first()
                    if (await turnOnBtn.isVisible()) {
                        await turnOnBtn.click()
                        console.log('  Clicked "Turn on" / "Run check"')
                        await page.waitForTimeout(1000)
                    }
                }
            } catch { /* ignore */ }

            await cleanOverlays()
            await page.waitForTimeout(500)

            // ─── CHECK FOR SPECIFIC VIOLATIONS (User Request) ───
            try {
                // "Content may be restricted"
                const restrictionEl = await page.locator('text="Content may be restricted"')
                    .or(page.locator('text="Violation reason"'))
                    .or(page.locator('text="Nội dung có thể bị hạn chế"'))
                    .first()

                if (await restrictionEl.isVisible()) {
                    console.log('[TikTokModule] [PUBLISH] ❌ CRITICAL: Detected "Content may be restricted" popup!')
                    throw new Error('TikTok detected content violation/restriction during upload.')
                }
            } catch (e: any) {
                if (e.message.includes('violation')) throw e
            }

            // ─── Set Caption ───
            console.log('[TikTokModule] [PUBLISH] Setting caption...')
            if (onProgress) onProgress('Setting video caption...')
            let captionSet = false
            for (const sel of [
                '[data-e2e="caption-input"]', // Primary TikTok selector
                '.public-DraftEditor-content',
                '[contenteditable="true"][role="textbox"]',
                '[contenteditable="true"].notranslate',
                'div[contenteditable="true"][data-placeholder]',
                '[contenteditable="true"]'
            ]) {
                try {
                    console.log(`[DEBUG_DESC] Checking selector: ${sel}`)
                    const editor = await page!.$(sel)
                    if (editor && await editor.isVisible()) {
                        console.log(`[DEBUG_DESC] Found editor with selector: ${sel}`)
                        if (onProgress) onProgress('Typing caption...')
                        await interactWithRetry(async () => {
                            await editor!.click()
                            await page!.waitForTimeout(300)
                            await page!.keyboard.press('Control+a')
                            await page!.keyboard.press('Backspace')
                            await page!.waitForTimeout(200)
                            await page!.keyboard.type(finalCaption, { delay: 20 })
                        }, sel)
                        console.log(`[TikTokModule] [PUBLISH] Caption set successfully using: ${sel}`)
                        captionSet = true
                        break
                    }
                } catch (e: any) {
                    console.log(`[DEBUG_DESC] Failed to set caption with ${sel}: ${e.message}`)
                }
            }
            if (!captionSet) {
                console.warn('  ⚠️ Could not find caption editor. Dumping HTML...')
                try {
                    const ts = Date.now()
                    const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                    await fs.ensureDir(debugDir)

                    if (page && !page.isClosed()) {
                        const html = await page!.content()
                        await fs.writeFile(path.join(debugDir, `caption_fail_${ts}.html`), html)
                        await page!.screenshot({ path: path.join(debugDir, `caption_fail_${ts}.png`) })
                        console.log(`  📄 HTML Dump saved to: ${path.join(debugDir, `caption_fail_${ts}.html`)}`)
                    } else {
                        console.warn('  ⚠️ Cannot dump: Page already closed.')
                    }
                } catch (e) { console.error('Failed to dump caption debug:', e) }
            }

            if (page.isClosed()) throw new Error('Browser closed unexpectedly before posting.')
            await page.waitForTimeout(1000)

            // ─── Click Post button ───
            console.log('\n🚀 Posting video...')
            if (onProgress) onProgress('Clicking Post button...')
            let posted = false
            // FIX: Re-added "Đăng" and "POST"
            const postSelectors = ['[data-e2e="post-video-button"]', '[data-e2e="post-button"]', 'div[class*="btn-post"]']

            // Ensure overlays are gone before clicking post
            await cleanOverlays()

            // ─── Verified Smart Scroll & Click Logic with Retry ───
            if (onProgress) onProgress('Locating Post button...')

            // USER REQUEST: Zoom out to 33% to reveal the button
            console.log('🔧 Zooming out to 33% (User Request)...')
            await page.evaluate(() => { document.body.style.zoom = '0.33' })

            console.log('⏳ Waiting 5s for UI to settle (User Request)...')
            await new Promise(resolve => setTimeout(resolve, 5000))

            // DUMP BEFORE POST (User Request)
            try {
                const ts = Date.now()
                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                await fs.ensureDir(debugDir)
                if (page && !page.isClosed()) {
                    await fs.writeFile(path.join(debugDir, `before_post_${ts}.html`), await page.content())
                    await page.screenshot({ path: path.join(debugDir, `before_post_${ts}.png`) })
                    console.log(`[TikTokModule] [PUBLISH] 📸 HTML dump captured BEFORE posting: before_post_${ts}.html`)
                }
            } catch (e) { console.warn(`[TikTokModule] [PUBLISH] ⚠️ Failed to dump pre-post state: ${e}`) }

            console.log('📜 Looking for scrollable container...')

            let bestBtn = null
            let maxY = -1
            let postButtonFound = false


            // Retry loop for finding the button (30 seconds)
            for (let i = 0; i < 15; i++) {
                if (onProgress) onProgress(`Searching for Post button (Attempt ${i + 1}/15)...`)

                // Smart Selection: Find bottom-most visible Post button using Playwright Locators
                // Priority: 1. data-e2e OR Text Match (English/Vietnamese) OR "Red Button"
                // This makes it language agnostic.
                const buttons = page.locator('button, div[role="button"]');
                const count = await buttons.count();

                let bestBtn = null;
                let bestScore = -1;
                let maxY = -1;

                for (let j = 0; j < count; j++) {
                    const btn = buttons.nth(j);
                    if (await btn.isVisible()) {
                        const box = await btn.boundingBox();
                        if (!box) continue;

                        // Calculate Score
                        let score = 0;
                        const text = (await btn.innerText()).trim();
                        const dataE2E = await btn.getAttribute('data-e2e');
                        const style = await btn.evaluate((el) => {
                            const s = window.getComputedStyle(el);
                            return { bg: s.backgroundColor };
                        });

                        // 1. Exact ID Match (Strongest)
                        if (dataE2E === 'post-video-button') score += 100;

                        // 2. Text Match (Medium)
                        if (text === 'Post' || text === 'Đăng' || text.includes('Post')) score += 50;

                        // 3. Visual Match: Red Color (Strong Fallback for any language)
                        // TikTok Red is roughly rgb(254, 44, 85) or #fe2c55
                        if (style.bg.includes('254') && style.bg.includes('44') && style.bg.includes('85')) {
                            score += 80; // High confidence for Red button
                        }

                        // Filter out non-candidates
                        if (score === 0) continue;

                        // Select best logic: Higher score wins. If tie, bottom-most wins.
                        if (score > bestScore) {
                            bestScore = score;
                            bestBtn = btn;
                            maxY = box.y;
                        } else if (score === bestScore) {
                            if (box.y > maxY) {
                                maxY = box.y;
                                bestBtn = btn;
                            }
                        }
                    }
                }

                if (bestBtn) {
                    console.log(`  ✅ Found candidate button at Y=${maxY} (Score: ${bestScore})`)
                    try {
                        await cleanOverlays()
                        await bestBtn.click()
                        console.log('🚀 Clicked Post button via Smart Selection')
                        postButtonFound = true
                        posted = true

                        // ─── CRITIAL: Handle "Continue to post?" Dialog ───
                        console.log('⏳ Checking for confirmation dialog (Post now/Vẫn đăng)...')
                        await page.waitForTimeout(2000) // Wait for dialog animation

                        const confirmSelectors = [
                            'button:has-text("Post now")',
                            'button:has-text("Vẫn đăng")',
                            'button:has-text("Continue")',
                            'button:has-text("Post anyway")',
                            'div[role="dialog"] button:has-text("Post")', // Generic dialog button
                            'div[role="dialog"] button:has-text("Đăng")'
                        ]

                        for (const sel of confirmSelectors) {
                            const btn = await page.$(sel)
                            if (btn && await btn.isVisible()) {
                                console.log(`⚠️ Found confirmation button: ${sel}. Clicking...`)
                                await btn.click()
                                await page.waitForTimeout(2000)
                                break
                            }
                        }

                        break;
                    } catch (e) {
                        console.warn('  Click failed, retrying...', e)
                    }
                } else {
                    console.log('  No Post button found yet...')
                }

                // Fallback scroll if smart selection failed
                const scrollHandle = await page!.evaluateHandle(() => {
                    const potential = Array.from(document.querySelectorAll('*')).filter(el => {
                        const style = window.getComputedStyle(el)
                        return (style.overflowY === 'scroll' || style.overflowY === 'auto') && el.scrollHeight > el.clientHeight
                    })
                    potential.sort((a, b) => b.scrollHeight - a.scrollHeight)
                    return potential.length > 0 ? potential[0] : document.documentElement
                })

                if (scrollHandle) {
                    await scrollHandle.evaluate((el: Element) => {
                        el.scrollTop = el.scrollHeight;
                    }).catch(() => { })
                }
                await page.waitForTimeout(2000)
            }

            if (!posted) throw new Error('Could not find or click Post button - Debug artifacts saved.')

            // ─── Verify success & extract video link ───
            console.log('\n⏳ Verifying post success...')

            // DUMP AFTER POST (User Request)
            try {
                const ts = Date.now()
                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                await fs.ensureDir(debugDir)
                if (page && !page.isClosed()) {
                    await fs.writeFile(path.join(debugDir, `after_post_${ts}.html`), await page.content())
                    await page.screenshot({ path: path.join(debugDir, `after_post_${ts}.png`) })
                    console.log(`[TikTokModule] [PUBLISH] 📸 HTML dump captured AFTER posting: after_post_${ts}.html`)
                }
            } catch (e) { console.warn(`[TikTokModule] [PUBLISH] ⚠️ Failed to dump post-post state: ${e}`) }

            if (onProgress) onProgress('Verifying publication...')
            let videoUrl: string | undefined
            let videoId: string | undefined
            let isReviewing = false
            let isSuccess = false
            let isPublished = false
            let debugArtifacts: { screenshot?: string, html?: string, logs?: string[] } | undefined

            // Define helper locally for Fallback Profile Scan
            const extractProfileVideo = async () => {
                try {
                    const videoEl = await page!.$('[data-e2e="user-post-item"] a');
                    if (videoEl) {
                        const href = await videoEl.getAttribute('href');
                        if (href && (href.includes('/video/') || href.includes('/v/'))) return href;
                    }
                    const links = await page!.$$eval('a', els => els.map(e => e.href));
                    const videoLink = links.find(l => (l.includes('/video/') || l.includes('/v/')) && l.includes('tiktok.com'));
                    if (videoLink) return videoLink;
                } catch { }
                return undefined
            }

            // 5. Wait for "View Profile" or "Manage your posts" or Timeout
            const successSelectors = [
                'div:has-text("Manage your posts")',
                'div:has-text("View Profile")',
                'div:has-text("Upload complete")',
                'div:has-text("Video uploaded")',
                'span:has-text("Posts (Created on)")', // Dashboard table header
                'div[data-tt="components_PostTable_Container"]', // Dashboard table container
                // Vietnamese
                'div:has-text("Quản lý bài đăng")',
                'div:has-text("Xem hồ sơ")',
                'div:has-text("Đã tải lên video")',
                'div:has-text("Tải lên hoàn tất")'
            ]


            for (let i = 0; i < 120; i++) { // Increase wait to 2 minutes max
                if (page.isClosed()) throw new Error('Browser page closed unexpectedly during verification')
                try { await page.waitForTimeout(1000) } catch (e) { break }

                // Check for "Uploading..."
                try {
                    const uploadingEl = await page!.$('text="Your video is being uploaded"') || await page!.$('text="Video của bạn đang được tải lên"')
                    if (uploadingEl && await uploadingEl.isVisible()) {
                        if (i % 5 === 0) console.log('  ⏳ Upload in progress...')
                        if (onProgress && i % 10 === 0) onProgress('Uploading video...')
                        continue;
                    }
                } catch { }

                // Check for Success (Text or Dashboard)
                for (const selector of successSelectors) {
                    console.log(`[TikTokModule] [PUBLISH] [Poll:${i}] Checking success selector: ${selector}`)
                    if (await page.$(selector).catch(() => null)) {
                        console.log(`[TikTokModule] [PUBLISH] [Poll:${i}] ✅ Publication verified found: ${selector}`)
                        isPublished = true
                        break
                    }
                }

                // ─── Structural Modal Check (Exclusion Logic) ───
                console.log(`[TikTokModule] [PUBLISH] [Poll:${i}] Performing structural modal check (dialogs/modals)...`)
                try {
                    const dialogs = page.locator('div[role="dialog"], div[class*="modal"], div[class*="dialog-content"], div[class*="TUXModal"]');
                    const count = await dialogs.count();
                    console.log(`[TikTokModule] [PUBLISH] [Poll:${i}] Potential modals/dialogs count: ${count}`)

                    for (let d = 0; d < count; d++) {
                        const dialog = dialogs.nth(d);
                        if (await dialog.isVisible()) {
                            const text = (await dialog.innerText()) || '';
                            const cleanText = text.replace(/\n+/g, ' ').trim();

                            // 1. Is this a SUCCESS modal?
                            const isSuccessModal = successSelectors.some(s => {
                                // Extract simple text from selector for matching
                                const keyMatch = s.match(/"([^"]+)"/);
                                const key = keyMatch ? keyMatch[1] : '';
                                return key && cleanText.includes(key);
                            });

                            if (isSuccessModal) {
                                console.log(`✅ Success detected via Generic Modal: ${cleanText.substring(0, 50)}...`)
                                isPublished = true
                                break;
                            }

                            // 2. FAIL FAST: Valid text + Not Success = Violation
                            if (!isPublished && cleanText.length > 5) {
                                console.log(`❌ Structural Error Detected (Blocking via Modal): ${cleanText.substring(0, 100)}...`);

                                // Dump artifacts
                                const errorTime = Date.now()
                                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                                await fs.ensureDir(debugDir)
                                const screenshotPath = path.join(debugDir, `violation_modal_${errorTime}.png`)
                                const htmlPath = path.join(debugDir, `violation_modal_${errorTime}.html`)

                                await page.screenshot({ path: screenshotPath, fullPage: true }).catch(e => console.error('Screenshot failed:', e))
                                await fs.writeFile(htmlPath, await page.content()).catch(e => console.error('HTML dump failed:', e))

                                debugArtifacts = {
                                    screenshot: screenshotPath,
                                    html: htmlPath,
                                    logs: [`Violation Text: ${cleanText}`]
                                }

                                // Throw immediately to fail the job (No retry loop)
                                return {
                                    success: false,
                                    error: `TikTok Violation Caught: ${cleanText.substring(0, 200)}`,
                                    debugArtifacts
                                }
                            }
                        }
                    }
                } catch (e) { /* Ignore locator errors */ }

                if (isPublished) break

            }
            // End of polling loop

            if (!isPublished) {
                // DUMP ON TIMEOUT
                const ts = Date.now()
                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                await fs.ensureDir(debugDir)
                const screenshotPath = path.join(debugDir, `timeout_error_${ts}.png`)
                const htmlPath = path.join(debugDir, `timeout_error_${ts}.html`)

                await page.screenshot({ path: screenshotPath })
                await fs.writeFile(htmlPath, await page.content())

                console.error(`❌ Upload timed out. Artifacts saved: ${screenshotPath}`)

                throw new Error('Upload timed out or success message not found.')
            }

            // 2. Strict Verification via Content Dashboard (JSON + UI)
            console.log('  🎉 UI Success detected. Navigating to Content Dashboard for Status Check...')
            if (onProgress) onProgress('Checking video status...')

            try {
                // 2. Strict Verification via Content Dashboard (Network + UI)
                console.log('  🎉 UI Success detected. Navigating to Content Dashboard for Status Check...')
                if (onProgress) onProgress('Checking video status...')

                try {
                    const dashboardUrl = 'https://www.tiktok.com/tiktokstudio/content';

                    // Setup Network Listener
                    let apiResponseData: any = null;
                    const responseHandler = async (response: Response) => {
                        try {
                            if (response.url().includes('tiktokstudio/content/list')) {
                                console.log('  📡 Intercepted content list API:', response.url());
                                try {
                                    const json = await response.json();
                                    if (json?.data?.post_list) {
                                        apiResponseData = json.data.post_list;
                                    }
                                } catch (e) { console.warn('  ⚠️ Failed to parse API JSON', e) }
                            }
                        } catch { }
                    };
                    page.on('response', responseHandler);

                    await page!.goto(dashboardUrl, { waitUntil: 'domcontentloaded' })

                    // Retry loop for Data availability (5 attempts, ~30s total)
                    for (let check = 1; check <= 5; check++) {
                        console.log(`  🕵️‍♂️ Status Check Attempt ${check}/5...`)
                        if (page.isClosed()) throw new Error('Browser page closed unexpectedly during status check')

                        // Wait for either API response or DOM load
                        try { await page.waitForTimeout(5000) } catch (e) { break }

                        // 2a. Check Intercepted API Data (Primary)
                        if (apiResponseData && apiResponseData.length > 0) {
                            const match = apiResponseData.find((v: any) => {
                                // Match logic
                                if (useUniqueTag && uniqueTag && v.desc && v.desc.includes(uniqueTag)) return true;
                                // Match by creation time (within last 15 mins)
                                // v.create_time is usually seconds
                                const createTime = parseInt(v.create_time);
                                const nowSeconds = Math.floor(Date.now() / 1000);
                                if (createTime >= (nowSeconds - 900)) return true; // Last 15 mins

                                return false;
                            }) || apiResponseData[0]; // Default to first if valid

                            if (match) {
                                const vId = match.item_id;
                                const vDesc = match.desc;
                                const vPrivacy = match.privacy_level; // 1=public
                                const vStatus = match.status; // 10=reviewing?

                                // Construct URL
                                // We need uniqueId for URL, usually in dashboard we are logged in so maybe we can get it from storage or page
                                // For now, construct partial or try to get username
                                let finalUrl = undefined;
                                try {
                                    // Try to get username from page if not known
                                    const u = await page.evaluate(() => (window as any)._tiktok_user_unique_id || document.querySelector('header a')?.getAttribute('href')?.replace('/', '')?.replace('@', ''));
                                    const uname = u || options?.username || 'user';
                                    finalUrl = `https://www.tiktok.com/@${uname}/video/${vId}`;
                                } catch { }

                                const isReview = (vPrivacy !== 1) || (vStatus !== 1); // Logic may vary
                                console.log(`  ✅ Match via API: ${vId} | Review: ${isReview}`);

                                page.off('response', responseHandler); // Cleanup

                                return {
                                    success: true,
                                    videoId: vId,
                                    videoUrl: finalUrl,
                                    isReviewing: isReview
                                };
                            }
                        }

                        // 2b. Attempt UI Table Extraction (Fallback)
                        const uiStatus = await page!.evaluate(() => {
                            const rows = Array.from(document.querySelectorAll('div[data-e2e="recent-post-item"], div[class*="PostItem-"], tr'));
                            if (rows.length > 0) {
                                const topRow = rows[0] as HTMLElement;
                                const text = topRow.innerText;
                                const linkEl = topRow.querySelector('a[href*="/video/"]');
                                const href = linkEl ? linkEl.getAttribute('href') : null;
                                const idMatch = href ? href.match(/\/video\/(\d+)/) : null;
                                const isReviewing = text.includes('Under review') || text.includes('Processing') || text.includes('Đang xét duyệt');
                                return {
                                    id: idMatch ? idMatch[1] : null,
                                    url: href || undefined,
                                    isReviewing
                                };
                            }
                            return null;
                        });

                        if (uiStatus && uiStatus.id) {
                            console.log(`  ✅ Match via UI: ${uiStatus.id}`);
                            page.off('response', responseHandler);
                            return {
                                success: true,
                                videoId: uiStatus.id,
                                videoUrl: uiStatus.url,
                                isReviewing: uiStatus.isReviewing
                            };
                        }

                        console.log('  Status check not ready, expecting data...');
                    }
                    page.off('response', responseHandler);
                } catch (e: any) {
                    console.error('Error during Content Dashboard check:', e)
                    // Dump HTML for debugging
                    try {
                        const ts = Date.now();
                        const debugDir = path.join(app.getPath('userData'), 'debug_artifacts');
                        await fs.ensureDir(debugDir);
                        await fs.writeFile(path.join(debugDir, `dashboard_fail_${ts}.html`), await page.content());
                        console.log(`  📸 Dumped dashboard HTML to dashboard_fail_${ts}.html`);
                    } catch { }
                }

                // Return failure/partial if we reached here
                return { success: true, warning: 'Verification failed - Check Dashboard manually', isReviewing: true };
            } catch (e: any) {
                console.error('Error during Content Dashboard check:', e)
            }

            if (!videoUrl) {
                console.warn('  ⚠️ Could not verify video URL after success. Returning partial success.')
                return { success: true, warning: 'Published but could not satisfy verification.', isReviewing: true }
            }

            console.log('Finalizing post (waiting for success indicator or timeout)...')
            await page.waitForTimeout(5000)

            // DUMP SOURCE AFTER POST FOR VERIFICATION (User Request)
            try {
                const ts = Date.now()
                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                await fs.ensureDir(debugDir)
                if (page && !page.isClosed()) {
                    await fs.writeFile(path.join(debugDir, `post_click_verify_${ts}.html`), await page.content())
                    await page.screenshot({ path: path.join(debugDir, `post_click_verify_${ts}.png`) })
                    console.log(`  📸 [VERIFY] Post-click HTML dump saved to: post_click_verify_${ts}.html`)
                }
            } catch (e) { console.warn(`  ⚠️ Failed to dump final source: ${e}`) }

            console.log(`  🔗 Final Video URL: ${videoUrl} (Reviewing: ${isReviewing})`)
            return { success: true, videoUrl, videoId, isReviewing: isReviewing }
        } catch (error: any) {
            console.error('Publish failed:', error)

            // Capture debug artifacts on failure if page is still open
            let debugArtifacts: { screenshot?: string, html?: string } | undefined
            if (page && !page.isClosed()) {
                try {
                    const ts = Date.now()
                    const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                    await fs.ensureDir(debugDir)

                    const safeName = `error_${ts}`
                    const screenshotPath = path.join(debugDir, `${safeName}.png`)
                    const htmlPath = path.join(debugDir, `${safeName}.html`)

                    await page.screenshot({ path: screenshotPath, fullPage: true })
                    await fs.writeFile(htmlPath, await page.content())

                    console.log(`  📸 Saved debug artifacts to: ${debugDir}`)
                    debugArtifacts = { screenshot: screenshotPath, html: htmlPath }
                } catch (e) {
                    console.error('Failed to capture debug artifacts:', e)
                }
            }

            return {
                success: false,
                error: error.message || String(error),
                debugArtifacts // Return artifacts to be stored
            }
        } finally {
            if (page) await page.close()
        }
    }

    async addVideo(url: string): Promise<void> {
        console.log(`Adding single video: ${url}`)
        // Extract ID from URL
        // Format: https://www.tiktok.com/@user/video/73...
        const idMatch = url.match(/\/video\/(\d+)/)
        if (!idMatch) {
            throw new Error('Invalid TikTok video URL')
        }
        const id = idMatch[1]

        // Check if exists
        const exists = storageService.get(
            'SELECT id FROM videos WHERE platform = ? AND platform_id = ?',
            ['tiktok', id]
        )

        if (!exists) {
            storageService.run(
                `INSERT INTO videos (platform, platform_id, url, description, status, metadata) 
                 VALUES (?, ?, ?, ?, 'discovered', ?)`,
                ['tiktok', id, url, '', JSON.stringify({ manual: true })]
            )
            console.log(`Manually added video: ${id}`)
        } else {
            console.warn(`Video ${id} already exists`)
        }
    }

    async addAccount(username: string, filterCriteria?: string, metadata?: any): Promise<void> {
        console.log(`Adding account: ${username}`)
        const exists = storageService.get(
            'SELECT id FROM accounts WHERE platform = ? AND username = ?',
            ['tiktok', username]
        )

        if (!exists) {
            storageService.run(
                `INSERT INTO accounts (platform, username, role, session_valid, proxy_url, metadata)
                 VALUES ('tiktok', ?, 'target', 1, ?, ?)`,
                [username, filterCriteria || '{}', metadata ? JSON.stringify(metadata) : null]
            )
            console.log(`Added account: ${username}`)
        } else {
            // Update filter criteria and metadata if account exists
            storageService.run(
                `UPDATE accounts SET proxy_url = ?, metadata = ? WHERE platform = 'tiktok' AND username = ?`,
                [filterCriteria || '{}', metadata ? JSON.stringify(metadata) : null, username]
            )
            console.log(`Updated account: ${username}`)
        }
    }

    async addKeyword(keyword: string, filterCriteria?: string): Promise<void> {
        console.log(`Adding keyword: ${keyword}`)
        const exists = storageService.get(
            'SELECT id FROM keywords WHERE platform = ? AND keyword = ?',
            ['tiktok', keyword]
        )

        if (!exists) {
            storageService.run(
                `INSERT INTO keywords (platform, keyword, filter_criteria)
                 VALUES ('tiktok', ?, ?)`,
                [keyword, filterCriteria || '{}']
            )
            console.log(`Added keyword: ${keyword}`)
        } else {
            storageService.run(
                `UPDATE keywords SET filter_criteria = ? WHERE platform = 'tiktok' AND keyword = ?`,
                [filterCriteria || '{}', keyword]
            )
            console.log(`Updated keyword: ${keyword}`)
        }
    }

    async checkVideoStatus(videoId: string, username: string): Promise<'public' | 'private' | 'unavailable'> {
        try {
            const url = `https://www.tiktok.com/@${username}/video/${videoId}`
            console.log(`Checking video status: ${url}`)

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                },
                validateStatus: () => true // Handle 404/302 manually
            })

            console.log(`Status check response: ${response.status}`)

            if (response.status === 429) {
                console.warn('[TikTokModule] Rate limit (429) detected in checkVideoStatus.')
                try {
                    const { jobQueue } = require('../../services/JobQueue')
                    jobQueue.setGlobalThrottle(15)
                } catch (e) { }
                return 'private'
            }

            if (response.status === 200) {
                // If the video is truly public, the page should load.
                // If it's under review/private, TikTok might return 200 but show "Video currently unavailable"
                if (response.data.includes('Video currently unavailable') || response.data.includes('not_found')) {
                    return 'private'
                }
                return 'public'
            } else if (response.status === 404) {
                return 'unavailable'
            }

            return 'private'
        } catch (e) {
            console.error('Check status failed:', e)
            return 'unavailable' // Assume unavailable on network error to retry?
        }
    }

    async refreshVideoStats(videoId: string, username: string): Promise<any> {
        try {
            // Basic scrape for stats
            const url = `https://www.tiktok.com/@${username}/video/${videoId}`
            // Note: Proper scraping requires more complex logic or API.
            // For now, we reuse the extraction logic if possible or just check status.
            // Since we don't have a robust "get stats" without full browser, 
            // we will implement a lightweight extraction from the public page HTML if possible.

            // TODO: Implementing a full stats parser from HTML is complex and fragile.
            // For now, let's just update the 'status' and maybe assume existing stats if we can't parse new ones.

            // Actually, the user specifically asked for "refresh number of likes/views".
            // We can regex it from the HTML response of checkVideoStatus if we pass the HTML.

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
                timeout: 60000
            })

            if (response.status === 200) {
                const html = response.data
                // Very rough regex extraction
                const likeMatch = html.match(/"diggCount":(\d+)/)
                const viewMatch = html.match(/"playCount":(\d+)/)
                const commentMatch = html.match(/"commentCount":(\d+)/)

                const stats = {
                    likes: likeMatch ? parseInt(likeMatch[1]) : 0,
                    views: viewMatch ? parseInt(viewMatch[1]) : 0,
                    comments: commentMatch ? parseInt(commentMatch[1]) : 0
                }

                // Update DB
                const video = storageService.get("SELECT id, metadata FROM videos WHERE platform_id = ?", [videoId])
                if (video) {
                    let meta = JSON.parse(video.metadata || '{}')
                    meta.stats = stats
                    storageService.run("UPDATE videos SET metadata = ? WHERE id = ?", [JSON.stringify(meta), video.id])
                    console.log(`Updated stats for ${videoId}:`, stats)
                    return stats
                }
            }
        } catch (e) {
            console.error('Failed to refresh stats:', e)
        }
        return null
    }

    async checkVideosExistence(ids: string[]): Promise<string[]> {
        if (ids.length === 0) return []
        const placeholders = ids.map(() => '?').join(',')
        const rows = storageService.getAll(
            `SELECT platform_id FROM videos WHERE platform = 'tiktok' AND platform_id IN (${placeholders})`,
            ids
        )
        return rows.map((r: any) => r.platform_id)
    }

    async getCollection(): Promise<any[]> {
        return storageService.getAll(
            `SELECT id, platform, platform_id, url, description, status, metadata, created_at
             FROM videos WHERE platform = 'tiktok' ORDER BY created_at DESC`
        )
    }

    async getSources(): Promise<{ channels: any[], keywords: any[] }> {
        const channels = storageService.getAll(
            `SELECT id, platform, username, proxy_url as filter_criteria, created_at
             FROM accounts WHERE platform = 'tiktok' AND role = 'target' ORDER BY created_at DESC`
        )
        const keywords = storageService.getAll(
            `SELECT id, platform, keyword, filter_criteria, created_at
             FROM keywords WHERE platform = 'tiktok' ORDER BY created_at DESC`
        )
        return { channels, keywords }
    }

    async removeSource(type: 'channel' | 'keyword', id: number): Promise<void> {
        if (type === 'channel') {
            storageService.run('DELETE FROM accounts WHERE id = ?', [id])
        } else {
            storageService.run('DELETE FROM keywords WHERE id = ?', [id])
        }
    }

    async removeVideo(id: number): Promise<void> {
        storageService.run('DELETE FROM videos WHERE id = ?', [id])
        console.log(`Removed video: ${id}`)
    }

    async removeAllVideos(): Promise<void> {
        storageService.run('DELETE FROM videos WHERE platform = ?', ['tiktok'])
        console.log('Removed all TikTok videos')
    }

    /**
     * Helper to detect Captcha/Too many requests and dump HTML/Screenshot
     */
    private async handleCaptchaDetection(page: Page, context: string): Promise<boolean> {
        try {
            // Common captcha/blocking indicators
            const captchaSelectors = [
                '#captcha_container',
                '.verify-wrap',
                '[data-e2e="captcha-card"]',
                '.tiktok-captcha-container',
                'div[class*="captcha"]', // Generic catch-all
                'iframe[src*="captcha"]'
            ]

            const isCaptchaVisible = await page.evaluate((selectors) => {
                return selectors.some(s => !!document.querySelector(s))
            }, captchaSelectors)

            const pageText = await page.textContent('body').catch(() => '')
            const isBlocked = pageText?.includes('Too many requests') ||
                pageText?.includes('Vui lòng xác minh') ||
                pageText?.includes('Please verify') ||
                pageText?.includes('xác minh rằng bạn không phải là rô-bốt')

            if (isCaptchaVisible || isBlocked) {
                console.warn(`[TikTok_Security] Captcha/Block detected during ${context}`)

                // Wait for user to solve (120s)
                console.log(`[TikTok_Security] Waiting 120s for user resolution...`)
                const timeout = 120000
                const start = Date.now()

                while (Date.now() - start < timeout) {
                    await page.waitForTimeout(2000)

                    if (page.isClosed()) throw new Error('Browser closed by user')

                    const stillVisible = await page.evaluate((selectors) => {
                        return selectors.some(s => !!document.querySelector(s))
                    }, captchaSelectors)

                    const currentText = await page.textContent('body').catch(() => '')
                    const stillBlocked = currentText?.includes('Too many requests') ||
                        currentText?.includes('Vui lòng xác minh') ||
                        currentText?.includes('Please verify')

                    if (!stillVisible && !stillBlocked) {
                        console.log(`[TikTok_Security] CAPTCHA resolved by user! Resuming...`)
                        return false
                    }
                }

                const ts = Date.now()
                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                await fs.ensureDir(debugDir)

                const screenshotPath = path.join(debugDir, `captcha_${context}_${ts}.png`)
                const htmlPath = path.join(debugDir, `captcha_${context}_${ts}.html`)

                if (!page.isClosed()) {
                    await page.screenshot({ path: screenshotPath }).catch(e => console.error('Screenshot failed:', e))
                    const html = await page.content().catch(() => '')
                    await fs.writeFile(htmlPath, html).catch(e => console.error('HTML dump failed:', e))

                    console.log(`[TikTok_Security] Artifacts dumped to:`)
                    console.log(`  - HTML: ${htmlPath}`)
                    console.log(`  - Screenshot: ${screenshotPath}`)
                }

                throw new Error('CAPTCHA_REQUIRED')
            }
        } catch (e: any) {
            console.error(`[TikTok_Security] Error during captcha detection: ${e.message}`)
        }
        return false
    }
}
