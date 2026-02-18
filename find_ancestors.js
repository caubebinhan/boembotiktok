const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\linhlinh\\AppData\\Roaming\\boembo\\debug_artifacts\\error_1771394910940.html';

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const target = 'Violation reason';
    const index = content.indexOf(target);

    if (index !== -1) {
        // Look backwards for "role="dialog"" or "data-e2e" or "class"
        const preceding = content.substring(Math.max(0, index - 3000), index);

        console.log(`Searching in ${preceding.length} chars before "${target}"...`);

        // Find matches with indices relative to the end of 'preceding'
        const regexes = [
            /role=["']dialog["']/g,
            /data-e2e=["'][^"']*["']/g,
            /class=["'][^"']*modal[^"']*["']/g
        ];

        regexes.forEach(re => {
            const matches = [...preceding.matchAll(re)];
            if (matches.length > 0) {
                console.log(`\nMatch for ${re}:`);
                // Show the last 3 matches
                matches.slice(-3).forEach(m => {
                    console.log(`  Found: ${m[0]} at distance ${preceding.length - m.index}`);
                    // Show context around it
                    const start = Math.max(0, m.index - 50);
                    const end = Math.min(preceding.length, m.index + 100);
                    console.log(`    Context: ...${preceding.substring(start, end)}...`);
                });
            }
        });

    } else {
        console.log(`Target "${target}" not found.`);
    }
} catch (e) {
    console.error(e);
}
