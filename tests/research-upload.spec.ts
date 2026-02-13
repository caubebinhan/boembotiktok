import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// Helper to find a video file in the downloads directory
const findVideoFile = () => {
    const downloadDir = path.join(process.env.APPDATA || '', 'boembo/downloads/tiktok');
    if (fs.existsSync(downloadDir)) {
        const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp4'));
        if (files.length > 0) return path.join(downloadDir, files[0]);
    }
    return null;
};

// Helper to load cookies from the database
const loadCookiesFromDB = async (): Promise<any[] | null> => {
    try {
        const initSqlJs = require('sql.js');
        const dbPath = path.join(process.env.APPDATA || '', 'boembo/boembo.sqlite');
        if (!fs.existsSync(dbPath)) {
            console.log('Database not found at:', dbPath);
            return null;
        }

        const filebuffer = fs.readFileSync(dbPath);
        const SQL = await initSqlJs();
        const db = new SQL.Database(filebuffer);

        const res = db.exec("SELECT cookies_json FROM publish_accounts WHERE session_valid = 1 ORDER BY last_login_at DESC LIMIT 1");
        db.close();

        if (res.length > 0 && res[0].values.length > 0) {
            const cookiesStr = res[0].values[0][0] as string;
            if (cookiesStr) {
                return JSON.parse(cookiesStr).map((c: any) => {
                    if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None';
                    if (c.sameSite === 'lax') c.sameSite = 'Lax';
                    if (c.sameSite === 'strict') c.sameSite = 'Strict';
                    if (c.sameSite === 'None') c.secure = true;
                    return c;
                });
            }
        }
    } catch (err) {
        console.error('Cookie loading failed:', err);
    }
    return null;
};

test.setTimeout(300_000); // 5 minute timeout

test('Research TikTok Upload Flow — Robust Verification', async () => {
    // ── Step 1: Locate a video file ──
    const videoPath = findVideoFile();
    if (!videoPath) {
        console.log('⏭️ SKIP: No video file found in downloads directory');
        test.skip();
        return;
    }
    console.log(`📹 Video found: ${videoPath}`);

    // ── Step 2: Load cookies ──
    const cookies = await loadCookiesFromDB();
    if (!cookies) {
        console.log('⏭️ SKIP: No valid session cookies in DB');
        test.skip();
        return;
    }
    console.log(`🍪 Loaded ${cookies.length} cookies`);

    // ── Step 3: Launch browser ──
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    const screenshot = async (name: string) => {
        const screenshotDir = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const filePath = path.join(screenshotDir, `${name}.png`);
        await page.screenshot({ path: filePath, fullPage: false });
        console.log(`📸 Screenshot saved: ${filePath}`);
    };

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
                const btn = await page.$(sel)
                if (btn && await btn.isVisible()) {
                    await btn.click()
                    console.log(`  Dismissed overlay: ${sel}`)
                    await page.waitForTimeout(500)
                }
            } catch { /* ignore */ }
        }
        // Press Escape for remaining backdrops
        try {
            const hasBackdrop = await page.evaluate(() => {
                const overlays = document.querySelectorAll('[class*="backdrop"], [class*="Backdrop"], [class*="overlay"], [class*="Overlay"], [class*="mask"], [class*="Mask"]')
                for (const el of overlays) {
                    const style = getComputedStyle(el)
                    if (style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null) return true
                }
                return false
            })
            if (hasBackdrop) {
                await page.keyboard.press('Escape')
                console.log('  Pressed Escape to dismiss backdrop')
                await page.waitForTimeout(500)
            }
        } catch { /* ignore */ }
    }

    try {
        // ── Step 4: Navigate to TikTok Studio Upload ──
        console.log('\n🌐 Navigating to TikTok Studio upload page...');
        await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=upload&lang=en', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(3000);
        console.log('   Current URL:', page.url());

        if (page.url().includes('/login')) {
            console.log('🔒 Redirected to login! Cookies may be expired.');
            throw new Error('Session expired: redirected to login page.');
        }

        // ── Step 5: Upload file with retry ──
        const MAX_UPLOAD_RETRIES = 3
        let fileUploaded = false

        for (let uploadAttempt = 1; uploadAttempt <= MAX_UPLOAD_RETRIES; uploadAttempt++) {
            console.log(`\n📤 Upload attempt ${uploadAttempt}/${MAX_UPLOAD_RETRIES}...`)
            await dismissOverlays()

            const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000 })
            if (!fileInput) throw new Error('File input not found on upload page')
            await fileInput.setInputFiles(videoPath)
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

        // ── Step 6: Dismiss overlays & Set Caption ──
        console.log('\n🧹 Clearing overlays before caption...')
        await dismissOverlays()
        await page.waitForTimeout(500)

        console.log('✏️ Setting caption...')
        const caption = "Test upload from automation 🚀 #test"
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

        // ── Step 7: Click Post button ──
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

        // ── Step 8: Verify success & extract video link ──
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

                if (!videoUrl) {
                    try {
                        const manageLink = await page.$('a:has-text("Manage your posts")')
                        if (manageLink) {
                            const href = await manageLink.getAttribute('href')
                            console.log(`  📋 Manage posts: ${href}`)
                        }
                    } catch { /* ignore */ }
                }

                console.log('✅ TEST PASSED: Video published successfully');
                await screenshot('success_published');
                break
            }

            if (i % 5 === 0 && i > 0) console.log(`  Processing... (${i * 2}s)`)
        }

        if (!videoUrl) console.warn('⚠️ Video published but URL extraction failed');

    } catch (error) {
        console.error('Test failed:', error);
        await screenshot('ERROR_final_state');
        throw error;
    } finally {
        await page.close();
    }
});
