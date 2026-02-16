import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Systematic Scheduler Logic Test', () => {
    let electronApp: ElectronApplication;
    let mainWindow: Page;

    test.beforeAll(async () => {
        console.log('Launching Electron...');
        electronApp = await electron.launch({
            args: ['.'],
            env: { ...process.env, NODE_ENV: 'test' },
            timeout: 30000
        });
        console.log('Waiting for first window...');
        mainWindow = await electronApp.firstWindow();
        await mainWindow.waitForLoadState();
        console.log('Window loaded.');
    });

    test('Scheduler should STRICTLY respect Future Start Times', async () => {
        // 1. Setup Data - Create a Future Campaign
        const futureTime = new Date(Date.now() + 10 * 60000).toISOString(); // 10 mins in future
        console.log(`Creating Future Campaign scheduled for: ${futureTime}`);

        // We use evaluate to insert directly into DB via main process (bypassing UI for speed/precision)
        const campaignId = await mainWindow.evaluate(async (futureTime) => {
            // @ts-ignore
            const result = await window.api.invoke('create-campaign',
                'Future Campaign Test',
                'scheduled',
                '*/10 * * * *',
                {
                    sources: { keywords: [{ keyword: 'test', maxScanCount: 1 }] },
                    schedule: {
                        interval: 10,
                        runAt: futureTime,
                        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                    }
                }
            );
            return result.lastInsertId;
        }, futureTime);

        console.log(`Campaign Created with ID: ${campaignId}`);

        // 2. Trigger Scheduler manually
        console.log('Triggering Scheduler Check...');
        // @ts-ignore
        await mainWindow.evaluate(() => window.api.invoke('test:run-scheduler'));

        // 3. Verify NO Jobs created for this campaign
        const jobs = await mainWindow.evaluate(async (id) => {
            // @ts-ignore
            return await window.api.invoke('get-campaign-jobs', id);
        }, campaignId);

        console.log(`Jobs found (should be 0): ${jobs.length}`);
        expect(jobs.length).toBe(0);

        // 4. Update Campaign to be "Now" (or slightly past)
        const pastTime = new Date(Date.now() - 1 * 60000).toISOString(); // 1 min ago
        console.log(`Updating Campaign to run at: ${pastTime}`);

        await mainWindow.evaluate(async ({ id, time }) => {
            // @ts-ignore
            await window.api.invoke('update-campaign-config', id, {
                sources: { keywords: [{ keyword: 'test', maxScanCount: 1 }] },
                schedule: {
                    interval: 10,
                    runAt: time,
                    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                }
            })
        }, { id: campaignId, time: pastTime });

        // 5. Trigger Scheduler again
        console.log('Triggering Scheduler Check (2nd time)...');
        // @ts-ignore
        await mainWindow.evaluate(() => window.api.invoke('test:run-scheduler'));

        // 6. Verify Job IS created
        const jobsAfter = await mainWindow.evaluate(async (id) => {
            // @ts-ignore
            return await window.api.invoke('get-campaign-jobs', id);
        }, campaignId);

        console.log(`Jobs found (should be > 0): ${jobsAfter.length}`);
        expect(jobsAfter.length).toBeGreaterThan(0);
        expect(jobsAfter[0].status).toBe('pending');
    });

    test.afterAll(async () => {
        if (electronApp) await electronApp.close();
    });
});
