import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import path from 'path';

test('Full Campaign Creation & Execution Flow', async () => {
    console.log('Launching Electron...');
    const electronApp = await electron.launch({
        args: [path.join(__dirname, '../out/main/index.js')],
    });

    console.log('Electron launched, waiting for first window...');
    const window = await electronApp.firstWindow();
    console.log('First window detected:', !!window);

    if (window) {
        // The original 'window' variable is already defined and valid here.
        // No need to re-declare or call firstWindow() again.
        console.log('Main window opened');
        window.on('console', msg => console.log('RENDERER:', msg.text()));
        window.on('pageerror', err => console.log('RENDERER ERROR:', err.message));

        const title = await window.title();
        console.log('Window title:', title);
    }

    await window.waitForLoadState('networkidle');
    console.log('App loaded');

    // Ensure screenshots directory exists
    const fs = require('fs');
    if (!fs.existsSync('tests/screenshots')) {
        fs.mkdirSync('tests/screenshots', { recursive: true });
    }

    // Seed DB with mock account
    await electronApp.evaluate(async ({ BrowserWindow, ipcMain }) => {
        // We can't access main process services directly here easily unless we use the IPC handler we just added.
        // But wait, evaluate runs in the main process context.
        // We can assume the IPC handler is registered.
        // Actually, we can just INVOKE the IPC from the renderer window!
        const window = BrowserWindow.getAllWindows()[0];
        // We'll do it via renderer to be safe/easy, or just trust the app setup.
    });
    // Better: use window.api.invoke if available, OR just use the main process evaluate to direct call?
    // We added an IPC handle 'test:seed-account'.
    // We can call it from the renderer page!

    // Take initial screenshot
    await window.screenshot({ path: 'tests/screenshots/0-initial.png' });

    // Seed Account via Renderer IPC
    await window.evaluate(async () => {
        // @ts-ignore
        await window.api.invoke('test:seed-account');
    });
    console.log('DB Seeded with mock account');

    // Step 1: Create Campaign
    console.log('Clicking New Campaign...');
    await window.click('button:has-text("New Campaign")');

    await expect(window.locator('text="Step 1: Campaign Details & Schedule"')).toBeVisible({ timeout: 15000 });
    console.log('Wizard Step 1 visible');
    await window.screenshot({ path: 'tests/screenshots/1-wizard-step1.png' });

    const campaignName = `Test Campaign ${Date.now()}`;
    const campaignInput = window.locator('input[placeholder="e.g. Morning Motivation"]');
    await campaignInput.fill(campaignName);
    console.log(`Filled campaign name: ${campaignName}`);
    // Select "Scheduled"
    console.log('Selecting Scheduled mode...');
    await window.click('text="Scheduled (Recurring)"');
    // Wait for it to be selected (visual check or internal state check)
    // We can't easily check internal state without evaluate, but we can trust the click for now.
    console.log('Scheduled mode selected.');

    // Choose Wednesday (Purple when selected)
    // The days are buttons in Step 1
    console.log('Selecting Wednesday...');
    await window.click('button:has-text("Wed")');
    console.log('Wednesday selected.');

    await window.click('button:has-text("Next")');
    console.log('Clicked Next from Step 1');

    // Step 2: Add Sources
    await expect(window.locator('text="Step 2: Content Sources"')).toBeVisible({ timeout: 15000 });
    console.log('Wizard Step 2 visible');
    await window.screenshot({ path: 'tests/screenshots/2-wizard-step2.png' });

    // Correctly send IPC from Main process to Renderer
    await electronApp.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.send('scanner-results-received', {
            channels: [{ name: 'test_channel', avatar: '' }],
            videos: [
                { id: 'vid1', url: 'https://tiktok.com/vid1', thumbnail: '', description: 'Test Video 1', selected: true }
            ]
        });
    });
    console.log('Mocked scanner results sent via Main process');

    await expect(window.locator('text="@test_channel"')).toBeVisible({ timeout: 5000 });
    await window.click('button:has-text("Next")');
    console.log('Clicked Next from Step 2');
    await window.waitForTimeout(1000);
    await window.screenshot({ path: 'tests/screenshots/2.5-after-step2-next.png' });

    // Step 3: Preview Schedule (This is step 3 in the state, but label might vary)
    // Check for the component's unique text
    await expect(window.locator('text="Step 3: Preview Schedule"')).toBeVisible({ timeout: 15000 });
    console.log('Wizard Step 3 (Preview) visible');
    await window.screenshot({ path: 'tests/screenshots/3-wizard-step3.png' });
    console.log('Attempting to click Next on Step 3 (Primary Button)');
    // Use .btn-primary to distinguish from pagination Next button in SchedulePreview
    await window.click('button.btn-primary:has-text("Next")');
    console.log('Clicked Next on Step 3');

    await window.waitForTimeout(2000);
    await window.screenshot({ path: 'tests/screenshots/3.5-after-step3-next.png' });

    // Step 4: Editor
    // Use h3 selector to be specific and avoid timeout issues
    await expect(window.locator('h3:has-text("Video Editor")')).toBeVisible({ timeout: 20000 });
    console.log('Wizard Step 4 (Editor) visible');
    await window.screenshot({ path: 'tests/screenshots/4-wizard-step4.png' });
    await window.click('button:has-text("Next")');

    // Step 5: Target
    await expect(window.locator('text="Step 4: Publish Target"')).toBeVisible({ timeout: 15000 });
    console.log('Wizard Step 5 (Target) visible');
    await window.screenshot({ path: 'tests/screenshots/5-wizard-step5.png' });

    // Select the seeded account
    await window.click('text="Test User"');
    console.log('Selected Test User account');

    await window.click('button:has-text("Save & Close")');
    console.log('Clicked Save & Close');

    try {
        // Wait for Wizard to close
        console.log('Waiting for wizard to close...');
        await expect(window.locator('text="Step 4: Publish Target"')).toBeHidden({ timeout: 10000 });

        // Verify Execution
        // Use standard locator for H1 or general text
        await expect(window.locator('h1:has-text("Campaigns")')).toBeVisible({ timeout: 15000 });
        console.log('Campaign List visible');
        await window.screenshot({ path: 'tests/screenshots/6-campaign-list.png' });

        await expect(window.locator(`text="${campaignName}"`)).toBeVisible({ timeout: 15000 });
        console.log('Campaign verified in list');
        await window.screenshot({ path: 'tests/screenshots/7-final-success.png' });
    } catch (error) {
        console.error('Verification Failed:', error);
        await window.screenshot({ path: 'tests/screenshots/failure-final.png' });
        throw error;
    }

    await electronApp.close();
});
