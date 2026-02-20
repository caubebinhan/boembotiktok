import { Page } from 'playwright-core'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { TIKTOK_SELECTORS } from '../constants/selectors'
import { BLOCKED_TEXT_INDICATORS } from '../constants/messages'

// ─── Captcha detection & waiting helper ──────────────────────────────────────

export class CaptchaHelper {
    constructor(private page: Page) { }

    /** Returns true if a captcha or block is currently visible */
    async isVisible(): Promise<boolean> {
        const isCaptcha = await this.page.evaluate((selectors) => {
            return selectors.some(s => {
                const el = document.querySelector(s)
                if (!el) return false
                const rect = (el as HTMLElement).getBoundingClientRect()
                return rect.width > 0 && rect.height > 0
            })
        }, TIKTOK_SELECTORS.CAPTCHA)

        const pageText = await this.page.textContent('body').catch(() => '')
        const isBlocked = BLOCKED_TEXT_INDICATORS.some(t => pageText?.includes(t))

        return isCaptcha || isBlocked
    }

    /**
     * Detect captcha and wait up to `timeout` ms for the user to solve it.
     * Throws 'CAPTCHA_REQUIRED' if timeout is exceeded.
     */
    async detectAndWait(context: string, timeout = 120000): Promise<void> {
        if (!(await this.isVisible())) return

        console.warn(`[CaptchaHelper] Captcha/Block detected during ${context}`)
        console.log(`[CaptchaHelper] Waiting ${timeout / 1000}s for user resolution...`)

        const start = Date.now()
        while (Date.now() - start < timeout) {
            await this.page.waitForTimeout(2000)
            if (this.page.isClosed()) throw new Error('Browser closed by user')
            if (!(await this.isVisible())) {
                console.log('[CaptchaHelper] CAPTCHA resolved! Resuming...')
                return
            }
        }

        // Timed out — dump artifacts and throw
        await this.dumpArtifacts(context)
        throw new Error('CAPTCHA_REQUIRED')
    }

    /**
     * Block until captcha is gone (specifically for profile scan flow).
     * 5 minute timeout, waits for [data-e2e="user-post-item"] after resolution.
     */
    async waitForResolutionInScan(username: string): Promise<void> {
        const CAPTCHA_WAIT = 300000
        console.log(`[CaptchaHelper] CAPTCHA detected for @${username}. Waiting up to 5 min...`)

        // Take screenshot so user can see
        try {
            const debugDir = path.join(app.getPath('userData'), 'scan_debug')
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            await this.page.screenshot({ path: path.join(debugDir, `captcha_${username}_${ts}.png`), fullPage: false })
        } catch { }

        try {
            await this.page.waitForFunction(() => {
                const containers = [
                    document.querySelector('.captcha-verify-container'),
                    document.querySelector('#captcha_container'),
                    document.querySelector('.captcha_verify_container'),
                ]
                return !containers.some(el => {
                    if (!el) return false
                    const rect = (el as HTMLElement).getBoundingClientRect()
                    return rect.width > 0 && rect.height > 0
                })
            }, { timeout: CAPTCHA_WAIT, polling: 1000 })

            console.log('[CaptchaHelper] CAPTCHA resolved! Waiting for content...')

            try {
                await this.page.waitForSelector('[data-e2e="user-post-item"]', { timeout: 15000 })
            } catch {
                console.log('[CaptchaHelper] Content not detected after 15s. Reloading...')
                await this.page.reload({ waitUntil: 'domcontentloaded' })
                await this.page.waitForTimeout(5000)
            }

            // Post-CAPTCHA screenshot
            try {
                const debugDir = path.join(app.getPath('userData'), 'scan_debug')
                const ts = new Date().toISOString().replace(/[:.]/g, '-')
                await this.page.screenshot({ path: path.join(debugDir, `after_captcha_${username}_${ts}.png`), fullPage: true })
            } catch { }

        } catch {
            throw new Error('CAPTCHA_FAILED: User did not solve CAPTCHA in time (5 mins)')
        }
    }

    /** Check if a basic captcha container is visible (lightweight check for scanProfile) */
    async isBasicCaptchaVisible(): Promise<boolean> {
        return this.page.evaluate(() => {
            const containers = [
                document.querySelector('.captcha-verify-container'),
                document.querySelector('#captcha_container'),
                document.querySelector('.captcha_verify_container'),
            ]
            return containers.some(el => {
                if (!el) return false
                const rect = (el as HTMLElement).getBoundingClientRect()
                return rect.width > 0 && rect.height > 0
            })
        })
    }

    /** Dump screenshot + HTML artifact for debugging */
    async dumpArtifacts(context: string): Promise<{ screenshot: string; html: string }> {
        const ts = Date.now()
        const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
        await fs.ensureDir(debugDir)
        const screenshotPath = path.join(debugDir, `captcha_${context}_${ts}.png`)
        const htmlPath = path.join(debugDir, `captcha_${context}_${ts}.html`)

        if (!this.page.isClosed()) {
            await this.page.screenshot({ path: screenshotPath }).catch(e => console.error('Screenshot failed:', e))
            const html = await this.page.content().catch(() => '')
            await fs.writeFile(htmlPath, html).catch(e => console.error('HTML dump failed:', e))
            console.log(`[CaptchaHelper] Artifacts dumped: ${debugDir}`)
        }
        return { screenshot: screenshotPath, html: htmlPath }
    }
}
