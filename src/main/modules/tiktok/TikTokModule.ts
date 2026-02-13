import { PlatformModule } from '../../services/ModuleManager'
import { browserService } from '../../services/BrowserService'
import { storageService } from '../../services/StorageService'
import { Page } from 'playwright-core'
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
        const downloadsDir = path.join(app.getPath('userData'), 'downloads', 'tiktok')
        await fs.ensureDir(downloadsDir)
        const diff = 'tiktok_' + platformId + '.mp4'
        const filePath = path.join(downloadsDir, diff)

        try {
            const writer = fs.createWriteStream(filePath)
            // Note: TikTok might require headers/cookies. For MVP we try direct axios.
            // If that fails, we might need to get cookies from browserService.
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.tiktok.com/'
                }
            })

            response.data.pipe(writer)

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filePath))
                writer.on('error', reject)
            })
        } catch (error) {
            console.error('Download failed:', error)
            throw error
        }
    }

    async publishVideo(filePath: string, caption: string, cookies?: any[]): Promise<{ success: boolean, videoUrl?: string, error?: string }> {
        console.log(`Publishing video: ${filePath}`)
        let page: Page | null = null

        try {
            if (!browserService.isConnected()) {
                await browserService.init(false)
            }

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

            // ─── Helper: Dismiss ALL popups/modals/backdrops ───
            const dismissOverlays = async () => {
                const dismissSelectors = [
                    'button:has-text("Got it")',
                    'button:has-text("OK")',
                    'button:has-text("Close")',
                    'button:has-text("Dismiss")',
                    'button:has-text("Đóng")',
                    '[class*="modal"] button[class*="close"]',
                    '[class*="Modal"] button[class*="close"]',
                    '[aria-label="Close"]',
                    '[aria-label="close"]',
                ]
                for (const sel of dismissSelectors) {
                    try {
                        const btn = await page!.$(sel)
                        if (btn && await btn.isVisible()) {
                            await btn.click()
                            console.log(`  Dismissed overlay: ${sel}`)
                            await page!.waitForTimeout(500)
                        }
                    } catch { /* ignore */ }
                }
                // Press Escape for remaining backdrops
                try {
                    const hasBackdrop = await page!.evaluate(() => {
                        const overlays = document.querySelectorAll('[class*="backdrop"], [class*="Backdrop"], [class*="overlay"], [class*="Overlay"], [class*="mask"], [class*="Mask"]')
                        for (const el of overlays) {
                            const style = getComputedStyle(el)
                            if (style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null) return true
                        }
                        return false
                    })
                    if (hasBackdrop) {
                        await page!.keyboard.press('Escape')
                        console.log('  Pressed Escape to dismiss backdrop')
                        await page!.waitForTimeout(500)
                    }
                } catch { /* ignore */ }
            }

            // ─── Navigate to TikTok Studio Upload ───
            console.log('Navigating to TikTok Studio upload page...')
            await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=upload&lang=en', {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            })
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
                await dismissOverlays()

                const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000 })
                if (!fileInput) throw new Error('File input not found on upload page')
                await fileInput.setInputFiles(filePath)
                console.log('  File selected')

                let uploadReady = false
                let uploadError = false

                for (let waitCycle = 0; waitCycle < 60; waitCycle++) {
                    await page.waitForTimeout(2000)

                    // Check for ERROR popups
                    for (const errText of ["Couldn't upload", "Upload failed", "Something went wrong", "upload failed"]) {
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
                        await dismissOverlays()
                        // Try Retry button
                        try {
                            const retryBtn = await page.$('button:has-text("Retry")')
                            if (retryBtn && await retryBtn.isVisible()) {
                                await retryBtn.click()
                                console.log('  Clicked "Retry"')
                                await page.waitForTimeout(2000)
                                uploadError = false
                                continue
                            }
                        } catch { /* no retry */ }
                        // Try Replace button
                        try {
                            const replaceBtn = await page.$('button:has-text("Replace")')
                            if (replaceBtn && await replaceBtn.isVisible()) {
                                await replaceBtn.click()
                                console.log('  Clicked "Replace" to re-upload')
                                await page.waitForTimeout(1000)
                            }
                        } catch { /* ignore */ }
                        break
                    }

                    // Check for upload completion
                    for (const sel of ['text="When to post"', 'button:has-text("Post")', 'button:has-text("Đăng")', 'text="Discard"', 'text="Edit video"']) {
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
                    await dismissOverlays()
                    await page.waitForTimeout(2000)
                }
            }

            if (!fileUploaded) throw new Error(`File upload failed after ${MAX_UPLOAD_RETRIES} attempts`)

            // ─── Dismiss any overlays blocking caption ───
            console.log('\n🧹 Clearing overlays before caption...')
            await dismissOverlays()
            await page.waitForTimeout(500)

            // ─── Set Caption ───
            console.log('✏️ Setting caption...')
            let captionSet = false
            for (const sel of ['.public-DraftEditor-content', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"].notranslate', 'div[contenteditable="true"][data-placeholder]', '[contenteditable="true"]']) {
                try {
                    const editor = await page.$(sel)
                    if (editor && await editor.isVisible()) {
                        await dismissOverlays()
                        await editor.click()
                        await page.waitForTimeout(300)
                        await page.keyboard.press('Control+a')
                        await page.keyboard.press('Backspace')
                        await page.waitForTimeout(200)
                        await page.keyboard.type(caption, { delay: 20 })
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
            let posted = false
            for (const sel of ['button:has-text("Post")', 'button:has-text("Đăng")', '[data-e2e="post-button"]']) {
                try {
                    const btn = await page.$(sel)
                    if (btn && await btn.isVisible()) {
                        for (let i = 0; i < 15; i++) {
                            const isDisabled = await btn.evaluate((el: HTMLButtonElement) => el.disabled)
                            if (!isDisabled) break
                            console.log(`  Post button disabled, waiting... (${i + 1}/15)`)
                            await page.waitForTimeout(2000)
                        }
                        await btn.click()
                        console.log(`  ✅ Post clicked (${sel})`)
                        posted = true
                        break
                    }
                } catch { /* try next */ }
            }
            if (!posted) throw new Error('Could not find or click Post button')

            // ─── Verify success & extract video link ───
            console.log('\n⏳ Verifying post success...')
            let videoUrl: string | undefined

            for (let i = 0; i < 30; i++) {
                await page.waitForTimeout(2000)

                let isSuccess = false
                for (const sel of ['text="Your video is being uploaded"', 'text="Your video has been published"', 'text="Manage your posts"', 'text="Video published"', 'text="Upload another video"']) {
                    try {
                        const el = await page.$(sel)
                        if (el && await el.isVisible()) {
                            console.log(`  ✅ Success confirmed: ${sel}`)
                            isSuccess = true
                            break
                        }
                    } catch { /* ignore */ }
                }

                if (isSuccess) {
                    // Extract video link
                    try {
                        videoUrl = await page.evaluate(() => {
                            const links = Array.from(document.querySelectorAll('a'))
                            for (const a of links) {
                                if (a.href.includes('/video/') && a.href.includes('tiktok.com')) return a.href
                            }
                            if (window.location.href.includes('/video/')) return window.location.href
                            return undefined
                        })
                        if (videoUrl) console.log(`  🔗 Video URL: ${videoUrl}`)
                    } catch { /* ignore */ }

                    // Try "Manage your posts" for the link
                    if (!videoUrl) {
                        try {
                            const manageLink = await page.$('a:has-text("Manage your posts")')
                            if (manageLink) {
                                const href = await manageLink.getAttribute('href')
                                console.log(`  📋 Manage posts: ${href}`)
                            }
                        } catch { /* ignore */ }
                    }

                    return { success: true, videoUrl }
                }

                // Check for post error
                try {
                    for (const errSel of ['text="Failed to post"', 'text="failed to post"']) {
                        const errEl = await page.$(errSel)
                        if (errEl && await errEl.isVisible()) throw new Error('TikTok reported: Failed to post video')
                    }
                } catch (e: any) {
                    if (e.message?.includes('TikTok reported')) throw e
                }

                if (i % 5 === 0 && i > 0) console.log(`  Processing... (${i * 2}s)`)
            }

            console.warn('  ⚠️ Post clicked but could not confirm success within timeout')
            return { success: true, videoUrl: undefined }

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
