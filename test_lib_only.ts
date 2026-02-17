
/* @ts-ignore */
const { Downloader } = require('@tobyg74/tiktok-api-dl');

async function testLib() {
    const url = 'https://www.tiktok.com/@bts_official_bighit/video/7565127603405835528';
    console.log(`Testing Library with URL: ${url}`);

    try {
        const result = await Downloader(url, { version: 'v1' });
        console.log('Result Status:', result.status);
        console.log('Result Full:', JSON.stringify(result, null, 2));
    } catch (error: any) {
        console.error('Library Error:', error.message);
    }
}

testLib();
