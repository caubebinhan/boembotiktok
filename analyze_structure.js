const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\linhlinh\\AppData\\Roaming\\boembo\\debug_artifacts\\error_1771394910940.html';
const content = fs.readFileSync(filePath, 'utf8');

const target = 'Violation reason';
const index = content.indexOf(target);

if (index !== -1) {
    const start = Math.max(0, index - 1000);
    const end = Math.min(content.length, index + 200);
    console.log('--- Context around "Violation reason" ---');
    console.log(content.substring(start, end));
} else {
    console.log('Target not found');
}
