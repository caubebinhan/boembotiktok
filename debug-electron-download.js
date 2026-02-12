const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');
const path = require('path');
const fs = require('fs');

(async () => {
    try {
        console.log('Downloading Electron v31.0.0...');
        const zipPath = await downloadArtifact({
            version: '31.0.0',
            artifactName: 'electron',
            force: true,
            platform: 'win32',
            arch: 'x64'
        });
        console.log('Downloaded to:', zipPath);

        const stats = fs.statSync(zipPath);
        console.log('Zip size:', stats.size);

        const targetDir = path.join(__dirname, 'electron-test-dist');
        if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(targetDir);

        console.log('Extracting to:', targetDir);
        await extract(zipPath, { dir: targetDir });
        console.log('Extraction complete.');

        const asarPath = path.join(targetDir, 'resources', 'electron.asar');
        if (fs.existsSync(asarPath)) {
            console.log('SUCCESS: electron.asar exists!');
        } else {
            console.log('FAILURE: electron.asar MISSING in extracted folder!');
            // List resources
            console.log('Resources content:', fs.readdirSync(path.join(targetDir, 'resources')));
        }
    } catch (e) {
        console.error('Error:', e);
    }
})();
