const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio'); // Assuming cheerio might not be available, I will use regex/string parsing for safety or try to require it if available in the env. 
// Actually, standard node env usually doesn't have cheerio. I'll use a robust string searching method or just regex.

// Let's stick to string parsing for the specific dump file.
const filePath = 'C:\\Users\\linhlinh\\AppData\\Roaming\\boembo\\debug_artifacts\\error_1771394910940.html';
const content = fs.readFileSync(filePath, 'utf8');

const target = 'Violation reason';
const index = content.indexOf(target);

if (index !== -1) {
    console.log(`Target found at ${index}. traversing backwards...`);

    // We will look at the preceding 2000 characters and try to reconstruct the nesting based on known tags.
    const chunk = content.substring(Math.max(0, index - 3000), index + 100);

    // Find all <div> tags opening
    const divRegex = /<div([^>]*)>/g;
    let match;
    const divs = [];
    while ((match = divRegex.exec(chunk)) !== null) {
        divs.push({
            full: match[0],
            attrs: match[1],
            index: match.index
        });
    }

    // Filter for divs that look like modals or important containers
    console.log("--- Potential Parent Containers ---");
    divs.reverse().slice(0, 20).forEach(d => {
        if (d.attrs.includes('class') || d.attrs.includes('id') || d.attrs.includes('role')) {
            console.log(`[Dist: ${chunk.length - d.index}] ${d.full}`);
        }
    });

} else {
    console.log("Target not found");
}
