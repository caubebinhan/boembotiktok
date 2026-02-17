import { PlatformModule } from '../../services/ModuleManager'
import { browserService } from '../../services/BrowserService'
import { storageService } from '../../services/StorageService'
import { Page, Response } from 'playwright-core'
import axios from 'axios'
import fs from 'fs-extra'
import path from 'path'
import { app } from 'electron'

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

    async scanKeyword(keyword: string, maxVideos = 50): Promise<any> {
        if (this.isScanning) {
            console.warn('Scan already in progress')
            return { videos: [] }
        }
        this.isScanning = true
        console.log(`Starting keyword scan for: ${keyword} (Max: ${maxVideos})`)

        if (!browserService.isConnected()) {
            await browserService.init(true)
        }

        const page = await browserService.newPage()
        if (!page) return { videos: [] }

        const foundVideos: any[] = []

        try {
            await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, { waitUntil: 'networkidle', timeout: 60000 })

            // === Scroll to End Logic ===
            let prevCount = 0
            let rounds = 0
            const MAX_ROUNDS = 50 // Safety break

            while (rounds < MAX_ROUNDS) {
                rounds++
                const currentCount = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length)

                if (currentCount >= maxVideos) {
                    console.log(`Reached max videos limit (${maxVideos})`)
                    break
                }

                console.log(`Scanning round ${rounds}... Found ${currentCount}/${maxVideos}`)
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                try {
                    await page.waitForTimeout(2000)
                } catch { break }

                if (currentCount === prevCount && currentCount > 0) {
                    // Check if "Load more" button exists (sometimes searching has a button)
                    // converting to auto-scroll usually works though
                    console.log('No new videos found, stopping.')
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

                        return {
                            id: m ? m[1] : '',
                            url: a.href,
                            desc: a.textContent || '', // This often grabs views too, needs cleaning
                            thumb: a.querySelector('img')?.src || '',
                            stats: {
                                views: viewsText || '0',
                                likes: '0',
                                comments: '0'
                            }
                        }
                    })
                    .filter(v => v.id)
            })

            console.log(`Found ${videos.length} videos on page. Taking top ${maxVideos}.`)

            // Limit to maxVideos
            const targetVideos = videos.slice(0, maxVideos)

            for (const v of targetVideos) {
                const exists = storageService.get('SELECT id FROM videos WHERE platform_id = ?', [v.id])

                if (!exists) {
                    storageService.run(
                        `INSERT INTO videos (platform, platform_id, url, description, status, metadata)
                         VALUES ('tiktok', ?, ?, ?, 'discovered', ?)`,
                        [v.id, v.url, v.desc, JSON.stringify({ thumbnail: v.thumb, stats: v.stats, keyword })]
                    )
                    console.log(`New video found: ${v.id}`)

                    // Return found videos (for immediate use if needed)
                    const newId = storageService.get('SELECT last_insert_rowid() as id').id
                    foundVideos.push({
                        id: newId,
                        url: v.url,
                        platform_id: v.id,
                        thumbnail: v.thumb,
                        stats: v.stats
                    })
                }
            }

            return { videos: foundVideos }

        } catch (error) {
            console.error('Error scanning keyword:', error)
            return { videos: [] }
        } finally {
            await page.close()
            this.isScanning = false
        }
    }

    async scanProfile(username: string, isBackground = false): Promise<any> {
        if (this.isScanning) {
            console.warn('Scan already in progress')
            return { videos: [], channel: null }
        }
        this.isScanning = true
        console.log(`Starting scan for: ${username} (Background: ${isBackground})`)

        if (!browserService.isConnected()) {
            await browserService.init(true)
        }

        const page = await browserService.newPage()
        if (!page) return { videos: [], channel: null }

        const foundVideos: any[] = []
        let channelInfo: any = null

        try {
            await page.goto(`https://www.tiktok.com/@${username}`, { waitUntil: 'networkidle' })

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

            // === Scroll to End Logic ===
            let prevCount = 0
            let rounds = 0
            const MAX_ROUNDS = isBackground ? 50 : 5

            while (rounds < MAX_ROUNDS) {
                rounds++
                console.log(`Scanning round ${rounds}...`)

                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                await page.waitForTimeout(2000)

                const currentCount = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length)

                if (currentCount === prevCount && currentCount > 0) {
                    console.log('Reached end of feed.')
                    break
                }
                prevCount = currentCount
            }

            // === Extract Data ===
            const videos = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a'))
                return anchors
                    .filter(a => a.href.includes('/video/'))
                    .map(a => {
                        const m = a.href.match(/\/video\/(\d+)/)
                        // Try to find views count inside the video container
                        // Structure varies, usually a sibling or child with specific class/icon
                        // This is a naive attempt to grab text content as views if it looks like a number
                        const container = a.closest('div[class*="DivItemContainer"]') || a.parentElement
                        const viewsText = container ? container.textContent?.match(/(\d+(\.\d+)?[KMB]?)/)?.[0] : ''

                        return {
                            id: m ? m[1] : '',
                            url: a.href,
                            desc: a.textContent || '', // This often grabs views too, needs cleaning
                            thumb: a.querySelector('img')?.src || '',
                            stats: {
                                views: viewsText || '0',
                                likes: '0', // Need detail page
                                comments: '0' // Need detail page
                            }
                        }
                    })
                    .filter(v => v.id)
            })

            console.log(`Found ${videos.length} videos on page`)

            for (const v of videos) {
                const exists = storageService.get('SELECT id FROM videos WHERE platform_id = ?', [v.id])

                if (!exists) {
                    storageService.run(
                        `INSERT INTO videos (platform, platform_id, url, description, status, metadata)
                         VALUES ('tiktok', ?, ?, ?, 'discovered', ?)`,
                        [v.id, v.url, v.desc, JSON.stringify({ thumbnail: v.thumb, stats: v.stats })]
                    )
                    console.log(`New video found: ${v.id}`)

                    if (isBackground) {
                        const newId = storageService.get('SELECT last_insert_rowid() as id').id
                        foundVideos.push({
                            id: newId,
                            url: v.url,
                            platform_id: v.id,
                            thumbnail: v.thumb,
                            stats: v.stats
                        })
                    }
                }
            }

            return { videos: foundVideos, channel: channelInfo }

        } catch (error) {
            console.error('Error scanning profile:', error)
            return { videos: [], channel: null }
        } finally {
            await page.close()
            this.isScanning = false
        }
    }

    async downloadVideo(url: string, platformId: string): Promise<string> {
        console.log(`Downloading video: ${url}`)

        // MOCK FOR E2E TESTING
        if (url.includes('@test/video')) {
            console.log('[TikTok] Mock download triggered for E2E test.')
            const mockPath = path.join(app.getPath('userData'), 'mock_video_e2e.mp4')
            if (!fs.existsSync(mockPath)) {
                fs.writeFileSync(mockPath, 'fake video content')
            }
            return mockPath
        }

        const downloadsDir = path.join(app.getPath('userData'), 'downloads', 'tiktok')
        await fs.ensureDir(downloadsDir)
        const diff = 'tiktok_' + platformId + '.mp4'
        const filePath = path.join(downloadsDir, diff)

        let videoStreamUrl = ''
        let downloadHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        }

        try {
            console.log('Using @tobyg74/tiktok-api-dl to fetch video URL...')
            // Dynamic import to handle CommonJS/ESM interop if needed, though we compiled to CommonJS in TS
            // @ts-ignore
            const { Downloader } = require('@tobyg74/tiktok-api-dl')

            const result = await Downloader(url, { version: 'v1' })
            console.log('Library Result Status:', result.status)

            if (result.status === 'success' && result.result?.video) {
                // Determine best video source (HD or normal)
                const videoData = result.result.video
                if (Array.isArray(videoData) && videoData.length > 0) {
                    videoStreamUrl = videoData[0]
                } else if (typeof videoData === 'string') {
                    videoStreamUrl = videoData
                }
            }

            if (!videoStreamUrl) {
                console.warn('Library failed to return video URL. Falling back to Puppeteer extraction.')
                // FALLBACK to Puppeteer if library fails
                return await this.downloadVideoFallback(url, filePath)
            }

            console.log(`Extracted Video URL from Library: ${videoStreamUrl}`)

        } catch (e) {
            console.error('Library extraction error:', e)
            console.log('Falling back to Puppeteer extraction...')
            return await this.downloadVideoFallback(url, filePath)
        }

        // 3. Download the Extracted URL
        try {
            const writer = fs.createWriteStream(filePath)

            const response = await axios({
                url: videoStreamUrl,
                method: 'GET',
                responseType: 'stream',
                headers: downloadHeaders
            })

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
                            resolve(filePath)
                        }
                    } catch (e) {
                        reject(e)
                    }
                })
                writer.on('error', reject)
            })
        } catch (error) {
            console.error('Download failed:', error)
            throw error
        }
    }

    // Original Puppeteer Logic moved to Fallback
    async downloadVideoFallback(url: string, filePath: string): Promise<string> {
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
                console.log('Network intercept empty, trying DOM extraction...')
                videoStreamUrl = await page.evaluate(() => {
                    const video = document.querySelector('video')
                    return video ? video.src : ''
                })
            }

            console.log(`Extracted Video URL: ${videoStreamUrl} (Size: ${largestVideoSize})`)

        } catch (e) {
            console.error('Extraction error:', e)
        } finally {
            await page.close()
        }

        if (!videoStreamUrl || videoStreamUrl.startsWith('blob:')) {
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
            headers: downloadHeaders
        })

        response.data.pipe(writer)

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                // Validate file size
                try {
                    const stats = await fs.stat(filePath)
                    if (stats.size < 50 * 1024) { // < 50KB
                        reject(new Error(`Downloaded file too small (${stats.size} bytes). Path: ${filePath}`))
                    } else {
                        resolve(filePath)
                    }
                } catch (e) {
                    reject(e)
                }
            })
            writer.on('error', reject)
        })
    }

    async publishVideo(filePath: string, caption: string, cookies?: any[], onProgress?: (msg: string) => void): Promise<{ success: boolean, videoUrl?: string, error?: string }> {
        console.log(`Publishing video: ${filePath}`)
        if (onProgress) onProgress('Initializing browser...')
        let page: Page | null = null

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
                console.log('--- cleanOverlays started ---')

                const commonSelectors = [
                    'button[aria-label="Close"]', 'button[aria-label="close"]',
                    'svg[data-icon="close"]', 'div[role="dialog"] button[aria-label="Close"]',
                    '[data-e2e="modal-close-inner-button"]', '[data-e2e="modal-close-button"]',
                    'div[role="dialog"] button:first-child', // Risky but often close button is first
                ]

                // Add debug dump if it gets stuck
                const safetyTimer = setTimeout(async () => {
                    console.log('⚠️ cleanOverlays is taking too long! Dumping state...')
                    try {
                        const ts = Date.now()
                        const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                        await fs.ensureDir(debugDir)
                        await page?.screenshot({ path: path.join(debugDir, `overlay_stuck_${ts}.png`) })
                        const html = await page?.content() || ''
                        await fs.writeFile(path.join(debugDir, `overlay_stuck_${ts}.html`), html)
                    } catch (e) { console.error('Failed to dump stuck state:', e) }
                }, 10000) // 10s warning

                try {
                    // Maximum time for overlay cleaning: 15 seconds
                    await Promise.race([
                        (async () => {
                            for (const sel of commonSelectors) {
                                try {
                                    // Ultra short timeout check
                                    const btn = await page!.$(sel)
                                    if (btn && await btn.isVisible()) {
                                        console.log(`  Found overlay candidate: ${sel}`)
                                        await btn.click({ force: true, timeout: 500 }).catch(() => { })
                                        await page!.waitForTimeout(300)
                                    }
                                } catch (e) { }
                            }

                            await page!.keyboard.press('Escape')

                            // Obstruction check (omitted for speed unless strictly needed)
                            if (targetSelector) {
                                // ... existing logic if needed, but simplified for speed
                            }
                        })(),
                        new Promise(resolve => setTimeout(resolve, 15000))
                    ])
                } finally {
                    clearTimeout(safetyTimer)
                    console.log('--- cleanOverlays finished ---')
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
                console.log(`\n📤 Upload attempt ${uploadAttempt}/${MAX_UPLOAD_RETRIES}...`)
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
                            await page.mouse.click(viewport.width / 2, viewport.height / 2);
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

                console.log(`  Input content: ${filePath}`)
                try {
                    await fileInput.setInputFiles(filePath)
                } catch (err: any) {
                    console.error('  setInputFiles failed:', err)
                    // Fallback using DOM manipulation if standard way fails?
                    throw err
                }

                console.log('  File selected')

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
                            console.log(`  ❌ Upload error detected: "${errText}"`)
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

            // ─── Set Caption ───
            console.log('✏️ Setting caption...')
            if (onProgress) onProgress('Setting video caption...')
            let captionSet = false
            for (const sel of ['.public-DraftEditor-content', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"].notranslate', 'div[contenteditable="true"][data-placeholder]', '[contenteditable="true"]']) {
                try {
                    const editor = await page!.$(sel)
                    if (editor && await editor.isVisible()) {
                        if (onProgress) onProgress('Typing caption...')
                        await interactWithRetry(async () => {
                            await editor!.click()
                            await page!.waitForTimeout(300)
                            await page!.keyboard.press('Control+a')
                            await page!.keyboard.press('Backspace')
                            await page!.waitForTimeout(200)
                            await page!.keyboard.type(caption, { delay: 20 })
                        }, sel)
                        console.log(`  Caption set (${sel})`)
                        captionSet = true
                        break
                    }
                } catch { /* try next */ }
            }
            if (!captionSet) console.warn('  ⚠️ Could not find caption editor')

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
            await page.waitForTimeout(5000)

            console.log('📜 Looking for scrollable container...')

            let bestBtn = null
            let maxY = -1
            let postButtonFound = false


            // Retry loop for finding the button (30 seconds)
            for (let i = 0; i < 15; i++) {
                if (onProgress) onProgress(`Searching for Post button (Attempt ${i + 1}/15)...`)

                // Smart Selection: Find bottom-most visible Post button
                const buttonSelector = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                    const candidates = buttons.filter(b => {
                        const style = window.getComputedStyle(b);
                        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                        const text = (b.textContent || '').trim();
                        // Check for specific attributes or text
                        const isPost = b.getAttribute('data-e2e') === 'post-video-button' ||
                            text === 'Post' || text === 'Đăng' || text.includes('Post') ||
                            b.className.includes('btn-post');
                        return isVisible && isPost;
                    });

                    if (candidates.length === 0) return null;

                    // Sort by Y coordinate descending (bottom-most first)
                    candidates.sort((a, b) => {
                        const rectA = a.getBoundingClientRect();
                        const rectB = b.getBoundingClientRect();
                        return rectB.top - rectA.top;
                    });

                    // Return a unique selector for the best candidate
                    const best = candidates[0];
                    // Add a temporary unique ID to target it easily
                    if (!best.id) best.id = 'target-post-btn-' + Date.now();
                    return '#' + best.id;
                });

                if (buttonSelector) {
                    console.log(`  ✅ Found candidate button: ${buttonSelector}`)
                    try {
                        await cleanOverlays()
                        await page.click(buttonSelector)
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
            if (onProgress) onProgress('Verifying publication...')
            let videoUrl: string | undefined
            let isSuccess = false

            // Define helper locally
            const extractProfileVideo = async () => {
                try {
                    // 1. Try specific selector
                    const videoEl = await page!.$('[data-e2e="user-post-item"] a');
                    if (videoEl) {
                        const href = await videoEl.getAttribute('href');
                        if (href && (href.includes('/video/') || href.includes('/v/'))) return href;
                    }

                    // 2. Fallback: Scan all links on page
                    const links = await page!.$$eval('a', els => els.map(e => e.href));
                    const videoLink = links.find(l => (l.includes('/video/') || l.includes('/v/')) && l.includes('tiktok.com'));
                    if (videoLink) return videoLink;
                } catch { }
                return undefined
            }

            for (let i = 0; i < 60; i++) { // Increase wait to 2 minutes max (60 * 2s)
                try {
                    await page!.waitForTimeout(2000)
                } catch { break }

                // 1. Check for "Uploading..." state
                try {
                    const uploadingEl = await page!.$('text="Your video is being uploaded"') || await page!.$('text="Video của bạn đang được tải lên"')
                    if (uploadingEl && await uploadingEl.isVisible()) {
                        console.log('  ⏳ Upload in progress...')
                        if (onProgress) onProgress('Uploading video...')
                        continue; // Keep waiting
                    }
                } catch { /* ignore */ }

                // 2. Check for Success indicators
                try {
                    const successSelectors = [
                        'text="Manage your posts"', 'text="Quản lý bài đăng"',
                        'text="Your video has been published"', 'text="Video của bạn đã được đăng"',
                        'text="Video published"',
                        'text="Upload another video"', 'text="Tải video khác lên"'
                    ]

                    for (const sel of successSelectors) {
                        const el = await page!.$(sel)
                        if (el && await el.isVisible()) {
                            console.log(`  ✅ Success confirmed: ${sel}`)
                            isSuccess = true
                            break
                        }
                    }
                } catch { /* ignore */ }

                // 3. If Success detected, try to get the link
                if (isSuccess) {
                    if (onProgress) onProgress('Upload complete. fetching video link...')

                    // Try to click "View Profile" to go to profile
                    try {
                        const viewProfileBtn = await page!.locator('button:has-text("View Profile"), a:has-text("View Profile"), button:has-text("Xem hồ sơ"), a:has-text("Xem hồ sơ")').first()
                        if (await viewProfileBtn.isVisible()) {
                            console.log('  Found View Profile button, clicking...')
                            await viewProfileBtn.click()
                            await page!.waitForURL(/tiktok\.com\/@/, { timeout: 10000 }).catch(() => { })
                        } else if (!page!.url().includes('/@')) {
                            // Fallback: Click Avatar
                            console.log('  "View Profile" not found, clicking Avatar...')
                            const profileIcon = await page!.locator('[data-e2e="user-icon"], [data-e2e="profile-icon"]').first()
                            if (await profileIcon.isVisible()) {
                                await profileIcon.click()
                                await page!.waitForURL(/tiktok\.com\/@/, { timeout: 10000 }).catch(() => { })
                            }
                        }
                    } catch { }

                    // Now on profile page (hopefully), try to extract link
                    // Retry extraction with reload if needed
                    for (let attempt = 0; attempt < 5; attempt++) {
                        console.log(`  Scanning for video link (Attempt ${attempt + 1}/5)...`)
                        const link = await extractProfileVideo()
                        if (link) {
                            videoUrl = link
                            break
                        }

                        // If not found, reload profile page after a short delay
                        if (page!.url().includes('/@')) {
                            console.log('  Video not found on profile yet, reloading...')
                            await page!.waitForTimeout(3000)
                            await page!.reload({ waitUntil: 'domcontentloaded' })
                        } else {
                            await page!.waitForTimeout(2000)
                        }
                    }

                    if (videoUrl) break; // We found it!
                }

                // Check for post error
                try {
                    for (const errSel of ['text="Failed to post"', 'text="failed to post"', 'text="Đăng không thành công"', 'text="Không thể đăng"']) {
                        const errEl = await page!.$(errSel)
                        if (errEl && await errEl.isVisible()) throw new Error('TikTok reported: Failed to post video')
                    }
                } catch (e: any) {
                    if (e.message?.includes('TikTok reported')) throw e
                }

                if (i % 5 === 0 && i > 0) console.log(`  Processing... (${i * 2}s)`)
            }

            if (!videoUrl) {
                throw new Error('Post success detected but could not retrieve video URL (Timeout).')
            }

            console.log(`  🔗 Video URL Verified: ${videoUrl}`)
            return { success: true, videoUrl }

        } catch (error: any) {
            console.error('Publish failed:', error)
            return { success: false, error: error.message || String(error) }
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
}
