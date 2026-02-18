const fs = require('fs');
const path = require('path');

const files = [
    'C:\\Users\\linhlinh\\AppData\\Roaming\\boembo\\debug_artifacts\\error_1771394910940.html'
];

const keywords = [
    'Post', 'Upload', 'Error', 'Lỗi',
    'modal', 'dialog',
    'Violation', 'Restricted', 'Unoriginal', 'Low-quality', 'QR code', 'Ineligible'
];

let output = '';
const log = (msg) => {
    console.log(msg);
    output += msg + '\n';
};

files.forEach(f => {
    log(`\n--- Analyzing: ${path.basename(f)} ---`);
    if (!fs.existsSync(f)) {
        log('File not found');
        return;
    }
    const content = fs.readFileSync(f, 'utf8');

    // Check title
    const titleMatch = content.match(/<title>(.*?)<\/title>/);
    log('Title: ' + (titleMatch ? titleMatch[1] : 'No title'));

    // Check keywords
    keywords.forEach(k => {
        // Simple check
        const regex = new RegExp(k, 'gi');
        const matches = [...content.matchAll(regex)];
        if (matches.length > 0) {
            log(`Found "${k}" (${matches.length} times)`);
            // Print context (up to 3 matches)
            for (let i = 0; i < Math.min(3, matches.length); i++) {
                const match = matches[i];
                const idx = match.index;
                // Get 100 chars around
                const start = Math.max(0, idx - 50);
                const end = Math.min(content.length, idx + 50 + k.length);
                const snippet = content.substring(start, end).replace(/\s+/g, ' ');
                log(`   Context: ...${snippet}...`);
            }
        }
    });
});

fs.writeFileSync('analysis_result.txt', output);
