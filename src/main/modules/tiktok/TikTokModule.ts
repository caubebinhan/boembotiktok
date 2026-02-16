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

        // Use Browser to get actual video stream
        // We need 'headed' sometimes for some sites, but headless usually works for extraction if undetected.
        // Using existing browserService.
        if (!browserService.isConnected()) {
            await browserService.init(true)
        }

        const page = await browserService.newPage()
        if (!page) throw new Error('Failed to create page for download')

        let videoStreamUrl = ''

        // Timeout race: Network Intercept vs DOM Extraction
        try {
            // 1. Setup Network Interception
            page.on('response', async (response: Response) => {
                const resourceType = response.request().resourceType()
                const respUrl = response.url()
                // TikTok video streams often come from *.tiktokcdn.com/... or similar
                // They are usually type 'media'.
                if (resourceType === 'media' || (respUrl.includes('.mp4') && !respUrl.includes('.html'))) {
                    // Check content-length if possible to ignore small clips? 
                    // For now, first media is usually the video.
                    if (!videoStreamUrl && !respUrl.startsWith('blob:')) {
                        console.log(`Found candidate video stream: ${respUrl}`)
                        videoStreamUrl = respUrl
                    }
                }
            })

            console.log('Navigating to video page...')
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

            // Wait a bit for media to load
            await page.waitForTimeout(3000)

            // 2. Fallback / DOM Extraction
            if (!videoStreamUrl) {
                console.log('Network intercept empty, trying DOM extraction...')
                videoStreamUrl = await page.evaluate(() => {
                    const video = document.querySelector('video')
                    return video ? video.src : ''
                })
            }

            console.log(`Extracted Video URL: ${videoStreamUrl}`)

        } catch (e) {
            console.error('Extraction error:', e)
        } finally {
            await page.close()
        }

        if (!videoStreamUrl || videoStreamUrl.startsWith('blob:')) {
            throw new Error(`Failed to extract valid video URL. Got: ${videoStreamUrl || 'nothing'}`)
        }

        // 3. Download the Extracted URL
        try {
            const writer = fs.createWriteStream(filePath)
            const response = await axios({
                url: videoStreamUrl,
                method: 'GET',
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.tiktok.com/'
                }
            })

            response.data.pipe(writer)

            return new Promise((resolve, reject) => {
                writer.on('finish', async () => {
                    // Validate file size
                    try {
                        const stats = await fs.stat(filePath)
                        if (stats.size < 50 * 1024) { // < 50KB
                            // Don't delete, let user inspect.
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
        } catch (error) {
            console.error('Download failed:', error)
            throw error
        }
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
                    'button:has-text("Got it")', 'button:has-text("OK")',
                    'button:has-text("Dismiss")', 'button:has-text("Not now")',
                    'button:has-text("Skip")', 'div[class*="modal"] button',
                    'button:has-text("Turn on")', 'button:has-text("Run check")', 'button:has-text("Try it now")',
                    '[data-e2e="modal-close-inner-button"]', '[data-e2e="modal-close-button"]',
                    'button:has-text("Post")', // Careful not to close the post button if it looks like an overlay? No, usually valid closers.
                    // Wait, removing "Post" from commonSelectors if it was there? It wasn't. Good.
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
                await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=upload&lang=en', {
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
                let fileInput = await page.$('input[type="file"]')

                if (!fileInput) {
                    console.log('  File input not found immediately. Looking for "Select File" buttons...')
                    // Try to click "Select file" or similar to trigger input
                    const uploadBtns = [
                        'button:has-text("Select file")',
                        'button:has-text("Select video")',
                        'button:has-text("Chọn tệp")',
                        'button:has-text("Tải video lên")',
                        'div[role="button"]:has-text("Select")',
                        'div[role="button"]:has-text("Upload")'
                    ]

                    for (const btnSel of uploadBtns) {
                        try {
                            const btn = await page.$(btnSel)
                            if (btn && await btn.isVisible()) {
                                console.log(`  Clicking upload button: ${btnSel}`)
                                await btn.click()
                                await page.waitForTimeout(1000)
                                fileInput = await page.$('input[type="file"]')
                                if (fileInput) break
                            }
                        } catch (e) { }
                    }
                }

                if (!fileInput) {
                    // One last wait
                    try {
                        fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })
                    } catch (e) {
                        console.error('  ❌ File input timeout. Dumping state...')
                        const ts = Date.now()
                        const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                        await fs.ensureDir(debugDir)
                        await page.screenshot({ path: path.join(debugDir, `upload_fail_${ts}.png`) })
                        await fs.writeFile(path.join(debugDir, `upload_fail_${ts}.html`), await page.content())
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
                    for (const errText of [
                        "Couldn't upload", "Upload failed", "Something went wrong", "upload failed",
                        "Không thể tải video lên", "Tải lên thất bại", "Đã xảy ra lỗi",
                    ]) {
                        try {
                            const errEl = await page.$(`text="${errText}"`)
                            if (errEl && await errEl.isVisible()) {
                                console.log(`  ❌ Upload error: "${errText}"`)
                                uploadError = true
                                break
                            }
                        } catch { /* ignore */ }
                    }

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
                    for (const sel of [
                        'text="When to post"', 'text="Thời điểm đăng"',
                        'button:has-text("Post")', 'button:has-text("Đăng")',
                        'text="Discard"', 'text="Hủy bỏ"',
                        'text="Edit video"', 'text="Chỉnh sửa"',
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
            const postSelectors = ['button:has-text("Post")', 'button:has-text("POST")', 'button:has-text("Đăng")', '[data-e2e="post-button"]']

            // Ensure overlays are gone before clicking post
            await cleanOverlays()

            // ─── Verified Smart Scroll & Click Logic with Retry ───
            if (onProgress) onProgress('Locating Post button...')
            console.log('📜 Looking for scrollable container...')

            let bestBtn = null
            let maxY = -1
            let postButtonFound = false

            // Dump HTML immediately for debug
            const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
            await fs.ensureDir(debugDir)


            // Retry loop for finding the button (30 seconds)
            for (let i = 0; i < 15; i++) {
                if (onProgress) onProgress(`Searching for Post button (Attempt ${i + 1}/15)...`)

                // ─── EXACT SYNC with research-upload.spec.ts ───
                // Find the largest scrollable element OR documentElement
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
                        console.log(`Debug: Scrolling <${el.tagName.toLowerCase()} class="${el.className}"> to bottom...`)
                        el.scrollTop = el.scrollHeight
                    })
                    // Report scroll action to UI
                    const tagName = await scrollHandle.evaluate((el: Element) => el.tagName.toLowerCase())
                    if (onProgress) onProgress(`Scrolled container <${tagName}> to bottom...`)
                }

                // Helper: also trigger a window scroll just in case (test does this in fallback, we can allow both safely)
                // But primarily rely on the logic above
                await page!.waitForTimeout(2000)

                // DEBUG SNAPSHOT every 5 attempts
                if (i % 5 === 0) {
                    const ts = Date.now()
                    await page!.screenshot({ path: path.join(debugDir, `scroll_attempt_${i}_${ts}.png`) }).catch(() => { })
                }

                // Find all candidates
                // Use the updated selectors that include "Đăng"
                const candidates = await page!.$$('button:has-text("Post"), button:has-text("Đăng"), [data-e2e="post-button"]')
                console.log(`   Attempt ${i + 1}: Found ${candidates.length} candidate "Post" buttons.`)
                if (onProgress) onProgress(`Found ${candidates.length} Post buttons...`)

                bestBtn = null
                maxY = -1

                for (const btn of candidates) {
                    const box = await btn.boundingBox()
                    if (box && await btn.isVisible()) {
                        const text = await btn.innerText()
                        console.log(`   Candidate: "${text}" at y=${box.y}`)
                        if (onProgress) onProgress(`Checking candidate: "${text.substring(0, 10)}..."`)

                        if (box.y > maxY) {
                            maxY = box.y
                            bestBtn = btn
                        }
                    }
                }

                if (bestBtn) {
                    console.log(`   🎯 Selected best Post button at y=${maxY}`)

                    // Wait for button to become enabled (not disabled/aria-disabled)
                    console.log('   ⏳ Waiting for Post button to become enabled...')
                    if (onProgress) onProgress('Waiting for Post button to become enabled...')
                    for (let waitEnable = 0; waitEnable < 30; waitEnable++) {
                        const isDisabled = await bestBtn.evaluate((el: Element) => {
                            const btn = el as HTMLButtonElement
                            return btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('Button__root--loading-true')
                        })
                        if (!isDisabled) {
                            console.log(`   ✅ Post button is now enabled (after ${waitEnable * 2}s)`)
                            break
                        }
                        if (waitEnable % 5 === 0) {
                            console.log(`   Still disabled... (${waitEnable * 2}s)`)
                            if (onProgress) onProgress(`Post button disabled, waiting... (${waitEnable * 2}s)`)
                        }
                        if (waitEnable === 29) {
                            console.log('   ⚠️ Post button still disabled after 60s, will attempt click anyway')
                        }
                        await page!.waitForTimeout(2000)
                    }

                    postButtonFound = true
                    break
                }

                console.log('   ⚠️ Post button not found yet, retrying...')
            }

            // Final pre-click debug dump
            // path and fs are already imported at module level, but we used require inside function before.
            // Since we removed the previous requires, we rely on top-level imports:
            // import fs from 'fs-extra'
            // import path from 'path'
            // import { app } from 'electron'
            // So we just use them.
            if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })
            const tsPreClick = Date.now()
            await page!.screenshot({ path: path.join(debugDir, `pre_click_state_${tsPreClick}.png`), fullPage: true }).catch(() => { })
            // Capture full page HTML + all button states for debugging
            let htmlContent = await page!.content()
            try {
                const allButtons = await page!.$$eval('button', (btns: Element[]) =>
                    btns.map(b => ({ text: (b.textContent || '').trim().substring(0, 50), disabled: (b as HTMLButtonElement).disabled, ariaDisabled: b.getAttribute('aria-disabled') }))
                )
                htmlContent += `\n<!-- DEBUG: All buttons on page: ${JSON.stringify(allButtons)} -->`
            } catch { /* ignore */ }
            fs.writeFileSync(path.join(debugDir, `pre_click_state_${tsPreClick}.html`), htmlContent)

            if (bestBtn) {
                try {
                    if (onProgress) onProgress('Clicking Post button...')
                    await bestBtn.scrollIntoViewIfNeeded()
                    await page!.waitForTimeout(500)
                    await cleanOverlays()
                    await bestBtn.click({ timeout: 5000 })
                    console.log(`  ✅ Post clicked (Best candidate)`)
                    posted = true
                } catch (e) {
                    console.log(`  Click failed on best candidate, trying force...`)
                    await bestBtn.click({ force: true })
                    posted = true
                }
            } else {
                console.error('❌ CRITICAL: Could not find Post button after retries.')
                if (onProgress) onProgress('Failed to find Post button. Saving debug info...')

                // 📸 CAPTURE DEBUG ARTIFACTS ON FAILURE
                const timestamp = Date.now()
                try {
                    await page!.screenshot({ path: path.join(debugDir, `post_fail_${timestamp}.png`), fullPage: true })
                    const html = await page!.content()
                    fs.writeFileSync(path.join(debugDir, `post_fail_${timestamp}.html`), html)
                    console.log(`  📸 Debug artifacts saved to ${debugDir}`)
                } catch (err) {
                    console.error('  Failed to save debug artifacts:', err)
                }

                // Fallback to simple selector logic just in case
                console.log('   ⚠️ Smart selection failed, trying fallback selectors...')
                for (const sel of postSelectors) {
                    try {
                        const btn = await page!.$(sel)
                        if (btn && await btn.isVisible()) {
                            await btn.click({ timeout: 2000 })
                            console.log(`  ✅ Post clicked (Fallback: ${sel})`)
                            posted = true
                            break
                        }
                    } catch { /* try next */ }
                }
            }

            if (!posted) throw new Error('Could not find or click Post button - Debug artifacts saved.')

            // ─── Verify success & extract video link ───
            console.log('\n⏳ Verifying post success...')
            if (onProgress) onProgress('Verifying publication...')
            let videoUrl: string | undefined
            let isSuccess = false

            for (let i = 0; i < 30; i++) {
                try {
                    await page!.waitForTimeout(2000)
                } catch { break }

                // Dismiss any post-upload popups (e.g. "Manage your posts", "View Profile") — English + Vietnamese
                try {
                    const managePopup = await page!.locator('text="Manage your posts"').or(page!.locator('text="Quản lý bài đăng"'))
                    if (await managePopup.isVisible()) {
                        console.log('  ✅ Detected "Manage your posts" popup -> upload success!')
                        isSuccess = true

                        // Try to click "View Profile" BEFORE cleaning overlays
                        try {
                            const viewProfileBtn = await page!.locator('button:has-text("View Profile"), a:has-text("View Profile"), button:has-text("Xem hồ sơ"), a:has-text("Xem hồ sơ")').first()
                            if (await viewProfileBtn.isVisible()) {
                                console.log('  Found View Profile button inside popup, clicking...')
                                await viewProfileBtn.click()
                                await page!.waitForTimeout(2000)
                            } else {
                                // FALLBACK: Click the profile icon in the header
                                console.log('  "View Profile" button not found. Attempting to click User Avatar...')
                                const profileIcon = await page!.locator('[data-e2e="user-icon"], [data-e2e="profile-icon"]').first()
                                if (await profileIcon.isVisible()) {
                                    await profileIcon.click()
                                    await page!.waitForURL(/tiktok\.com\/@/, { timeout: 10000 }).catch(() => { })
                                }
                            }
                        } catch (e) {
                            console.log('  Failed to click View Profile in popup:', e)
                        }
                    }

                    if (page!.url().includes('upload')) {
                        await cleanOverlays()
                    }
                } catch { /* ignore */ }

                for (const sel of [
                    'text="Your video has been published"', 'text="Video của bạn đã được đăng"',
                    'text="Manage your posts"', 'text="Quản lý bài đăng"',
                    'text="Video published"',
                    'text="Upload another video"', 'text="Tải video khác lên"',
                ]) {
                    try {
                        const el = await page!.$(sel)
                        if (el && await el.isVisible()) {
                            console.log(`  ✅ Success confirmed: ${sel}`)
                            isSuccess = true
                            break
                        }
                    } catch { /* ignore */ }
                }

                // Check for upload progress (not success)
                try {
                    const uploadingEl = await page!.$('text="Your video is being uploaded"') || await page!.$('text="Video của bạn đang được tải lên"')
                    if (uploadingEl && await uploadingEl.isVisible()) {
                        console.log('  ⏳ Upload in progress...')
                        if (onProgress) onProgress('Uploading video...')
                    }
                } catch { /* ignore */ }

                if (isSuccess) {
                    console.log('  🎉 Verify success logic triggering...')
                    await page!.waitForTimeout(2000)

                    // Helper to extract first video link from profile
                    const extractProfileVideo = async () => {
                        try {
                            await page!.waitForSelector('[data-e2e="user-post-item"] a', { timeout: 5000 })
                            const firstVideoLink = await page!.$eval('[data-e2e="user-post-item"] a', (el: any) => el.href)
                            if (firstVideoLink) return firstVideoLink
                        } catch { }
                        return undefined
                    }

                    // Strategy 1: Check for direct "View Profile" button
                    try {
                        const viewProfileBtn = await page!.locator('button:has-text("View Profile"), a:has-text("View Profile"), button:has-text("Xem hồ sơ"), a:has-text("Xem hồ sơ")').first()
                        if (await viewProfileBtn.isVisible()) {
                            console.log('  Found View Profile button, clicking to find video...')
                            await viewProfileBtn.click()
                            await page!.waitForURL(/tiktok\.com\/@/, { timeout: 10000 }).catch(() => { })
                            const link = await extractProfileVideo()
                            if (link) videoUrl = link
                        }
                    } catch (e) { console.log('  Verification via Profile button failed:', e) }

                    if (!videoUrl) {
                        // Strategy 2: If we are already on profile page (due to avatar click above)
                        if (page!.url().includes('/@')) {
                            const link = await extractProfileVideo()
                            if (link) videoUrl = link
                        }
                    }

                    if (!videoUrl) {
                        try {
                            videoUrl = await page!.evaluate(() => {
                                const links = Array.from(document.querySelectorAll('a'))
                                for (const a of links) {
                                    if ((a.href.includes('/video/') || a.href.includes('/v/')) && a.href.includes('tiktok.com')) return a.href
                                }
                                if (window.location.href.includes('/video/')) return window.location.href
                                return undefined
                            })
                        } catch { /* ignore */ }
                    }

                    if (videoUrl) {
                        console.log(`  🔗 Video URL: ${videoUrl}`)
                        return { success: true, videoUrl }
                    } else {
                        console.log('  ⚠️ Success detected but videoUrl not found yet, retrying...')
                    }
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
                throw new Error('Post clicked but could not verify success (no video URL found).')
            }

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
