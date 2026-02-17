
import { chromium } from 'playwright-core';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';

const TEST_URL = 'https://www.tiktok.com/@hoaa.hanassii/video/7338575689849244936'; // Standard video
const OUTPUT_FILE = './debug_download_test.mp4';
const LOG_FILE = './debug_script_log.txt';

function log(msg: string) {
    console.log(msg);
    try { fs.appendFileSync(LOG_FILE, msg + '\n'); } catch { }
}

async function testDownload() {
    log('Starting Debug Download Test...');
    const browser = await chromium.launch({
        headless: false,
        channel: 'chrome', // Try to match app's use of system Chrome
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--lang=en-US,en',
        ]
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US'
    });
    const page = await context.newPage();

    let videoStreamUrl = '';
    try {
        let videoHeaders = {};
        let contentLen = 0;

        // 0. Try Library First (Mocking TikTokModule logic)
        log('Attempting Library Download...');
        try {
            /* @ts-ignore */
            const { Downloader } = await import('@tobyg74/tiktok-api-dl');
            const result = await Downloader(TEST_URL, { version: 'v1' });
            log(`Library Result Status: ${result.status}`);

            if (result.status === 'success' && result.result?.video) {
                const vData = result.result.video;
                if (Array.isArray(vData) && vData.length > 0) videoStreamUrl = vData[0];
                else if (typeof vData === 'string') videoStreamUrl = vData;

                if (videoStreamUrl) {
                    log(`Library found URL: ${videoStreamUrl}`);
                }
            }
        } catch (e: any) {
            log(`Library failed: ${e.message}`);
        }

        if (!videoStreamUrl) {
            log('Library failed/empty. Starting Puppeteer Fallback...');

            // 1. Intercept Network
            page.on('response', async (response: any) => {
                const url = response.url();
                let headers: Record<string, string> = {};
                try { headers = await response.allHeaders(); } catch { }
                const type = headers['content-type'] || '';
                const len = parseInt(headers['content-length'] || '0');

                if ((type.includes('video/') || url.includes('video/tos')) && len > 1024 * 1024) {
                    log(`[Intercept] Found candidate: ${url.substring(0, 50)}... (${len} bytes)`);
                    if (len > contentLen) {
                        contentLen = len;
                        videoStreamUrl = url;
                        try { videoHeaders = await response.request().allHeaders(); } catch { }
                    }
                }
            });

            log(`Navigating to ${TEST_URL}...`);
            await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(5000); // Wait for media load

            // 2. DOM Fallback
            if (!videoStreamUrl) {
                log('Network intercept failed. Trying DOM...');
                videoStreamUrl = await page.evaluate(() => {
                    const v = document.querySelector('video');
                    return v ? v.src : '';
                });
            }
        }

        log(`Video URL: ${videoStreamUrl}`);
        if (!videoStreamUrl) {
            log('No video URL found. Dumping page state...');
            await page.screenshot({ path: 'debug_dump.png' });
            const html = await page.content();
            fs.writeFileSync('debug_dump.html', html);
            throw new Error('No video URL found');
        }

        // 3. Download via Axios
        const downloadHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        };

        // Merge headers
        if (videoHeaders) {
            for (const [k, v] of Object.entries(videoHeaders)) {
                if (k.startsWith(':') || ['host', 'connection', 'content-length'].includes(k.toLowerCase())) continue;
                downloadHeaders[k] = v as string;
            }
        }

        log(`Download Headers: ${JSON.stringify(downloadHeaders, null, 2)}`);

        const writer = fs.createWriteStream(OUTPUT_FILE);
        const response = await axios({
            url: videoStreamUrl,
            method: 'GET',
            responseType: 'stream',
            headers: downloadHeaders
        });

        log(`Axios Status: ${response.status}`);
        log(`Axios Content-Type: ${response.headers['content-type']}`);
        log(`Axios Content-Length: ${response.headers['content-length']}`);

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        log('Download complete.');

        // 4. Verify File Header (Magic Bytes)
        const fd = await fs.open(OUTPUT_FILE, 'r');
        const buffer = Buffer.alloc(8);
        await fs.read(fd, buffer, 0, 8, 0);
        await fs.close(fd);

        log(`First 8 bytes (Hex): ${buffer.toString('hex')}`);
        log(`First 8 bytes (ASCII): ${buffer.toString('ascii')}`); // ftyp for MP4 usually at index 4

        const isMP4 = buffer.toString('ascii', 4, 8) === 'ftyp' || buffer.toString('hex').startsWith('000000'); // ftyp is standard
        log(`Is Payload MP4? ${isMP4 ? 'YES' : 'NO'}`);

        if (!isMP4) {
            const content = await fs.readFile(OUTPUT_FILE, 'utf8');
            log(`File Content Preview (First 200 chars): ${content.substring(0, 200)}`);
        }

    } catch (e: any) {
        log(`Test Failed: ${e.message}`);
    } finally {
        await browser.close();
    }
}

testDownload();
