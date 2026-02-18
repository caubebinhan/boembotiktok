
import { TikTokModule } from './src/main/modules/tiktok/TikTokModule';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs-extra';

// Mock electron app.getPath
if (!app) {
    (global as any).app = {
        getPath: (name: string) => path.join(process.cwd(), 'test_user_data')
    };
}

async function runTest() {
    const tiktok = new TikTokModule();
    const videoUrl = 'https://www.tiktok.com/@vtv24news/video/7607453754027216149'; // The video from user log
    const platformId = '7607453754027216149';

    console.log('--- TEST START ---');
    console.log(`Scanning/Downloading: ${videoUrl}`);

    try {
        const result = await tiktok.downloadVideo(videoUrl, platformId);

        console.log('--- RESULT ---');
        console.log('Cached:', result.cached);
        console.log('File Path:', result.filePath);
        console.log('Meta:', JSON.stringify(result.meta, null, 2));

        if (!result.meta || !result.meta.description) {
            console.error('❌ FAILURE: Description is missing!');
        } else {
            console.log('✅ SUCCESS: Description extracted:', result.meta.description);
        }

    } catch (error) {
        console.error('❌ ERROR:', error);
    }
}

runTest();
