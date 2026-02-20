import { Page } from 'playwright-core'
import { browserService } from '../../../services/BrowserService'
import * as Sentry from '@sentry/electron/main'
import { sanitizeCookies } from '../helpers/CookieHelper'
import { FileUploader } from './FileUploader'
import { CaptionSetter } from './CaptionSetter'
import { PostSubmitter } from './PostSubmitter'
import { PublishVerifier } from './PublishVerifier'
import { PublishOptions, PublishResult } from '../types'
import { DebugHelper } from '../helpers/DebugHelper'

// ─── VideoPublisher: orchestrates the full TikTok upload flow ─────────────────

export class VideoPublisher {
    async publish(
        filePath: string,
        caption: string,
        cookies: any[],
        onProgress?: (msg: string) => void,
        options?: PublishOptions
    ): Promise<PublishResult> {
        const useUniqueTag = options?.advancedVerification || false
        const uniqueTag = '#' + Math.random().toString(36).substring(2, 8)
        const finalCaption = useUniqueTag ? (caption + ' ' + uniqueTag) : caption

        console.log(`[VideoPublisher] Starting publish:`)
        console.log(`  File: ${filePath}`)
        console.log(`  Verification Tag: ${useUniqueTag ? uniqueTag : 'Disabled'}`)
        console.log(`  Caption: "${finalCaption}"`)

        if (onProgress) onProgress('Initializing browser...')

        let page: Page | null = null
        const uploadStartTime = Math.floor(Date.now() / 1000)

        try {
            await browserService.init(false)
            page = await browserService.newPage()
            if (!page) throw new Error('Failed to create page')

            // Inject cookies
            if (!cookies || cookies.length === 0) {
                throw new Error('No cookies provided. Please re-login the publish account.')
            }
            try {
                await page.context().addCookies(sanitizeCookies(cookies))
                console.log(`[VideoPublisher] Injected ${cookies.length} cookies`)
            } catch (e) { console.error('[VideoPublisher] Cookie injection failed:', e) }

            // Navigate to TikTok Studio
            if (onProgress) onProgress('Navigating to upload page...')
            try {
                await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=webapp', {
                    waitUntil: 'domcontentloaded', timeout: 60000
                })
            } catch (e: any) {
                if (!e.message.includes('interrupted by another navigation')) throw e
            }
            await page.waitForTimeout(3000)

            if (page.url().includes('/login')) {
                throw new Error('Session expired: redirected to login page. Please re-login.')
            }

            // Upload file
            const uploader = new FileUploader(page, onProgress)
            await uploader.upload(filePath)

            if (page.isClosed()) throw new Error('Browser closed unexpectedly before posting.')
            await page.waitForTimeout(1000)

            // Set caption
            const captionSetter = new CaptionSetter(page, onProgress)
            await captionSetter.setCaption(finalCaption)

            if (page.isClosed()) throw new Error('Browser closed unexpectedly before posting.')

            // Submit post
            const submitter = new PostSubmitter(page, onProgress)
            await submitter.submit()

            // Verify
            const verifier = new PublishVerifier(page)
            return await verifier.verify({
                useUniqueTag,
                uniqueTag,
                uploadStartTime,
                username: options?.username,
                onProgress,
            })

        } catch (error: any) {
            Sentry.captureException(error, { tags: { module: 'tiktok', operation: 'publishVideo' } })
            console.error('[VideoPublisher] Publish failed:', error)

            let debugArtifacts: { screenshot?: string; html?: string } | undefined
            if (page && !page.isClosed()) {
                try {
                    const result = await DebugHelper.dumpPageState(page, 'publish_error')
                    debugArtifacts = result
                } catch { }
            }

            return { success: false, error: error.message || String(error), debugArtifacts }
        } finally {
            if (page) await page.close()
        }
    }
}
