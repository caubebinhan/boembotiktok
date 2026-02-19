const fs = require('fs');
const path = require('path');

const dumpPath = String.raw`C:\Users\linhlinh\AppData\Roaming\boembo\scan_dump_vtv24news_1771492052385.html`;
const outPath = path.join(__dirname, 'dump_analysis.txt');

try {
    const content = fs.readFileSync(dumpPath, 'utf8');
    let output = `File size: ${content.length} bytes\n`;

    // Check key strings
    const hrefCount = (content.match(/href=/g) || []).length;
    output += `'href=' count: ${hrefCount}\n`;

    const videoLinkCount = (content.match(/\/video\/\d+/g) || []).length;
    output += `'/video/...' link count: ${videoLinkCount}\n`;

    const userPostItemCount = (content.match(/data-e2e="user-post-item"/g) || []).length;
    output += `'data-e2e="user-post-item"' count: ${userPostItemCount}\n`;

    const divItemContainerCount = (content.match(/DivItemContainer/g) || []).length;
    output += `'DivItemContainer' count: ${divItemContainerCount}\n`;

    const captchaCount = (content.match(/captcha/gi) || []).length;
    output += `'captcha' count: ${captchaCount}\n`;

    const verifyCount = (content.match(/verify/gi) || []).length;
    output += `'verify' count: ${verifyCount}\n`;

    const loginCount = (content.match(/login/gi) || []).length;
    output += `'login' count: ${loginCount}\n`;

    // Extract text content (rough approximation)
    const textContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000);
    output += `\nText Content Snippet:\n${textContent}\n`;

    fs.writeFileSync(outPath, output);
    console.log(`Analysis written to ${outPath}`);

} catch (err) {
    console.error('Error reading file:', err);
}
