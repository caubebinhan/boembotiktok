const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\linhlinh\\AppData\\Roaming\\boembo\\debug_artifacts\\error_1771394910940.html', 'utf8');

const regex = /class="([^"]*(?:modal|dialog)[^"]*)"/gi;
const matches = [...content.matchAll(regex)];

console.log(`Found ${matches.length} classes with 'modal' or 'dialog':`);
matches.slice(0, 50).forEach(m => console.log(m[1]));
