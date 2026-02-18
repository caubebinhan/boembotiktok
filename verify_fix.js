
const { Downloader } = require('@tobyg74/tiktok-api-dl');

async function verifyFix() {
    // Zach King - Harry Potter Illusion
    const url = 'https://www.tiktok.com/@zachking/video/6768504823336209670';
    console.log(`Verifying Fix with URL: ${url}`);

    try {
        const result = await Downloader(url, { version: 'v1' });
        console.log('Result Status:', result.status);

        if (result.status === 'success' && result.result) {
            console.log('--- Property Verification ---');
            console.log('result.result.description:', result.result.description);
            console.log('result.result.desc:', result.result.desc);

            if (result.result.desc && !result.result.description) {
                console.log('\nSUCCESS: `desc` contains the caption. The fix in TikTokModule.ts is CORRECT.');
            } else if (result.result.description) {
                console.log('\nWARNING: `description` exists. The fix might be redundant but `desc` should still work if aliased.');
            } else {
                console.log('\nFAILURE: Caption not found in either property.');
            }
        } else {
            console.log('Library check failed (network/captcha issue likely). Cannot verify fix dynamically.');
        }

    } catch (error) {
        console.error('Verification Error:', error);
    }
}

verifyFix();
