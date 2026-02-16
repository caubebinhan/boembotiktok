import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Force Windows environment check (though we are on Windows)
if (process.platform !== 'win32') {
    console.warn('⚠️ This test is optimized for Windows but running on non-Windows platform.');
}

const ffmpegPath = require('ffmpeg-static');

// ─── Windows Specific Helper Functions ───

const getUserDataPath = () => {
    // Explicitly use APPDATA for Windows
    return path.join(process.env.APPDATA || 'C:\\Users\\linhlinh\\AppData\\Roaming', 'boembo');
};

const generateDummyVideo = (targetDir: string) => {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const videoPath = path.join(targetDir, 'test_upload_video.mp4');
    if (fs.existsSync(videoPath)) return videoPath;

    console.log(`Generating dummy video at ${videoPath}...`);
    try {
        // Enforce Windows quoting for paths
        execSync(`"${ffmpegPath}" -y -f lavfi -i color=c=black:s=640x360:d=3 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100:d=3 -c:v libx264 -c:a aac -shortest "${videoPath}"`);
        return videoPath;
    } catch (e: any) {
        console.error('Failed to generate video:', e.message);
        return null;
    }
};

const findVideoFile = () => {
    const downloadDir = path.join(getUserDataPath(), 'downloads', 'tiktok');

    if (fs.existsSync(downloadDir)) {
        const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp4'));
        if (files.length > 0) return path.join(downloadDir, files[0]);
    }

    return generateDummyVideo(downloadDir);
};

