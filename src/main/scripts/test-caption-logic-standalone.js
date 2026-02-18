
// Mocking the logic directly since we can't easily require TS files in raw Node without setup
console.log('--- TEST START: Caption Logic (Standalone) ---');

const format = (date, fmt) => 'HH:mm'; // Mock format

class CaptionGenerator {
    static generate(template, variables) {
        console.log(`[CaptionGenerator] Input Template: "${template}"`)
        console.log(`[CaptionGenerator] Input Variables:`, JSON.stringify({ ...variables, original: variables.original?.substring(0, 50) + '...' }))

        let caption = template

        // Helper to strip tags - Robust Unicode version
        // Matches # followed by letters, numbers, or underscores (Unicode aware)
        const stripTags = (text) => {
            // JS Regex for Unicode properties requires 'u' flag
            const stripped = text.replace(/#[\p{L}\p{N}_]+/gu, '').trim()
            console.log(`[CaptionGenerator] StripTags: "${text.substring(0, 30)}..." -> "${stripped.substring(0, 30)}..."`)
            return stripped
        }

        if (caption.includes('{original_no_tags}')) {
            console.log(`[CaptionGenerator] Replacing {original_no_tags}`)
            caption = caption.replace(/{original_no_tags}/g, stripTags(variables.original || ''))
        }

        // Replace {original}
        if (caption.includes('{original}')) {
            console.log(`[CaptionGenerator] Replacing {original}`)
            caption = caption.replace(/{original}/g, variables.original || '')
        }

        // Replace {time} (default to short format)
        if (caption.includes('{time}')) {
            // const timeStr = variables.time ? format(variables.time, 'HH:mm') : ''
            const timeStr = '12:00'
            caption = caption.replace(/{time}/g, timeStr)
        }

        // Replace {date}
        if (caption.includes('{date}')) {
            // const dateStr = variables.time ? format(variables.time, 'yyyy-MM-dd') : ''
            const dateStr = '2024-01-01'
            caption = caption.replace(/{date}/g, dateStr)
        }

        // Replace {author}
        if (caption.includes('{author}')) {
            caption = caption.replace(/{author}/g, variables.author || '')
        }

        // Replace {tags} (append tags)
        if (caption.includes('{tags}')) {
            const tagsStr = variables.tags ? variables.tags.map(t => `#${t}`).join(' ') : ''
            caption = caption.replace(/{tags}/g, tagsStr)
        }

        const final = caption.trim()
        console.log(`[CaptionGenerator] Output: "${final}"`)
        return final
    }
}

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

        // Normalize spaces for comparison
        const normResult = result.replace(/\s+/g, ' ').trim();
        const normExpected = test.expected.replace(/\s+/g, ' ').trim();

        if (normResult !== normExpected) {
            console.error(`❌ FAILED`);
            console.error(`   Expected: "${test.expected}"`);
            console.error(`   Got:      "${result}"`);
            failed++;
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
