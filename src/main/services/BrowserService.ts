import { chromium, Browser, BrowserContext, Page } from 'playwright-core'
import { app } from 'electron'
import path from 'path'
import fs from 'fs-extra'

class BrowserService {
    private browser: Browser | null = null
    private context: BrowserContext | null = null
    private isHeadless: boolean = false

    constructor() { }

    async init(headless: boolean = false): Promise<void> {
        if (this.isConnected()) {
            if (this.isHeadless === headless) {
                console.log('BrowserService already initialized in correct mode.')
                return
            }
            console.log(`Switching browser mode (Headless: ${this.isHeadless} -> ${headless}). Restarting...`)
            await this.close()
        }

        this.isHeadless = headless
        console.log(`Initializing BrowserService (Headless: ${headless})...`)

        try {
            // Try to find executable path or use channel
            // For MVP, we'll try to use the bundled chromium if installed, or system chrome
            // We can iterate on this detection logic later.

            const launchOptions = {
                headless: this.isHeadless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                    '--lang=en-US,en', // Force English locale
                ]
            }

            console.log(`[BrowserService] Launching with options:`, JSON.stringify(launchOptions, null, 2))

            try {
                console.log('[BrowserService] Attempting to launch Chrome channel...')
                this.browser = await chromium.launch({
                    ...launchOptions,
                    channel: 'chrome' // Try system Chrome first
                })
            } catch (err) {
                console.warn('[BrowserService] Chrome launch failed, trying Edge...', err)
                try {
                    this.browser = await chromium.launch({
                        ...launchOptions,
                        channel: 'msedge' // Fallback to Edge
                    })
                } catch (edgeErr) {
                    console.error('[BrowserService] Edge launch failed as well.', edgeErr)
                    throw new Error('No compatible browser found. Please install Chrome or Edge.')
                }
            }

            const version = this.browser.version()
            console.log(`[BrowserService] Browser launched successfully. Version: ${version}`)

            // Create a persistent context
            const userDataDir = path.join(app.getPath('userData'), 'browser_session')
            await fs.ensureDir(userDataDir)
            console.log(`[BrowserService] Using persistent UserDataDir: ${userDataDir}`)

            this.context = await this.browser.newContext({
                viewport: { width: 1920, height: 1080 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                locale: 'en-US', // Force locale to English
                recordVideo: {
                    dir: path.join(app.getPath('userData'), 'recordings'),
                    size: { width: 1920, height: 1080 }
                }
            })

            console.log('[BrowserService] Persistent context created.')

            // Add lifecycle listeners to context
            this.context.on('page', (page) => {
                const pageId = Math.random().toString(36).substring(7)
                console.log(`[BrowserService] [Page:${pageId}] New page created. Total pages: ${this.context?.pages().length}`)

                page.on('close', () => console.log(`[BrowserService] [Page:${pageId}] Page closed.`))
                page.on('domcontentloaded', () => console.log(`[BrowserService] [Page:${pageId}] DOMContentLoaded: ${page.url()}`))
                page.on('load', () => console.log(`[BrowserService] [Page:${pageId}] Load: ${page.url()}`))
                page.on('crash', () => console.error(`[BrowserService] [Page:${pageId}] CRASHED!`))

                // Track navigations
                page.on('framenavigated', (frame) => {
                    if (frame === page.mainFrame()) {
                        console.log(`[BrowserService] [Page:${pageId}] Navigated to: ${page.url()}`)
                    }
                })
            })

        } catch (error) {
            console.error('[BrowserService] Failed to launch browser:', error)
            // TODO: Handle missing browser (prompt user to install or download)
        }
    }

    async newPage(): Promise<Page | null> {
        if (!this.context) {
            console.error('[BrowserService] Context not initialized cannot create page')
            return null
        }
        console.log('[BrowserService] Requesting new page...')
        return this.context.newPage()
    }

    async close(): Promise<void> {
        if (this.context) {
            await this.context.close()
            this.context = null
        }
        if (this.browser) {
            await this.browser.close()
            this.browser = null
        }
    }

    isConnected(): boolean {
        return this.browser !== null && this.browser.isConnected()
    }
}

export const browserService = new BrowserService()
