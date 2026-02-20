import { Page } from 'playwright-core'
import { browserService } from '../../../services/BrowserService'
import { sanitizeCookies } from '../helpers/CookieHelper'
import { CaptchaHelper } from '../helpers/CaptchaHelper'
import { ScanOptions, ScanResult } from '../types'

// ─── Abstract base class for all TikTok scanners ─────────────────────────────

export abstract class ScannerBase {
    protected isScanning = false

    /** Ensure browser is running */
    protected async ensureBrowser(): Promise<void> {
        if (!browserService.isConnected()) {
            await browserService.init(false)
        }
    }

    /** Inject session cookies into the page context */
    protected async injectCookies(page: Page, cookies: any[], context: string): Promise<void> {
        if (!cookies || cookies.length === 0) {
            console.log(`[${context}] No cookies provided, scanning as guest`)
            return
        }
        try {
            const sanitized = sanitizeCookies(cookies)
            await page.context().addCookies(sanitized)
            console.log(`[${context}] Restored ${sanitized.length} cookies for authenticated scan`)
        } catch (e) {
            console.warn(`[${context}] Failed to set cookies, proceeding without auth:`, e)
        }
    }

    /** Check captcha and wait for user resolution if found */
    protected async handleCaptcha(page: Page, context: string): Promise<void> {
        const captcha = new CaptchaHelper(page)
        await captcha.detectAndWait(context)
    }

    abstract scan(source: string, options: ScanOptions): Promise<ScanResult>
}
