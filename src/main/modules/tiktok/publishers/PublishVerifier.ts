import { Page, Response } from 'playwright-core'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { PublishResult } from '../types'

// ─── Post verification via TikTok Content Dashboard ──────────────────────────

interface VerifyOptions {
    useUniqueTag: boolean
    uniqueTag: string
    uploadStartTime: number
    username?: string
    onProgress?: (msg: string) => void
}

const SUCCESS_SELECTORS = [
    'div:has-text("Manage your posts")',
    'div:has-text("View Profile")',
    'div:has-text("Upload complete")',
    'div:has-text("Video uploaded")',
    'span:has-text("Posts (Created on)")',
    'div[data-tt="components_PostTable_Container"]',
    'div:has-text("Quản lý bài đăng")',
    'div:has-text("Xem hồ sơ")',
    'div:has-text("Đã tải lên video")',
    'div:has-text("Tải lên hoàn tất")',
]

export class PublishVerifier {
    constructor(private page: Page) { }

    async verify(opts: VerifyOptions): Promise<PublishResult> {
        console.log('[PublishVerifier] Verifying publication...')
        if (opts.onProgress) opts.onProgress('Verifying publication...')

        const published = await this.waitForSuccessIndicator(opts)
        if (!published) return published as PublishResult  // may be a violation result

        // Redirect to Content Dashboard for strict verification
        return this.verifyViaDashboard(opts)
    }

    private async waitForSuccessIndicator(opts: VerifyOptions): Promise<PublishResult | boolean> {
        for (let i = 0; i < 120; i++) {
            if (this.page.isClosed()) throw new Error('Browser page closed unexpectedly during verification')
            try { await this.page.waitForTimeout(1000) } catch { break }

            // Check still uploading
            try {
                const uploadingEl = await this.page.$('text="Your video is being uploaded"') ||
                    await this.page.$('text="Video của bạn đang được tải lên"')
                if (uploadingEl && await uploadingEl.isVisible()) continue
            } catch { }

            // Check success selectors
            for (const selector of SUCCESS_SELECTORS) {
                if (await this.page.$(selector).catch(() => null)) {
                    console.log(`[PublishVerifier] Success indicator found: ${selector}`)
                    return true
                }
            }

            // Check modal dialogs for success or violations
            const result = await this.checkModalDialogs(opts)
            if (result !== null) return result
        }

        // Timeout — dump debug
        const ts = Date.now()
        const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
        await fs.ensureDir(debugDir)
        await this.page.screenshot({ path: path.join(debugDir, `timeout_error_${ts}.png`) })
        await fs.writeFile(path.join(debugDir, `timeout_error_${ts}.html`), await this.page.content())
        throw new Error('Upload timed out or success message not found.')
    }

    private async checkModalDialogs(opts: VerifyOptions): Promise<PublishResult | null> {
        try {
            const dialogs = this.page.locator('div[role="dialog"], div[class*="modal"], div[class*="dialog-content"], div[class*="TUXModal"]')
            const count = await dialogs.count()

            for (let d = 0; d < count; d++) {
                const dialog = dialogs.nth(d)
                if (!await dialog.isVisible()) continue

                const text = (await dialog.innerText()) || ''
                const cleanText = text.replace(/\n+/g, ' ').trim()

                const isSuccess = SUCCESS_SELECTORS.some(s => {
                    const m = s.match(/"([^"]+)"/)
                    return m && cleanText.includes(m[1])
                })

                if (isSuccess) {
                    console.log(`[PublishVerifier] Success via modal: ${cleanText.substring(0, 50)}`)
                    return null // not a violation result, continue
                }

                if (cleanText.length > 5) {
                    // Violation detected
                    const errorTime = Date.now()
                    const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                    await fs.ensureDir(debugDir)
                    const screenshotPath = path.join(debugDir, `violation_modal_${errorTime}.png`)
                    const htmlPath = path.join(debugDir, `violation_modal_${errorTime}.html`)
                    await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { })
                    await fs.writeFile(htmlPath, await this.page.content()).catch(() => { })

                    return {
                        success: false,
                        error: `TikTok Violation Caught: ${cleanText.substring(0, 200)}`,
                        debugArtifacts: { screenshot: screenshotPath, html: htmlPath, logs: [`Violation: ${cleanText}`] }
                    }
                }
            }
        } catch { }
        return null
    }

    private async verifyViaDashboard(opts: VerifyOptions): Promise<PublishResult> {
        console.log('[PublishVerifier] Navigating to Content Dashboard for status check...')
        if (opts.onProgress) opts.onProgress('Checking video status...')

        try {
            let apiResponseData: any = null
            const responseHandler = async (response: Response) => {
                try {
                    if (response.url().includes('tiktokstudio/content/list')) {
                        const json = await response.json()
                        if (json?.data?.post_list) apiResponseData = json.data.post_list
                    }
                } catch { }
            }
            this.page.on('response', responseHandler)
            await this.page.goto('https://www.tiktok.com/tiktokstudio/content', { waitUntil: 'domcontentloaded' })

            for (let check = 1; check <= 5; check++) {
                if (this.page.isClosed()) break
                await this.page.waitForTimeout(5000).catch(() => { })

                // Try API data
                if (apiResponseData?.length > 0) {
                    const now = Math.floor(Date.now() / 1000)
                    const match = apiResponseData.find((v: any) => {
                        if (opts.useUniqueTag && v.desc?.includes(opts.uniqueTag)) return true
                        return parseInt(v.create_time) >= (now - 900)
                    }) || apiResponseData[0]

                    if (match) {
                        this.page.off('response', responseHandler)
                        let finalUrl: string | undefined
                        try {
                            const u = await this.page.evaluate(() => document.querySelector('header a')?.getAttribute('href')?.replace('/', '')?.replace('@', ''))
                            const uname = u || opts.username || 'user'
                            finalUrl = `https://www.tiktok.com/@${uname}/video/${match.item_id}`
                        } catch { }

                        return { success: true, videoId: match.item_id, videoUrl: finalUrl, isReviewing: match.privacy_level !== 1 }
                    }
                }

                // Try UI table
                const uiStatus = await this.page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('div[data-e2e="recent-post-item"], div[class*="PostItem-"], tr'))
                    if (rows.length > 0) {
                        const row = rows[0] as HTMLElement
                        const linkEl = row.querySelector('a[href*="/video/"]')
                        const href = linkEl?.getAttribute('href')
                        const idMatch = href?.match(/\/video\/(\d+)/)
                        const isReviewing = row.innerText.includes('Under review') || row.innerText.includes('Đang xét duyệt')
                        return { id: idMatch ? idMatch[1] : null, url: href, isReviewing }
                    }
                    return null
                })

                if (uiStatus?.id) {
                    this.page.off('response', responseHandler)
                    return { success: true, videoId: uiStatus.id, videoUrl: uiStatus.url || undefined, isReviewing: uiStatus.isReviewing }
                }
            }

            this.page.off('response', responseHandler)
        } catch (e) {
            console.error('[PublishVerifier] Dashboard check error:', e)
        }

        return { success: true, warning: 'Verification failed - Check Dashboard manually', isReviewing: true }
    }
}
