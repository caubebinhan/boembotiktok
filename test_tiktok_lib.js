
const { Downloader } = require('@tobyg74/tiktok-api-dl');

async function testLibrary() {
    // Zach King - Harry Potter Illusion (likely to exist)
    const url = 'https://www.tiktok.com/@zachking/video/6768504823336209670';
    console.log(`Testing URL: ${url}`);

    try {
        const result = await Downloader(url, { version: 'v1' });
        console.log('Library Result Status:', result.status);

        if (result.status === 'success' && result.result) {
            console.log('--- Result Keys ---');
            console.log(Object.keys(result.result));

            console.log('\n--- Property Check ---');
            console.log('result.result.description:', result.result.description);
            console.log('result.result.desc:', result.result.desc);

            if (result.result.desc !== undefined && result.result.description === undefined) {
                console.log('\n!!! VERIFICATION SUCCESSFUL: `desc` is present, `description` is missing. !!!');
            } else {
                console.log('\nVERIFICATION FAILED OR AMBIGUOUS.');
                console.log('Full Result:', JSON.stringify(result.result, null, 2));
            }
        } else {
            console.log('Library failed to retrieve video.');
            console.log('Full Output:', JSON.stringify(result, null, 2));
        }

    } catch (error) {
        console.error('Execution Error:', error);
    }
}

testLibrary();
