import { chromium } from 'playwright-core';
import fs from 'fs';
import axios from 'axios';

async function testSelectors() {
    console.log('Starting Selector Test...');
    const browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
        const testUrl = 'https://www.tiktok.com/@bts_official_bighit/video/7565127603405835528';
        console.log(`Navigating to ${testUrl}...`);
        await page.goto(testUrl, { waitUntil: 'domcontentloaded' });

        console.log('Waiting for video element...');
        const title = await page.title();
        console.log(`Page Title: ${title}`);

        await page.screenshot({ path: 'debug_selector_dump.png', fullPage: true });

        // Try multiple selectors
        const video = await page.waitForSelector('video', { timeout: 10000 }).catch(() => null);

        if (video) {
            const src = await video.getAttribute('src');
            console.log(`Video found! Src: ${src}`);

            // Download verification
            if (src) {
                const fs = require('fs');
                const axios = require('axios');
                console.log('Downloading video to verify...');

                const response = await axios({
                    url: src,
                    method: 'GET',
                    responseType: 'stream',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://www.tiktok.com/'
                    }
                });

                const writer = fs.createWriteStream('debug_selector_download.mp4');
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                console.log('Download complete via Selector URL.');

                // Check magic bytes
                const fd = fs.openSync('debug_selector_download.mp4', 'r');
                const buffer = Buffer.alloc(8);
                fs.readSync(fd, buffer, 0, 8, 0);
                fs.closeSync(fd);
                console.log(`First 8 bytes: ${buffer.toString('hex')} / ${buffer.toString('ascii')}`);
            }

        } else {
            console.log('Video element NOT found.');
            const pageText = await page.innerText('body');
            console.log(`Page text preview: ${pageText.substring(0, 200)}`);
            await page.screenshot({ path: 'debug_selector_fail.png', fullPage: true });
        }

        console.log('Checking for captcha...');
        const captcha = await page.$('.captcha-disable-scroll');
        if (captcha) console.log('CAPTCHA DETECTED!');

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await new Promise(r => setTimeout(r, 60000)); // Keep open for manual inspection
        await browser.close();
    }
}

testSelectors();
