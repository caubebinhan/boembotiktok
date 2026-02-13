
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

test.describe('Campaign Clone & Schedule Inputs', () => {
    let electronApp: any
    let window: any

    test.beforeAll(async () => {
        electronApp = await electron.launch({
            args: ['.'],
            env: { ...process.env, NODE_ENV: 'test' }
        })
        window = await electronApp.firstWindow()
        await window.waitForLoadState('domcontentloaded')
    })

    test.afterAll(async () => {
        await electronApp.close()
    })

    test('Verify Schedule Inputs (Interval & Time)', async () => {
        console.log('Test 1: Starting')
        // 1. Open Wizard
        const newBtn = window.locator('[data-testid="wizard-new-campaign-btn"]')
        await newBtn.waitFor({ state: 'visible', timeout: 10000 })
        await newBtn.click()
        console.log('Test 1: Clicked New Campaign')

        await window.waitForSelector('[data-testid="campaign-name-input"]')
        console.log('Test 1: Wizard Opened')

        // 2. Fill Name
        await window.fill('[data-testid="campaign-name-input"]', 'Test Schedule Inputs')

        // 3. Select Scheduled
        await window.click('[data-testid="type-scheduled"]')

        // 4. Verify Interval Input
        const intervalInput = window.locator('[data-testid="interval-input"]')
        await intervalInput.fill('') // Clear it
        // The validation (onBlur) defaults to 60 if empty or invalid < 1
        await intervalInput.blur()
        expect(await intervalInput.inputValue()).toBe('60')

        await intervalInput.fill('120') // Type 120
        expect(await intervalInput.inputValue()).toBe('120')

        // Clear and type 5
        await intervalInput.fill('5')
        expect(await intervalInput.inputValue()).toBe('5')

        // 5. Verify Time Input (Daily Start/End)
        const startTime = window.locator('[data-testid="start-time-input"]')
        await startTime.fill('08:30')
        expect(await startTime.inputValue()).toBe('08:30')

        const endTime = window.locator('[data-testid="end-time-input"]')
        await endTime.fill('22:45')
        expect(await endTime.inputValue()).toBe('22:45')

        // Close wizard
        await window.click('button:has-text("Close")')
    })

    test('Verify Clone Flow opens Wizard with Prefilled Data', async () => {
        // 1. Inject a campaign via IPC for speed
        await window.evaluate(async () => {
            // @ts-ignore
            await window.api.invoke('create-campaign', 'To Be Cloned', 'scheduled', '*/30 * * * *', {
                targetAccounts: [],
                schedule: { interval: 30, startTime: '10:00', endTime: '20:00', days: ['Mon'] }
                // validation_bypass not needed if we insert directly via backend, but here we use create-campaign which might validate.
                // However create-campaign doesn't strictly validate empty sources if we pass valid config object.
            })
            // @ts-ignore
            window.api.send('campaign-updated')
        })

        // Reload list
        await window.reload()
        // Wait for list to populate
        await window.waitForSelector('.campaign-item', { timeout: 10000 })

        // Find the campaign item
        const campaignItem = window.locator('.campaign-item', { hasText: 'To Be Cloned' }).first()
        await expect(campaignItem).toBeVisible()

        // 2. Click Clone on the new campaign
        // Force hover to ensure button is visible if needed, or just click
        await campaignItem.hover()
        await campaignItem.locator('button[title="Clone"]').click()

        // 3. Verify Wizard Opens
        await window.waitForSelector('[data-testid="campaign-name-input"]')

        // 4. Verify Prefilled Data
        const nameInput = window.locator('[data-testid="campaign-name-input"]')
        const val = await nameInput.inputValue()
        expect(val).toContain('To Be Cloned (Copy)')

        const intervalInput = window.locator('[data-testid="interval-input"]')
        expect(await intervalInput.inputValue()).toBe('30')

        const startTime = window.locator('[data-testid="start-time-input"]')
        expect(await startTime.inputValue()).toBe('10:00')

        // 5. Close
        await window.click('button:has-text("Close")')
    })
})
