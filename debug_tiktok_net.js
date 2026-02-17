const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

// Try to find chrome executable
const getExecutablePath = () => {
    // Common paths
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of paths) {
        if (require('fs').existsSync(p)) return p;
    }
    return '';
};

(async () => {
    const browser = await chromium.launch({
        executablePath: getExecutablePath(),
        headless: false, // Headed to see what happens
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    const videoUrl = 'https://www.tiktok.com/@bellapoarch/video/6862153058223197445';

    console.log(`Navigating to ${videoUrl}`);

    const responses = [];

    page.on('response', async (response) => {
        const url = response.url();
        const type = response.request().resourceType();

        if (type === 'media' || url.includes('.mp4') || url.includes('video/tos')) {
            console.log(`[MEDIA] ${type} - ${url.substring(0, 100)}...`);
            try {
                const sizes = await response.headerValue('content-length');
                console.log(`   Size: ${sizes}`);
                responses.push({ url, type, size: sizes });
            } catch (e) { }
        }

        if (type === 'xhr' || type === 'fetch') {
            if (url.includes('item_info') || url.includes('detail')) {
                console.log(`[API] ${url.substring(0, 100)}...`);
                try {
                    const json = await response.json();
                    console.log('   Found JSON response. checking keys...');
                    if (json.itemInfo?.itemStruct?.video?.playAddr) {
                        console.log('   !!! FOUND playAddr in itemInfo !!!');
                        console.log('   playAddr:', json.itemInfo.itemStruct.video.playAddr);
                    }
                } catch (e) { }
            }
        }
    });

    try {
        await page.goto(videoUrl, { waitUntil: 'networkidle', timeout: 60000 });
        console.log('Page loaded.');

        // Wait a bit more for potential lazy loads
        await page.waitForTimeout(5000);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
        console.log('Done.');
    }
})();
