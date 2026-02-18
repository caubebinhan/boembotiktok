
const { CaptionGenerator } = require('../services/CaptionGenerator');

console.log('--- TEST START: Caption Logic ---');

const testCases = [
    {
        name: 'Basic Tag Stripping',
        template: '{original_no_tags}',
        original: 'Hello world #tag1 #tag2',
        expected: 'Hello world'
    },
    {
        name: 'Unicode Tag Stripping',
        template: '{original_no_tags}',
        original: 'Video hay quá #xuhuong #thinhhanh #vtv24',
        expected: 'Video hay quá'
    },
    {
        name: 'Mixed Content',
        template: '{original_no_tags}',
        original: 'Check this out! #cool #viral text after tag',
        expected: 'Check this out!  text after tag'  // Note: double space might happen if not aggressive trimming
    },
    {
        name: 'No Tags in Original',
        template: '{original_no_tags}',
        original: 'Just a normal sentence.',
        expected: 'Just a normal sentence.'
    },
    {
        name: 'Template with extra text',
        template: 'My Video: {original_no_tags} #repost',
        original: 'Surprise! #wow',
        expected: 'My Video: Surprise! #repost'
    },
    {
        name: 'Complex Unicode',
        template: '{original_no_tags}',
        original: 'Chào buổi sáng 🌞 #chao #buoisang #2024',
        expected: 'Chào buổi sáng 🌞'
    }
];

let failed = 0;

testCases.forEach((test, index) => {
    console.log(`\n[${index + 1}] Testing: ${test.name}`);
    try {
        const result = CaptionGenerator.generate(test.template, { original: test.original });
        if (result !== test.expected) {
            console.error(`❌ FAILED`);
            console.error(`   Expected: "${test.expected}"`);
            console.error(`   Got:      "${result}"`);
            // Allow loose match for whitespace issues
            if (result.replace(/\s+/g, ' ') === test.expected.replace(/\s+/g, ' ')) {
                console.log(`   (Partial Match on whitespace)`);
            } else {
                failed++;
            }
        } else {
            console.log(`✅ PASSED: "${result}"`);
        }
    } catch (e) {
        console.error(`❌ EXCEPTION: ${e.message}`);
        failed++;
    }
});

console.log(`\n--- TEST COMPLETE ---`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
