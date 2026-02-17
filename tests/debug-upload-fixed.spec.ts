import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
const ffmpegPath = require('ffmpeg-static');

// ─── CONFIGURATION ───
const DEBUG_DIR = path.join(__dirname, 'debug_artifacts');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

// ─── HELPER: Generate Dummy Video ───
const generateDummyVideo = (targetDir: string) => {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const videoPath = path.join(targetDir, 'debug_upload_video.mp4');
    if (fs.existsSync(videoPath)) return videoPath;

    console.log(`Generating dummy video at ${videoPath}...`);
    try {
        execSync(`"${ffmpegPath}" -y -f lavfi -i color=c=black:s=640x360:d=3 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100:d=3 -c:v libx264 -c:a aac -shortest "${videoPath}"`);
        return videoPath;
    } catch (e: any) {
        console.error('Failed to generate video:', e.message);
        return null;
    }
};

const getUserDataPath = () => {
    return process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'boembo')
        : path.join(process.env.HOME || '', 'Library/Application Support/boembo');
};

// ─── HELPER: Load Cookies ───
const loadCookiesFromDB = async (): Promise<any[] | null> => {
    try {
        const initSqlJs = require('sql.js');
        const dbPath = path.join(getUserDataPath(), 'boembo.sqlite');
        if (!fs.existsSync(dbPath)) return null;

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
    } catch (err) { console.error('Cookie loading failed:', err); }
    return null;
};

