const { videoEditEngine } = require('../services/video-edit/VideoEditEngine');
const path = require('path');
const fs = require('fs-extra');

async function verifyEffects() {
    const inputPath = path.join(__dirname, 'test_assets', 'sample.mp4'); // Assume a sample exists or mock it
    const outputDir = path.join(__dirname, 'test_output');
    await fs.ensureDir(outputDir);

    const testCases = [
        {
            name: 'Mirroring',
            pipeline: { effects: [{ effectId: 'mirror', params: { active: 'true' } }] }
        },
        {
            name: 'ColorAdjustment',
            pipeline: { effects: [{ effectId: 'color_adjust', params: { brightness: 0.1, contrast: 1.2, saturation: 1.5 } }] }
        },
        {
            name: 'SpeedAdjust',
            pipeline: { effects: [{ effectId: 'speed_adjust', params: { multiplier: 1.1 } }] }
        },
        {
            name: 'SubtleZoom',
            pipeline: { effects: [{ effectId: 'subtle_zoom', params: { level: 5 } }] }
        },
        {
            name: 'ComboUniqueness',
            pipeline: {
                effects: [
                    { effectId: 'mirror', params: { active: 'true' } },
                    { effectId: 'color_adjust', params: { brightness: 0.05, contrast: 1.1 } },
                    { effectId: 'speed_adjust', params: { multiplier: 1.02 } }
                ]
            }
        }
    ];

    console.log('--- Phase 7 Verification: AI Video Effects ---');

    for (const test of testCases) {
        console.log(`\nTesting: ${test.name}`);
        const outputPath = path.join(outputDir, `output_${test.name}.mp4`);

        try {
            // Check if input exists, if not, create a dummy 2s video if ffmpeg available
            if (!fs.existsSync(inputPath)) {
                console.log('Sample video not found. This verification requires a real .mp4 file at src/main/scripts/test_assets/sample.mp4');
                console.log('Skipping actual render, but validating pipeline exists...');
                const validation = videoEditEngine.validatePipeline(test.pipeline);
                if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
                console.log('✅ Pipeline validated successfully.');
                continue;
            }

            const resultPath = await videoEditEngine.render(inputPath, test.pipeline, outputPath);
            if (fs.existsSync(resultPath)) {
                const stats = fs.statSync(resultPath);
                console.log(`✅ Success! Rendered to: ${resultPath} (${(stats.size / 1024).toFixed(2)} KB)`);
            } else {
                throw new Error('Result file not found after render');
            }
        } catch (e) {
            console.error(`❌ Failed ${test.name}:`, e.message);
        }
    }
}

verifyEffects().catch(console.error);
