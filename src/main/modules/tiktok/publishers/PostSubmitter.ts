import { Page } from 'playwright-core'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { OverlayHelper } from '../helpers/OverlayHelper'
import { DebugHelper } from '../helpers/DebugHelper'
import { PublishResult } from '../types'

// ─── Post button submitter ────────────────────────────────────────────────────

export class PostSubmitter {
    private overlayHelper: OverlayHelper

    constructor(private page: Page, private onProgress?: (msg: string) => void) {
        this.overlayHelper = new OverlayHelper(page, onProgress)
    }

    async submit(): Promise<void> {
        console.log('[PostSubmitter] Preparing to post...')
        if (this.onProgress) this.onProgress('Clicking Post button...')

        // Handle content check popups
        await this.handleContentCheckPopup()
        await this.overlayHelper.clean()

        // Handle violation check
        await this.checkViolations()

        // Zoom out for visibility (TikTok Studio sometimes hides the button)
        console.log('[PostSubmitter] Zooming to 33% for button visibility...')
        await this.page.evaluate(() => { document.body.style.zoom = '0.33' })
        await new Promise(resolve => setTimeout(resolve, 5000))

        // Dump pre-post state
        await DebugHelper.dumpPageState(this.page, 'before_post')

        // Find and click Post button
        for (let i = 0; i < 15; i++) {
            if (this.onProgress) this.onProgress(`Searching for Post button (Attempt ${i + 1}/15)...`)

            const clicked = await this.findAndClickPostButton()
            if (clicked) {
                await this.handleConfirmDialog()
                await DebugHelper.dumpPageState(this.page, 'after_post')
                return
            }

            // Fallback scroll
            await this.page.evaluate(() => {
                const scrollable = Array.from(document.querySelectorAll('*')).filter(el => {
                    const style = window.getComputedStyle(el)
                    return (style.overflowY === 'scroll' || style.overflowY === 'auto') && el.scrollHeight > el.clientHeight
                })
                scrollable.sort((a, b) => b.scrollHeight - a.scrollHeight)
                const target = scrollable[0] || document.documentElement
                target.scrollTop = target.scrollHeight
            }).catch(() => { })

            await this.page.waitForTimeout(2000)
        }

        throw new Error('Could not find or click Post button - Debug artifacts saved.')
    }

    private async handleContentCheckPopup(): Promise<void> {
        try {
            const popup = await this.page.locator('text="Run a copyright check"').or(this.page.locator('text="Automatic content checks"'))
            if (await popup.isVisible({ timeout: 5000 })) {
                const btn = await this.page.locator('button:has-text("Turn on"), button:has-text("Try it now"), button:has-text("Run check")').first()
                if (await btn.isVisible()) {
                    await btn.click()
                    await this.page.waitForTimeout(1000)
                }
            }
        } catch { }
    }

    private async checkViolations(): Promise<void> {
        try {
            const restrictionEl = await this.page.locator('text="Content may be restricted"')
                .or(this.page.locator('text="Violation reason"'))
                .or(this.page.locator('text="Nội dung có thể bị hạn chế"'))
                .first()

            if (await restrictionEl.isVisible()) {
                throw new Error('TikTok detected content violation/restriction during upload.')
            }
        } catch (e: any) {
            if (e.message.includes('violation')) throw e
        }
    }

    private async findAndClickPostButton(): Promise<boolean> {
        const buttons = this.page.locator('button, div[role="button"]')
        const count = await buttons.count()

        let bestBtn = null, bestScore = -1, maxY = -1

        for (let j = 0; j < count; j++) {
            const btn = buttons.nth(j)
            if (!await btn.isVisible()) continue

            const box = await btn.boundingBox()
            if (!box) continue

            let score = 0
            const text = (await btn.innerText()).trim()
            const dataE2E = await btn.getAttribute('data-e2e')
            const style = await btn.evaluate((el) => ({ bg: window.getComputedStyle(el).backgroundColor }))

            if (dataE2E === 'post-video-button') score += 100
            if (text === 'Post' || text === 'Đăng' || text.includes('Post')) score += 50
            // TikTok Red: ~rgb(254, 44, 85)
            if (style.bg.includes('254') && style.bg.includes('44') && style.bg.includes('85')) score += 80

            if (score === 0) continue

            if (score > bestScore || (score === bestScore && box.y > maxY)) {
                bestScore = score
                bestBtn = btn
                maxY = box.y
            }
        }

        if (!bestBtn) return false

        try {
            await this.overlayHelper.clean()
            await bestBtn.click()
            console.log('[PostSubmitter] Clicked Post button')
            return true
        } catch (e) {
            console.warn('[PostSubmitter] Click failed:', e)
            return false
        }
    }

    private async handleConfirmDialog(): Promise<void> {
        console.log('[PostSubmitter] Checking for confirmation dialog...')
        await this.page.waitForTimeout(2000)

        const confirmSelectors = [
            'button:has-text("Post now")', 'button:has-text("Vẫn đăng")',
            'button:has-text("Continue")', 'button:has-text("Post anyway")',
            'div[role="dialog"] button:has-text("Post")',
            'div[role="dialog"] button:has-text("Đăng")',
        ]
        for (const sel of confirmSelectors) {
            const btn = await this.page.$(sel)
            if (btn && await btn.isVisible()) {
                console.log(`[PostSubmitter] Confirming with: ${sel}`)
                await btn.click()
                await this.page.waitForTimeout(2000)
                return
            }
        }
    }
}