test('Debug TikTok Upload - Strict Fix', async () => {
    test.setTimeout(300000); // 5 minutes timeout for upload + verify
    const videoPath = generateDummyVideo(path.join(getUserDataPath(), 'downloads/debug'));
    if (!videoPath) {
        console.log('⏭️ SKIP: Could not generate video file');
        return;
    }

    // Load cookies
    const cookies = await loadCookiesFromDB();
    if (!cookies) console.log('⚠️ No DB cookies found. Manual login might be required.');

    console.log('🚀 Launching browser...');
    const browser = await chromium.launch({
        headless: false,
        slowMo: 100, // Slow down for visibility
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized']
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    if (cookies) await context.addCookies(cookies);
    const page = await context.newPage();

    // ─── HELPER: Screenshot & Dump ───
    const takeDebugSnapshot = async (stepName: string) => {
        const ts = Date.now();
        const screenshotPath = path.join(DEBUG_DIR, `${stepName}_${ts}.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 Saved screenshot: ${screenshotPath}`);
    };

    const cleanOverlays = async () => {
        // Known overlay selectors
        const selectors = [
            '[data-e2e="modal-close-icon"]',
            '[data-e2e="modal-close-button"]',
            'div[role="dialog"] button[aria-label="Close"]',
            'button:has-text("Turn on")', // Content check
            'button:has-text("Run check")'
        ];
        for (const sel of selectors) {
            try {
                const el = await page.locator(sel).first();
                if (await el.isVisible()) {
                    console.log(`🧹 Dismissing overlay: ${sel}`);
                    await el.click();
                    await page.waitForTimeout(500);
                }
            } catch { }
        }
        await page.keyboard.press('Escape');
    };

    try {
        // 1. Navigate
        console.log('🌐 Navigating to upload page...');
        await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=webapp', { timeout: 60000 });
        await page.waitForTimeout(3000);

        // Check login
        if (page.url().includes('login') || page.url().includes('signup')) {
            console.log('🔒 Login required. Please log in manually within 60s...');
            await page.waitForURL(url => !url.href.includes('login') && !url.href.includes('signup'), { timeout: 60000 });
        }

        await takeDebugSnapshot('1-upload-page-loaded');

        // 2. Upload File
        console.log('📤 Selecting file...');
        const fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 10000 });
        await fileInput.setInputFiles(videoPath);

        // Wait for upload confirmation (Caption input appears)
        await page.waitForSelector('[data-e2e="caption-input"], .public-DraftEditor-content', { timeout: 60000 });
        console.log('✅ File uploaded, caption input found.');
        await takeDebugSnapshot('2-file-uploaded');

        // 3. Set Caption with Unique Hashtag (User Request)
        const uniqueTag = '#' + Math.random().toString(36).substring(2, 8);
        const caption = `Debug Test Upload ${uniqueTag}`;
        console.log(`✏️ Setting caption with unique tag: ${uniqueTag}`);

        await cleanOverlays();
        const captionEditor = await page.locator('.public-DraftEditor-content').first();
        if (await captionEditor.isVisible()) {
            await captionEditor.click();
            await page.keyboard.type(caption, { delay: 50 });
        }
        await takeDebugSnapshot('3-caption-set');

        // 4. Force Button Visibility (Zoom Out - User Suggestion)
        console.log('🔧 Zooming out to 33% to reveal Post button (User Suggestion)...');
        await page.evaluate(() => {
            document.body.style.zoom = '0.33';
        });

        console.log('⏳ Waiting 5s for UI to settle (User Request)...');
        await page.waitForTimeout(5000);

        // 5. Detect Post Button (Smart Bottom Selection)
        console.log('🔍 Locating Post button (Bottom-most search)...');

        // Find ALL buttons with "Post" or "Đăng" text
        const buttons = page.locator('button:has-text("Post"), button:has-text("Đăng"), div[role="button"]:has-text("Post"), div[role="button"]:has-text("Đăng")');
        const count = await buttons.count();
        console.log(`   Found ${count} potential Post buttons.`);

        let bestBtn = null;
        let maxY = -1;

        for (let i = 0; i < count; i++) {
            const btn = buttons.nth(i);
            if (await btn.isVisible()) {
                const box = await btn.boundingBox();
                if (box) {
                    console.log(`   Button #${i}: Y=${box.y} Text=${await btn.innerText()}`);
                    // We want the bottom-most button (highest Y)
                    if (box.y > maxY) {
                        maxY = box.y;
                        bestBtn = btn;
                    }
                }
            }
        }

        if (bestBtn) {
            console.log(`✅ Selected bottom-most button at Y=${maxY}`);
            await cleanOverlays();
            await bestBtn.click();
            console.log('🚀 Clicked Post button');

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
        } else {
            console.log('⚠️ No visible Post buttons found. Dumping detailed HTML...');
            throw new Error('Post button not visible');
        }

        // 6. Verify Success & Privacy (Content Dashboard)
        console.log('\n⏳ Verifying post success...')
        let videoUrl: string | undefined
        let isSuccess = false

        for (let i = 0; i < 60; i++) {
            await page.waitForTimeout(2000)

            // 1. Check for "Uploading..." state
            const uploadingEl = await page.$('text="Your video is being uploaded"') || await page.$('text="Video của bạn đang được tải lên"')
            if (uploadingEl && await uploadingEl.isVisible()) {
                console.log('  ⏳ Upload in progress...')
                continue; // Keep waiting
            }

            // 2. Check for Success
            const successSelectors = [
                'text="Manage your posts"', 'text="Quản lý bài đăng"',
                'text="Your video has been published"', 'text="Video của bạn đã được đăng"',
                'text="Video published"',
                'text="Upload another video"', 'text="Tải video khác lên"'
            ]

            for (const sel of successSelectors) {
                const el = await page.$(sel)
                if (el && await el.isVisible()) {
                    console.log(`  ✅ Success confirmed: ${sel}`)
                    isSuccess = true
                    break
                }
            }

            if (isSuccess) {
                console.log('  🎉 Success detected. Navigating to Content Dashboard for Privacy Check...');
                await page.goto('https://www.tiktok.com/tiktokstudio/content', { waitUntil: 'domcontentloaded' });

                // RESEARCH: Loop 5 times (30s interval) to observe status transitions
                for (let check = 1; check <= 5; check++) {
                    console.log(`  🕵️♂️ Status Research Check ${check}/5...`);
                    await page.waitForTimeout(30000); // 30s interval

                    // Analyze JSON for Video Status
                    const videoData = await page.evaluate((tag) => {
                        try {
                            const script = document.getElementById('__Creator_Center_Context__');
                            if (!script || !script.textContent) return null;
                            const data = JSON.parse(script.textContent);
                            const itemList = data?.uploadUserProfile?.firstBatchQueryItems?.item_list || [];

                            const match = itemList.find((v: any) => v.desc && v.desc.includes(tag));
                            return match; // Return FULL match object to see all properties
                        } catch (e) { return null; }
                    }, uniqueTag);

                    if (videoData) {
                        console.log(`  ✅ Video Match Data (Check ${check}):`);
                        console.log(JSON.stringify(videoData, null, 2)); // Log EVERYTHING

                        // Check if Public
                        if (videoData.privacy_level === 1 && videoData.status === 102) { // Hypothesized success codes
                            console.log('  🟢 Video appears PUBLIC.');
                        }
                    } else {
                        console.log('  ⚠️ Video not found in list yet.');
                    }

                    console.log('  🔄 Reloading page...');
                    await page.reload({ waitUntil: 'domcontentloaded' });
                }

                // End test after research
                return;
            }
        }

        if (!videoUrl) throw new Error('Post success detected but could not retrieve video URL (Timeout).')

        await takeDebugSnapshot('5-success');
        console.log(`  🔗 Video URL Verified: ${videoUrl}`)
    } catch (error: any) {
        console.error('❌ Test Failed:', error);
        await takeDebugSnapshot('FAILURE');
        const htmlPath = path.join(DEBUG_DIR, `failure_${Date.now()}.html`);
        fs.writeFileSync(htmlPath, await page.content());
        console.log(`📄 Saved HTML dump: ${htmlPath}`);
        throw error; // Re-throw to fail test
    } finally {
        await browser.close();
    }
});
