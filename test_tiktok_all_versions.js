
const { Downloader } = require('@tobyg74/tiktok-api-dl');

async function testLibrary() {
    // Zach King - Harry Potter Illusion
    const url = 'https://www.tiktok.com/@zachking/video/6768504823336209670';
    console.log(`Testing URL: ${url}`);

    const versions = ['v1', 'v2', 'v3'];

    for (const version of versions) {
        console.log(`\n\n=== Testing Version: ${version} ===`);
        try {
            // @ts-ignore
            const result = await Downloader(url, { version });
            console.log(`Status: ${result.status}`);

            if (result.status === 'success') {
                console.log('Result Keys:', Object.keys(result.result || {}));
                console.log('Result:', JSON.stringify(result.result, null, 2));

                // Check for description fields
                if (version === 'v1') {
                    console.log('v1 description:', result.result.description);
                    console.log('v1 desc:', result.result.desc);
                } else if (version === 'v2') {
                    // SSSTikResponse
                    console.log('v2 desc:', result.result.desc);
                } else if (version === 'v3') {
                    // MusicalDownResponse
                    console.log('v3 desc:', result.result.desc);
                }
            } else {
                console.log('Failed or Error Response:', JSON.stringify(result, null, 2));
            }
        } catch (error) {
            console.error(`Error testing ${version}:`, error.message);
        }
    }
}

testLibrary();
