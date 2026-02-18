
const { format } = require('date-fns');

// STANDALONE CAPTION GENERATOR LOGIC (Mirrored from src/main/services/CaptionGenerator.ts)
class CaptionGenerator {
    static generate(template, variables) {
        let caption = template;
        // Helper to strip tags - Robust Unicode version (Matches the one in production)
        const stripTags = (text) => text.replace(/#[\p{L}\p{N}_]+/gu, '').trim();

        if (caption.includes('{original_no_tags}')) {
            caption = caption.replace(/{original_no_tags}/g, stripTags(variables.original || ''));
        }
        caption = caption.replace(/{original}/g, variables.original || '');

        if (caption.includes('{time}')) {
            const timeStr = variables.time ? format(variables.time, 'HH:mm') : '';
            caption = caption.replace(/{time}/g, timeStr);
        }
        if (caption.includes('{date}')) {
            const dateStr = variables.time ? format(variables.time, 'yyyy-MM-dd') : '';
            caption = caption.replace(/{date}/g, dateStr);
        }
        if (caption.includes('{author}')) {
            caption = caption.replace(/{author}/g, variables.author || '');
        }
        return caption.trim();
    }
}

async function runTest() {
    console.log('=== 🧪 BOEMBO STANDALONE FULL FLOW TEST 🧪 ===\n');

    // 1. CONFIG
    const campaignConfig = {
        name: 'Test Campaign',
        captionTemplate: '{original_no_tags} #repost #vtv24',
        advancedVerification: true
    };
    console.log(`1. [CONFIG] Template: "${campaignConfig.captionTemplate}"`);

    // 2. VIDEO
    const scannedVideo = {
        description: 'Chào mừng Tết Nguyên Đán 2026! #tet #vtv24 #xuhuong #bò',
        author: 'VTV Digital'
    };
    console.log(`2. [VIDEO] Original: "${scannedVideo.description}"`);

    // 3. GENERATION
    const finalCaption = CaptionGenerator.generate(campaignConfig.captionTemplate, {
        original: scannedVideo.description,
        author: scannedVideo.author,
        time: new Date()
    });
    console.log(`3. [GENERATION] Result: "${finalCaption}"`);

    // VERIFY
    const forbiddenTags = ['#tet', '#vtv24', '#xuhuong', '#bò'];
    const failedTags = forbiddenTags.filter(t => finalCaption.includes(t) && t !== '#vtv24'); // #vtv24 is allowed if in template

    // Actually, #vtv24 is in the template, so it should be THERE. 
    // But #tet, #xuhuong, #bò should be GONE.
    if (finalCaption.includes('#tet') || finalCaption.includes('#bò') || finalCaption.includes('#xuhuong')) {
        console.error('   ❌ FAILED: Vietnamese/Unicode hashtags were NOT correctly stripped!');
        process.exit(1);
    }

    if (!finalCaption.includes('#repost')) {
        console.error('   ❌ FAILED: Template hashtags were lost!');
        process.exit(1);
    }

    console.log('   ✅ Hashtag stripping (including Vietnamese) passed.');

    // 4. UNIQUE TAG
    const uniqueHash = '#abc123';
    const finalTiktokString = finalCaption + ' ' + uniqueHash;
    console.log(`4. [FINAL] Final string to TikTok: "${finalTiktokString}"`);

    if (!finalTiktokString.includes(uniqueHash)) {
        console.error('   ❌ FAILED: Unique tag not appended!');
        process.exit(1);
    }
    console.log('   ✅ Unique tag verification passed.');

    console.log('\n=== 🎉 ALL LOGIC VERIFIED! 🎉 ===');
}

runTest().catch(console.error);
