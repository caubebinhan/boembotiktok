import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// Helper to generate a dummy MP4 video
import { execSync } from 'child_process';
const ffmpegPath = require('ffmpeg-static');

const generateDummyVideo = (targetDir: string) => {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const videoPath = path.join(targetDir, 'test_upload_video.mp4');
    if (fs.existsSync(videoPath)) return videoPath;

    console.log(`Generating dummy video at ${videoPath}...`);
    try {
        execSync(`"${ffmpegPath}" -y -f lavfi -i color=c=black:s=640x360:d=3 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100:d=3 -c:v libx264 -c:a aac -shortest "${videoPath}"`);
        return videoPath;
    } catch (e: any) {
        console.error('Failed to generate video:', e.message);
        return null; // Fallback
    }
};

const findVideoFile = () => {
    const downloadDir = path.join(getUserDataPath(), 'downloads/tiktok');

    // Try to find existing first
    if (fs.existsSync(downloadDir)) {
        const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp4'));
        if (files.length > 0) return path.join(downloadDir, files[0]);
    }

    // Generate one
    return generateDummyVideo(downloadDir);
};
const getUserDataPath = () => {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'boembo');
    }
    return path.join(process.env.HOME || '', 'Library/Application Support/boembo');
};



// Helper to load cookies from the database
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
    // ── Step 2: Load cookies (Optional) ──
    const cookies = await loadCookiesFromDB();
    if (cookies) {
        console.log(`🍪 Loaded ${cookies.length} cookies from DB`);
    } else {
        console.log('⚠️ No session cookies found in DB. Initiating interactive login...');
    }

    // ── Step 3: Launch browser with Persistent Context or Storage State ──
    const authFile = path.join(__dirname, 'playwright_auth.json');
    let context;
    let browser;

    console.log('🚀 Launching bundled Chromium...');
    browser = await chromium.launch({
        headless: false,
        slowMo: 100,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars', '--start-maximized']
    });

    if (fs.existsSync(authFile)) {
        console.log('📂 Loading saved session from playwright_auth.json');
        context = await browser.newContext({ storageState: authFile, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', viewport: { width: 1280, height: 800 } });
    } else {
        console.log('⚠️ No saved session found.');
        context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', viewport: { width: 1280, height: 800 } });
    }

    // Inject DB cookies if we have them and no auth file? 
    // Actually, let's just use DB cookies if auth file missing, or mix them.
    if (cookies && !fs.existsSync(authFile)) {
        await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // Check if we are logged in (either via auth file or DB cookies)
    await page.goto('https://www.tiktok.com/upload?lang=en');
    await page.waitForTimeout(2000);

    if (page.url().includes('/login')) {
        console.log('🔒 Login required. Please log in manually...');

        // Wait for successful login (URL change or profile icon)
        try {
            console.log('⏳ Waiting for login...');
            await Promise.race([
                page.waitForSelector('[data-e2e="user-icon"], [data-e2e="profile-icon"]', { state: 'attached', timeout: 300000 }),
                page.waitForURL(url => !url.href.includes('/login') && !url.href.includes('/signup'), { timeout: 300000 })
            ]);
            console.log('✅ Login detected!');
            await page.waitForTimeout(3000);

            // Save state
            await context.storageState({ path: authFile });
            console.log('💾 Session saved to playwright_auth.json');
        } catch (e) {
            console.error('❌ Login timeout or failure.');
            throw e;
        }
    } else {
        console.log('✅ Already logged in!');
    }

    const screenshot = async (name: string) => {
        try {
            const screenshotDir = path.join(__dirname, 'screenshots');
            if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
            const filePath = path.join(screenshotDir, `${name}.png`);
            if (page.isClosed()) {
                console.log(`⚠️ Cannot take screenshot '${name}': Page is closed`);
                return;
            }
            await page.screenshot({ path: filePath, fullPage: false });
            console.log(`📸 Screenshot saved: ${filePath}`);
        } catch (e) {
            console.log(`⚠️ Failed to take screenshot '${name}':`, e);
        }
    };

    // ─── Helper: Smart Overlay/Modal Cleaner ───
    const cleanOverlays = async (targetSelector?: string) => {
        console.log(`🧹 Running Smart Overlay Cleaner${targetSelector ? ' for ' + targetSelector : ''}...`);

        // 1. Static list of known close buttons (Fast path)
        const commonSelectors = [
            'button[aria-label="Close"]', 'button[aria-label="close"]',
            'svg[data-icon="close"]', 'div[role="dialog"] button[aria-label="Close"]',
            'button:has-text("Got it")', 'button:has-text("OK")',
            'button:has-text("Dismiss")', 'button:has-text("Not now")',
            'button:has-text("Skip")', 'div[class*="modal"] button',
            // TikTok specific
            'button:has-text("Turn on")', 'button:has-text("Run check")', 'button:has-text("Try it now")',
            '[data-e2e="modal-close-inner-button"]', '[data-e2e="modal-close-button"]'
        ];

        for (const sel of commonSelectors) {
            try {
                const btns = await page.$$(sel);
                for (const btn of btns) {
                    if (await btn.isVisible()) {
                        console.log(`   found visible overlay button: ${sel}, clicking...`);
                        await btn.click({ force: true, timeout: 500 }).catch(() => { });
                        await page.waitForTimeout(200);
                    }
                }
            } catch { }
        }

        // 2. Escape key (Universal dismiss)
        await page.keyboard.press('Escape');

        // 3. Obstruction Detection (Target-based)
        if (targetSelector) {
            try {
                const target = await page.$(targetSelector)
                if (target) {
                    const isObscured = await page.evaluate((el: Element) => {
                        const rect = el.getBoundingClientRect()
                        const x = rect.left + rect.width / 2
                        const y = rect.top + rect.height / 2
                        const topEl = document.elementFromPoint(x, y)

                        // Check if topEl is the target or a descendant
                        if (topEl && el !== topEl && !el.contains(topEl)) {
                            console.log('Obscured by:', topEl)
                            return true
                        }
                        return false
                    }, target)

                    if (isObscured) {
                        console.log(`   ⚠️ Target ${targetSelector} is still obscured!`)
                        // Aggressive removal disabled to prevent crashes during verification
                    }
                }
            } catch (e) {
                console.log('   Overlay check error:', e)
            }
        }
    };

    // ... (rest of the file until success check) ...

    // Helper to Retry Actions with cleaning
    const interactWithRetry = async (action: () => Promise<any>, targetSel: string) => {
        for (let i = 0; i < 5; i++) {
            try {
                await cleanOverlays(targetSel);
                await action();
                return;
            } catch (e: any) {
                if (i === 4) throw e;
                console.log(`   Action failed, retrying after cleaning (${e.message.slice(0, 50)}...)`);
                await page.waitForTimeout(1000);
            }
        }
    };
    try {
        // ── Step 4: Navigate to TikTok Studio Upload ──
        console.log('\n🌐 Navigating to TikTok Studio upload page...');
        try {
            await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=upload&lang=en', {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
        } catch (e: any) {
            if (e.message.includes('interrupted by another navigation') || e.message.includes('navigating to')) {
                console.log('  ⚠️ Navigation redirected (expected)');
            } else {
                throw e;
            }
        }
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
            await cleanOverlays()

            // Wait for file input to be present in DOM (it might be hidden)
            const fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })
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
                    await cleanOverlays()
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
                await cleanOverlays()
                await page.waitForTimeout(2000)
            }
        }

        if (!fileUploaded) throw new Error(`File upload failed after ${MAX_UPLOAD_RETRIES} attempts`)

        // ── Step 6: Handle Popups & Set Caption ──
        console.log('\n🧹 Handling special popups (Content Check, etc)...')

        // 1. Handle "Run a copyright check" / "Automatic content checks"
        // This often blocks the caption area. We MUST click "Turn on" or dismiss it.
        try {
            const checkPopup = await page.locator('text="Run a copyright check"').or(page.locator('text="Automatic content checks"'))
            if (await checkPopup.isVisible({ timeout: 3000 })) {
                console.log('  ⚠️ Detected Content Check popup')

                // Content check usually has a "Turn on" or "Run check" button
                const turnOnBtn = await page.locator('button:has-text("Turn on"), button:has-text("Try it now"), button:has-text("Run check")').first()
                if (await turnOnBtn.isVisible()) {
                    await turnOnBtn.click()
                    console.log('  ✅ Clicked "Turn on" for content check')
                    await page.waitForTimeout(1000)
                } else {
                    // If no button found, try to dismiss via close button or Escape
                    console.log('  ⚠️ No "Turn on" button found, attempting to dismiss...')
                }
            }
        } catch { /* ignore */ }

        // 2. Handle "Split into multiple parts"
        try {
            const splitModal = await page.locator('text="Split into multiple parts"')
            if (await splitModal.isVisible({ timeout: 1000 })) {
                console.log('  ⚠️ Detected Split Video modal')
                const okBtn = await page.locator('button:has-text("OK"), button:has-text("Confirm")').first()
                if (await okBtn.isVisible()) await okBtn.click()
            }
        } catch { /* ignore */ }

        // 3. Dismiss generic overlays (cookies, education tooltips)
        await cleanOverlays()
        await page.waitForTimeout(500)

        // ── Step 6.5: Set Caption ──
        console.log('\n🧹 Clearing overlays before caption...')
        await cleanOverlays()
        await page.waitForTimeout(500)

        console.log('✏️ Setting caption...');
        const potentialEditors = ['.public-DraftEditor-content', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"].notranslate', 'div[contenteditable="true"][data-placeholder]', '[contenteditable="true"]'];

        let captionSet = false;
        for (const sel of potentialEditors) {
            try {
                const editor = await page.$(sel);
                if (editor && await editor.isVisible()) {
                    await interactWithRetry(async () => {
                        await editor!.click();
                        await page.waitForTimeout(300);
                        await page.keyboard.press('Control+a');
                        await page.keyboard.press('Backspace');
                        await page.waitForTimeout(200);
                        await page.keyboard.type('Test Caption from Automation', { delay: 20 });
                    }, sel);
                    console.log(`  Caption set (${sel})`);
                    captionSet = true;
                    break;
                }
            } catch { /* try next */ }
        }
        if (!captionSet) console.warn('  ⚠️ Could not find caption editor');

        await page.waitForTimeout(1000)


        let posted = false;
        const postSelectors = ['button:has-text("Post")', '[data-e2e="post-button"]'];

        // Ensure overlays are gone before clicking post
        await cleanOverlays();

        console.log('📜 Looking for scrollable container...');
        // Find the largest scrollable element
        const scrollableContainer = await page.evaluateHandle(() => {
            const potential = Array.from(document.querySelectorAll('*')).filter(el => {
                const style = window.getComputedStyle(el);
                return (style.overflowY === 'scroll' || style.overflowY === 'auto') && el.scrollHeight > el.clientHeight;
            });
            // Sort by scrollHeight descending to find the main one
            potential.sort((a, b) => b.scrollHeight - a.scrollHeight);
            return potential.length > 0 ? potential[0] : document.documentElement;
        });

        if (scrollableContainer) {
            console.log('   Found scrollable container, scrolling to bottom...');
            await scrollableContainer.evaluate((el: Element) => el.scrollTop = el.scrollHeight);
            await page.waitForTimeout(2000); // Wait for lazy load
        } else {
            console.log('   No specific scrollable container found, using window scroll.');
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(2000);
        }

        // Find all candidates and log their position
        const candidates = await page.$$('button:has-text("Post"), [data-e2e="post-button"]');
        console.log(`   Found ${candidates.length} candidate "Post" buttons.`);

        let bestBtn = null;
        let maxY = -1;

        for (const btn of candidates) {
            const box = await btn.boundingBox();
            if (box && await btn.isVisible()) {
                console.log(`   Candidate: "${await btn.innerText()}" at y=${box.y}`);
                // We want the one furthest down the page (highest Y)
                if (box.y > maxY) {
                    maxY = box.y;
                    bestBtn = btn; // Keep handle
                }
            }
        }

        if (bestBtn) {
            console.log(`   🎯 Selected best Post button at y=${maxY}`);
            try {
                // Ensure visible/scrolled into view
                await bestBtn.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);

                // Re-clean overlays just in case
                await cleanOverlays();

                await bestBtn.click({ timeout: 5000 });
                console.log(`  ✅ Post clicked (Best candidate)`);
                posted = true;
            } catch (e) {
                console.log(`  Click failed on best candidate, trying force...`);
                await bestBtn.click({ force: true });
                posted = true;
            }
        } else {
            // Fallback to iterating selector list if our smart logic failed
            console.log('   ⚠️ Smart selection failed, falling back to legacy loop...');
            for (const sel of postSelectors) {
                try {
                    const btn = await page.$(sel);
                    if (btn && await btn.isVisible()) {
                        await interactWithRetry(async () => {
                            await btn!.click({ timeout: 2000 });
                        }, sel);
                        console.log(`  ✅ Post clicked (${sel})`);
                        posted = true;
                        break;
                    }
                } catch { }
            }
        }


        if (!posted) throw new Error('Could not find or click Post button after multiple attempts')

        // ── Step 8: Verify success & extract video link ──
        console.log('\n⏳ Verifying post success...')
        let videoUrl: string | undefined

        let isSuccess = false
        for (let i = 0; i < 30; i++) {
            await page.waitForTimeout(2000)

            // Dismiss any post-upload popups (e.g. "Manage your posts", "View Profile")
            try {
                const managePopup = await page.locator('text="Manage your posts"')
                if (await managePopup.isVisible()) {
                    console.log('  ✅ Detected "Manage your posts" popup -> upload success!')
                    isSuccess = true

                    // Try to click "View Profile" BEFORE cleaning overlays
                    try {
                        const viewProfileBtn = await page.locator('button:has-text("View Profile"), a:has-text("View Profile")').first()
                        if (await viewProfileBtn.isVisible()) {
                            console.log('  Found View Profile button inside popup, clicking...')
                            await viewProfileBtn.click()
                            await page.waitForTimeout(2000)
                            // If we navigated, we don't need to clean overlays might as well break or continue
                        }
                    } catch (e) {
                        console.log('  Failed to click View Profile in popup:', e)
                    }
                }
                // Only clean overlays if we didn't navigate away? 
                // Checks if we are still on upload page?
                if (page.url().includes('upload')) {
                    await cleanOverlays()
                }
            } catch { /* ignore */ }

            for (const sel of ['text="Your video has been published"', 'text="Manage your posts"', 'text="Video published"', 'text="Upload another video"']) {
                try {
                    const el = await page.$(sel)
                    if (el && await el.isVisible()) {
                        console.log(`  ✅ Success confirmed: ${sel}`)
                        isSuccess = true
                        break
                    }
                } catch { /* ignore */ }
            }

            // Check for upload progress (not success)
            try {
                const uploadingEl = await page.$('text="Your video is being uploaded"')
                if (uploadingEl && await uploadingEl.isVisible()) {
                    console.log('  ⏳ Upload in progress...')
                }
            } catch { /* ignore */ }

            if (isSuccess) {
                console.log('  🎉 Verify success logic triggering...')
                await page.waitForTimeout(2000) // wait for UI to settle

                // Strategy 1: Look for "Manage your posts" link which implies we are done
                try {
                    const manageLink = await page.$('a:has-text("Manage your posts"), a[href*="/manage"]');
                    if (manageLink) {
                        const href = await manageLink.getAttribute('href');
                        console.log(`  📋 Found "Manage your posts" link: ${href}`);
                        if (href) {
                            // Navigate there to get the video link? 
                            // Or just return successful. The user wants the link.
                            // Usually "Manage posts" goes to the video list.
                        }
                    }
                } catch { /* check next */ }

                // Strategy 2: Check for direct "View Profile" or "View Video" link
                // Often the success modal has a "View Profile" button
                try {
                    const viewProfileBtn = await page.locator('button:has-text("View Profile"), a:has-text("View Profile")').first();
                    if (await viewProfileBtn.isVisible()) {
                        console.log('  Found View Profile button, clicking to find video...');
                        await viewProfileBtn.click();
                        await page.waitForURL(/tiktok\.com\/@/, { timeout: 10000 });
                    } else {
                        // FALLBACK: Click the profile icon in the header
                        console.log('  "View Profile" button not found. Attempting to click User Avatar...');
                        const profileIcon = await page.locator('[data-e2e="user-icon"], [data-e2e="profile-icon"]').first();
                        if (await profileIcon.isVisible()) {
                            await profileIcon.click();
                            await page.waitForURL(/tiktok\.com\/@/, { timeout: 10000 });
                        }
                    }

                    // Grab first video (works for both View Profile click and Avatar click)
                    if (page.url().includes('/@')) {
                        console.log('  On profile page, looking for latest video...');
                        await page.waitForSelector('[data-e2e="user-post-item"] a', { timeout: 10000 });
                        const firstVideoLink = await page.$eval('[data-e2e="user-post-item"] a', (el: any) => el.href);
                        if (firstVideoLink) {
                            videoUrl = firstVideoLink;
                            console.log(`  🔗 Found latest video on profile: ${videoUrl}`);
                            break
                        }
                    }
                } catch (e) { console.log('  Verification via Profile failed:', e) }


                // Strategy 3: Check explicitly for video URL in current page (if it redirected or showed modal)
                if (!videoUrl) {
                    videoUrl = await page.evaluate(() => {
                        // Check for common link patterns
                        const links = Array.from(document.querySelectorAll('a'));
                        for (const a of links) {
                            const anchor = a as HTMLAnchorElement;
                            if ((anchor.href.includes('/video/') || anchor.href.includes('/v/')) && anchor.href.includes('tiktok.com')) return anchor.href;
                        }
                        if (window.location.href.includes('/video/')) return window.location.href;
                        return undefined;
                    });
                }

                if (videoUrl) {
                    console.log(`  🔗 FINAL VIDEO URL: ${videoUrl}`);
                    break
                }
            }

            if (i % 5 === 0 && i > 0) console.log(`  Processing... (${i * 2}s)`)
        }

        if (!videoUrl) {
            throw new Error('Video published but URL extraction failed. Enforcing strict success check.')
        }
    } catch (error) {
        console.error('Test failed:', error);
        await page.screenshot({ path: path.join(__dirname, 'failure.png'), fullPage: true });
        throw error;
    } finally {
        if (browser) await browser.close();
    }
});
