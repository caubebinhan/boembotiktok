import pkg from '@tobyg74/tiktok-api-dl';
const { Downloader } = pkg;

if (!Downloader) {
    console.error('Downloader function still not found in pkg:', Object.keys(pkg));
    process.exit(1);
}

(async () => {
    const url = 'https://www.tiktok.com/@bellapoarch/video/6862153058223197445';
    console.log('Testing Downloader with:', url);
    try {
        const result = await Downloader(url, { version: 'v1' });
        console.log('Result:', JSON.stringify(result, null, 2));

        if (result.status === 'success') {
            // Log video structure
            console.log('Video Info:', result.result?.video || result.result);
        }
    } catch (e) {
        console.error('Error:', e);
    }
})();
