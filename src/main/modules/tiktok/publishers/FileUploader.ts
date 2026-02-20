import { Page } from 'playwright-core'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { TIKTOK_SELECTORS } from '../constants/selectors'
import { OverlayHelper } from '../helpers/OverlayHelper'

// ─── File uploader for TikTok Studio ─────────────────────────────────────────

export class FileUploader {
    private overlayHelper: OverlayHelper

    constructor(private page: Page, private onProgress?: (msg: string) => void) {
        this.overlayHelper = new OverlayHelper(page, onProgress)
    }

    async upload(filePath: string): Promise<void> {
        const MAX_RETRIES = 3

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            if (this.onProgress) this.onProgress(`Uploading video (Attempt ${attempt})...`)
            await this.overlayHelper.clean()

            const uploaded = await this.attemptUpload(filePath)
            if (uploaded) return

            if (attempt < MAX_RETRIES) {
                console.log(`[FileUploader] Attempt ${attempt} failed, retrying...`)
                await this.overlayHelper.clean()
                await this.page.reload()
                await this.page.waitForTimeout(3000)
            }
        }

        throw new Error(`File upload failed after ${MAX_RETRIES} attempts`)
    }

    private async attemptUpload(filePath: string): Promise<boolean> {
        if (this.onProgress) this.onProgress('Waiting for file input...')

        let fileInput = await this.page.$('input[type="file"]')

        if (!fileInput) {
            // Log available buttons for debugging
            try {
                const buttons = await this.page.$$eval('button, div[role="button"]', els => els.map(e => e.textContent?.trim()).filter(Boolean))
                console.log('[FileUploader] Visible buttons:', buttons.join(', '))
            } catch { }

            // Try clicking upload buttons
            for (const btnSel of TIKTOK_SELECTORS.UPLOAD.UPLOAD_BUTTONS) {
                try {
                    const btn = await this.page.locator(btnSel).first()
                    if (await btn.isVisible()) {
                        console.log(`[FileUploader] Clicking upload button: ${btnSel}`)
                        await btn.click({ force: true })
                        await this.page.waitForTimeout(1500)
                        fileInput = await this.page.$('input[type="file"]')
                        if (fileInput) break
                    }
                } catch { }
            }
        }

        // Last resort: click center of screen
        if (!fileInput) {
            try {
                const viewport = this.page.viewportSize()
                if (viewport) {
                    await this.page.mouse.click(viewport.width / 2, viewport.height / 2)
                    await this.page.waitForTimeout(1500)
                    fileInput = await this.page.$('input[type="file"]')
                }
            } catch { }
        }

        // Final wait
        if (!fileInput) {
            try {
                fileInput = await this.page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 10000 })
            } catch {
                const ts = Date.now()
                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                await fs.ensureDir(debugDir)
                await this.page.screenshot({ path: path.join(debugDir, `upload_fail_${ts}.png`) })
                await fs.writeFile(path.join(debugDir, `upload_fail_${ts}.html`), await this.page.content())
                throw new Error('File input not found (Debug saved)')
            }
        }

        if (!fileInput) throw new Error('File input not found on upload page')

        console.log(`[FileUploader] Setting file: ${filePath}`)
        await fileInput.setInputFiles(filePath)

        // Wait for upload completion
        for (let waitCycle = 0; waitCycle < 60; waitCycle++) {
            await this.page.waitForTimeout(2000)

            // Check for upload errors
            try {
                const errEl = await this.page.locator('[data-e2e="toast-message"], .tiktok-toast, [role="alert"]').first()
                if (await errEl.isVisible()) {
                    const errText = await errEl.textContent()
                    console.log(`[FileUploader] Upload error detected: "${errText}"`)
                    await this.overlayHelper.clean()

                    const retryBtn = await this.page.$('button:has-text("Retry"), button:has-text("Thử lại")')
                    if (retryBtn && await retryBtn.isVisible()) {
                        await retryBtn.click()
                        await this.page.waitForTimeout(2000)
                        continue
                    }
                    return false
                }
            } catch { }

            // Check upload completion
            for (const sel of TIKTOK_SELECTORS.UPLOAD.READY_INDICATORS) {
                const el = await this.page.$(sel).catch(() => null)
                if (el && await el.isVisible()) {
                    console.log(`[FileUploader] Upload ready: ${sel}`)
                    return true
                }
            }

            if (waitCycle % 10 === 0 && waitCycle > 0) console.log(`[FileUploader] Still uploading... (${waitCycle * 2}s)`)
        }

        return false
    }
}
