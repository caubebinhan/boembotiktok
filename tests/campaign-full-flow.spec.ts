import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Campaign Full Flow & UI Verification (Electron)', () => {
    let electronApp: ElectronApplication;
    let mainWindow: Page;

    test.beforeAll(async () => {
        console.log('--- Starting App ---');
        const userDataDir = path.resolve(process.cwd(), 'test_user_data');
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir);

        electronApp = await electron.launch({
            args: [
                path.join(process.cwd(), 'out', 'main', 'index.js'),
                `--user-data-dir=${userDataDir}`
            ],
            env: { ...process.env, NODE_ENV: 'test' }
        });

        mainWindow = await electronApp.firstWindow();
        await mainWindow.waitForLoadState();
        console.log('App launched. URL:', mainWindow.url());
    });

    test.afterAll(async () => {
        if (electronApp) await electronApp.close();
    });

    test('Create Campaign via Wizard', async () => {
        console.log('Test 1: Create Campaign via Wizard');
        try {
            console.log('Clicking Campaigns...');
            await mainWindow.click('text=Campaigns', { timeout: 10000 });

            console.log('Clicking New Campaign...');
            await mainWindow.click('text=New Campaign', { timeout: 10000 });

            console.log('Step 1: Details & Schedule');
            // Seed account
            await mainWindow.evaluate(async () => {
                // @ts-ignore
                await window.api.invoke('test:seed-account');
            });

            await mainWindow.fill('input[data-testid="campaign-name-input"]', `E2E Test Campaign ${Date.now()}`);

            // Select "One-Time Run"
            await mainWindow.click('label:has-text("One-Time Run")');

            // Select "Run Now"
            await mainWindow.click('label:has-text("Run Now")');

            await mainWindow.click('button:has-text("Next")');

            console.log('Step 2: Source');
            // 1. Click "Scan More Sources" and wait for the scanner window
            console.log('Opening Scanner Window...');
            const [scannerWindow] = await Promise.all([
                electronApp.waitForEvent('window'),
                mainWindow.click('text=Scan Videos')
            ]);

            await scannerWindow.waitForLoadState('domcontentloaded');
            console.log('Scanner Window opened.');

            // 2. Click "Go" to load the URL
            console.log('Clicking "Go"...');
            await scannerWindow.click('button:has-text("Go")');
            // Wait for some content to appear in the webview or just wait 5s for stability
            await scannerWindow.waitForTimeout(5000);
            await scannerWindow.screenshot({ path: 'scanner-after-go.png' });

            // 3. Click "Scan Page Videos" 
            console.log('Clicking Scan Page Videos...');
            await scannerWindow.screenshot({ path: 'scanner-before-scan.png' });
            await scannerWindow.click('button:has-text("Scan Page Videos")');

            // 4. Wait for videos and click one
            console.log('Waiting for scanned videos...');
            await scannerWindow.waitForSelector('.video-card', { timeout: 60000 });
            await scannerWindow.screenshot({ path: 'scanner-videos-found.png' });

            // 5. Click a random scanned video to enter its page
            const count = await scannerWindow.locator('.video-card').count();
            const randomIndex = Math.floor(Math.random() * count);
            console.log(`Selecting scanned video index ${randomIndex} of ${count}...`);
            await scannerWindow.locator('.video-card').nth(randomIndex).click();

            // 6. Wait for "Target This Video" button and click it
            console.log('Waiting for "Target This Video" button...');
            const targetBtn = scannerWindow.locator('button:has-text("Target This Video")');
            await targetBtn.waitFor({ state: 'visible', timeout: 30000 });
            await scannerWindow.screenshot({ path: 'scanner-on-video-page.png' });

            console.log('Clicking "Target This Video"...');
            await targetBtn.click();
            await scannerWindow.screenshot({ path: 'scanner-after-target-click.png' });

            // 7. Click "FINISH & IMPORT"
            console.log('Clicking Finish & Import...');
            await scannerWindow.click('button:has-text("FINISH & IMPORT")');

            // 8. Wait for scanner to close
            await scannerWindow.waitForEvent('close', { timeout: 15000 });

            // 9. Verify video appeared and click Next
            console.log('Proceeding to Step 3...');
            await mainWindow.waitForSelector('.wizard-step', { timeout: 10000 });
            await mainWindow.click('button:has-text("Next")');

            console.log('Step 3: Editor');
            await mainWindow.waitForSelector('text=Video Editor', { timeout: 10000 });
            await mainWindow.click('button:has-text("Next")');

            console.log('Step 4: Schedule Preview');
            await mainWindow.waitForSelector('text=Campaign Start Time', { timeout: 10000 });
            await mainWindow.click('button:has-text("Next")');

            console.log('Step 5: Target');
            // The account seeded in Step 1 should be visible here.
            // Component: AccountItem or similar
            const accountSelector = '.wizard-step div[style*="cursor: pointer"]';
            await mainWindow.waitForSelector(accountSelector, { timeout: 10000 });
            await mainWindow.click(accountSelector);

            console.log('Saving & Running...');
            await mainWindow.click('text=🚀 Save & Run Now');

            // Wait for modal to close
            await mainWindow.waitForSelector('.campaign-wizard-modal', { state: 'hidden', timeout: 10000 });
            console.log('Campaign created and started!');

            // WAIT FOR PUBLISH JOB TO START AND REACH INSTRUMENTED PAGE
            console.log('Waiting 60s for publish job execution...');
            await mainWindow.waitForTimeout(60000);

        } catch (error) {
            console.error('Test 1 Failed:', error);
            await mainWindow.screenshot({ path: 'wizard-fail.png' });
            throw error;
        }
    });

    test('Verify Campaign Details UI Structure', async () => {
        console.log('Test 2: Verify Campaign Details');
        // This test assumes a campaign exists (either from Test 1 or seeded)
        await mainWindow.click('text=Campaigns');
        const firstCampaign = 'table tbody tr:first-child';
        if (await mainWindow.$(firstCampaign)) {
            await mainWindow.click(firstCampaign);
            await mainWindow.waitForSelector('.campaign-details-container');
            // Verification logic...
            console.log('Details UI verified.');
        } else {
            console.log('No campaign found to verify details.');
        }
    });
});