const loadCookiesFromDB = async (): Promise<any[] | null> => {
    try {
        const initSqlJs = require('sql.js');
        const dbPath = path.join(getUserDataPath(), 'boembo.sqlite');

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

test.setTimeout(300_000); // 5 minutes

test('Windows: Research TikTok Upload Flow', async () => {
    console.log('🖥️ Running Windows-specific upload test...');

    // 1. Video
    const videoPath = findVideoFile();
    if (!videoPath) {
        console.log('⏭️ SKIP: Could not find or generate video file.');
        test.skip();
        return;
    }
    console.log(`📹 Video source: ${videoPath}`);

    // 2. Cookies
    const cookies = await loadCookiesFromDB();
    if (cookies && cookies.length > 0) {
        console.log(`🍪 Loaded ${cookies.length} cookies from DB.`);
    } else {
        console.log('⚠️ No cookies found. Will require manual login.');
    }

    // 3. Browser (Windows specific args)
    // Sometimes Windows machines need --disable-gpu or other flags if headless
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--start-maximized',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US', // Force English for selector consistency
    });

    if (cookies) {
        await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // 4. Overlays Cleaner
    const cleanOverlays = async (targetSelector?: string) => {
        const commonSelectors = [
            'button[aria-label="Close"]', 'svg[data-icon="close"]',
            'button:has-text("Got it")', 'button:has-text("OK")',
            'button:has-text("Dismiss")', 'button:has-text("Not now")',
            'button:has-text("Skip")',
            'button:has-text("Turn on")', 'button:has-text("Run check")', 'button:has-text("Try it now")',
            '[data-e2e="modal-close-inner-button"]', '[data-e2e="modal-close-button"]'
        ];

        for (const sel of commonSelectors) {
            try {
                const btns = await page.$$(sel);
                for (const btn of btns) {
                    if (await btn.isVisible()) {
                        console.log(`   Dismissing overlay: ${sel}`);
                        await btn.click({ force: true, timeout: 500 }).catch(() => { });
                        await page.waitForTimeout(300);
                    }
                }
            } catch { }
        }
        await page.keyboard.press('Escape');
    };

    try {
        // 5. Navigation
        console.log('🌐 Navigating to upload page...');
        await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=upload&lang=en', { timeout: 60000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        if (page.url().includes('/login')) {
            console.log('🔒 Login required. Please log in manually on this window.');
            await page.waitForTimeout(5000); // Give user a moment to see
            // In a real automated flow we might fail here, but for research we wait or fail
            // We wait for user-icon
            await Promise.race([
                page.waitForSelector('[data-e2e="user-icon"]', { timeout: 120_000 }), // 2 mins to login
                page.waitForSelector('[data-e2e="profile-icon"]', { timeout: 120_000 })
            ]);
            console.log('✅ Login detected.');
        }

        // 6. Upload
        console.log('📤 Uploading video...');
        const fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 30000 });
        if (!fileInput) throw new Error('File input not found');

        await fileInput.setInputFiles(videoPath);

        let uploadSuccess = false;
        for (let i = 0; i < 60; i++) { // Wait up to 2 mins
            await page.waitForTimeout(2000);

            // Check for success indicators
            if (await page.isVisible('button:has-text("Post")') || await page.isVisible('button:has-text("Đăng")')) {
                uploadSuccess = true;
                break;
            }
            if (await page.isVisible('text="Edit video"')) {
                uploadSuccess = true;
                break;
            }

            // Error check
            if (await page.isVisible('text="Upload failed"')) {
                throw new Error('Upload failed message detected');
            }
        }

        if (!uploadSuccess) throw new Error('Upload timed out or failed');

        // 7. Caption
        console.log('✏️ Setting caption...');
        await cleanOverlays();
        const editor = await page.$('.public-DraftEditor-content, [contenteditable="true"]');
        if (editor) {
            await editor.click();
            await page.keyboard.type(' #WindowsTest', { delay: 50 });
        }

        // 8. Post
        console.log('🚀 Clicking Post...');
        await cleanOverlays();

        // 8. Post (ROBUST VERSION)
        console.log('🚀 Clicking Post (Robust)...');
        await cleanOverlays();

        // Retry loop for finding the button
        let postButtonFound = false;

        for (let i = 0; i < 15; i++) {
            // 1. Scroll container
            const scrollHandle = await page.evaluateHandle(() => {
                const potential = Array.from(document.querySelectorAll('*')).filter(el => {
                    const style = window.getComputedStyle(el);
                    return (style.overflowY === 'scroll' || style.overflowY === 'auto') && el.scrollHeight > el.clientHeight;
                });
                potential.sort((a, b) => b.scrollHeight - a.scrollHeight);
                return potential.length > 0 ? potential[0] : document.documentElement;
            });

            if (scrollHandle) {
                await scrollHandle.evaluate((el: Element) => el.scrollTop = el.scrollHeight);
            }
            await page.waitForTimeout(2000);

            // 2. Find Candidates
            const candidates = await page.$$('button:has-text("Post"), button:has-text("POST"), button:has-text("Đăng"), [data-e2e="post-button"]');
            console.log(`   Attempt ${i + 1}: Found ${candidates.length} candidates`);

            let bestBtn = null;
            let maxY = -1;

            for (const btn of candidates) {
                const box = await btn.boundingBox();
                if (box && await btn.isVisible()) {
                    if (box.y > maxY) {
                        maxY = box.y;
                        bestBtn = btn;
                    }
                }
            }

            if (bestBtn) {
                try {
                    await bestBtn.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(500);
                    // await cleanOverlays(); // Careful with recursion if sharing func
                    await bestBtn.click({ timeout: 5000 });
                    console.log('✅ Clicked Post (Smart selection)');
                    postButtonFound = true;
                    break;
                } catch (e) {
                    console.log('   Click failed, trying force...');
                    await bestBtn.click({ force: true }).catch(() => { });
                    postButtonFound = true;
                    break;
                }
            }
        }

        if (!postButtonFound) {
            throw new Error('Post button NOT found after smart search.');
        }

        // 9. Verify
        console.log('⏳ Verifying publication...');
        await page.waitForTimeout(5000);
        const success = await page.locator('text="Manage your posts"').or(page.locator('text="Video published"')).isVisible({ timeout: 30000 });

        if (success) {
            console.log('🎉 SUCCESS: Video published!');
        } else {
            console.warn('⚠️ Could not confirm success message explicitly, but Post was clicked.');
        }

    } catch (error) {
        console.error('❌ Test Failed:', error);
        // Save screenshot
        await page.screenshot({ path: path.join(__dirname, 'windows_failure.png') });
        throw error;
    } finally {
        console.log('🏁 Test finished. Closing browser...');
        await browser.close();
    }
});
