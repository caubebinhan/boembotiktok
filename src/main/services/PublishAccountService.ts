import { BrowserWindow, session } from 'electron'
import { storageService } from './StorageService'

export interface PublishAccount {
    id: number
    platform: string
    username: string
    display_name: string
    avatar_url: string
    cookies_json: string
    proxy_url: string
    auto_caption: string
    auto_tags: string
    settings_json: string
    session_valid: number
    last_login_at: string
    created_at: string
}

export interface PublishAccountSettings {
    proxy_url?: string
    auto_caption?: string
    auto_tags?: string
    settings_json?: string
}

class PublishAccountService {

    /**
     * Check if session cookies exist indicating the user is logged in.
     */
    private async hasSessionCookies(ses: Electron.Session): Promise<boolean> {
        try {
            const cookies = await ses.cookies.get({})
            return cookies.some(c =>
                c.name === 'sid_tt' ||
                c.name === 'sessionid_ss' ||
                c.name === 'sessionid'
            )
        } catch {
            return false
        }
    }

    /**
     * Capture cookies and extract user profile info from the browser window.
     * Returns { cookies, username, displayName, avatarUrl } or null if no valid session.
     */
    private async captureSession(loginWindow: BrowserWindow, ses: Electron.Session): Promise<{
        cookiesJson: string
        username: string
        displayName: string
        avatarUrl: string
    } | null> {
        const hasSession = await this.hasSessionCookies(ses)
        if (!hasSession) return null

        // Capture all cookies
        const cookies = await ses.cookies.get({})
        const cookiesJson = JSON.stringify(cookies)

        let username = ''
        let displayName = ''
        let avatarUrl = ''

        try {
            const result = await loginWindow.webContents.executeJavaScript(`
                (function() {
                    const uniqueIdEl = document.querySelector('[data-e2e="user-title"]') ||
                                       document.querySelector('.user-username') ||
                                       document.querySelector('h2[data-e2e="user-subtitle"]');
                    const displayNameEl = document.querySelector('[data-e2e="user-subtitle"]') ||
                                          document.querySelector('.user-nickname');
                    const avatarEl = document.querySelector('[data-e2e="user-avatar"] img') ||
                                     document.querySelector('.avatar img');
                    return {
                        username: uniqueIdEl?.textContent?.trim() || '',
                        displayName: displayNameEl?.textContent?.trim() || '',
                        avatarUrl: avatarEl?.src || ''
                    };
                })();
            `)
            username = result.username
            displayName = result.displayName
            avatarUrl = result.avatarUrl
        } catch {
            // Profile info extraction failed, will try URL-based fallback below
        }

        // If still no username, try to navigate to profile to extract it
        if (!username) {
            try {
                await loginWindow.webContents.loadURL('https://www.tiktok.com/profile')
                await new Promise(r => setTimeout(r, 3000))
                const profileUrl = loginWindow.webContents.getURL()
                const match = profileUrl.match(/@([\w.]+)/)
                if (match) username = match[1]
            } catch {
                // fallback
            }
        }

        if (!username) username = `tiktok_user_${Date.now()}`

        return { cookiesJson, username, displayName: displayName || username, avatarUrl }
    }

    /**
     * Opens a BrowserWindow to TikTok login page.
     * After the user logs in, captures cookies and profile info,
     * saves to DB, and closes the window.
     * Also captures cookies if the user closes the window after logging in.
     * Returns the created account record.
     */
    async addAccount(): Promise<PublishAccount | null> {
        return new Promise((resolve) => {
            const partitionName = `persist:tiktok-login-${Date.now()}`
            const ses = session.fromPartition(partitionName)

            const loginWindow = new BrowserWindow({
                width: 480,
                height: 720,
                title: 'Login to TikTok — Close this window after logging in',
                autoHideMenuBar: true,
                webPreferences: {
                    session: ses,
                    nodeIntegration: false,
                    contextIsolation: true
                }
            })

            loginWindow.loadURL('https://www.tiktok.com/login')

            let resolved = false

            const saveAndResolve = async () => {
                if (resolved) return
                resolved = true

                try {
                    const sessionData = await this.captureSession(loginWindow, ses)
                    if (!sessionData) {
                        if (!loginWindow.isDestroyed()) loginWindow.close()
                        resolve(null)
                        return
                    }

                    // Save to DB
                    const result = storageService.run(
                        `INSERT INTO publish_accounts (platform, username, display_name, avatar_url, cookies_json, session_valid, last_login_at)
                         VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
                        ['tiktok', sessionData.username, sessionData.displayName, sessionData.avatarUrl, sessionData.cookiesJson]
                    )

                    const account = storageService.get(
                        'SELECT * FROM publish_accounts WHERE id = ?',
                        [result.lastInsertId]
                    ) as PublishAccount

                    if (!loginWindow.isDestroyed()) loginWindow.close()
                    resolve(account)
                } catch (err) {
                    console.error('Failed to capture login:', err)
                    if (!loginWindow.isDestroyed()) loginWindow.close()
                    resolve(null)
                }
            }

            // Watch for navigation to a logged-in page
            const checkLogin = async (url: string) => {
                if (resolved) return

                // Broader check: any TikTok page that isn't the login page
                const isOnTiktok = url.includes('tiktok.com')
                const isOnLogin = url.includes('/login') || url.includes('/signup')

                if (!isOnTiktok || isOnLogin) return

                // Wait for cookies to be set
                await new Promise(r => setTimeout(r, 2000))

                const hasSession = await this.hasSessionCookies(ses)
                if (hasSession) {
                    await saveAndResolve()
                }
            }

            loginWindow.webContents.on('did-navigate', (_event, url) => {
                checkLogin(url)
            })
            loginWindow.webContents.on('did-navigate-in-page', (_event, url) => {
                checkLogin(url)
            })

            // User closed the window — attempt to capture cookies anyway
            loginWindow.on('close', async (e) => {
                if (resolved) return

                // Prevent immediate close so we can try to capture
                e.preventDefault()
                resolved = true

                try {
                    const hasSession = await this.hasSessionCookies(ses)
                    if (hasSession) {
                        const cookies = await ses.cookies.get({})
                        const cookiesJson = JSON.stringify(cookies)

                        // Try to get username from current URL
                        let username = ''
                        try {
                            const currentUrl = loginWindow.webContents.getURL()
                            const match = currentUrl.match(/@([\w.]+)/)
                            if (match) username = match[1]
                        } catch { /* ignore */ }

                        if (!username) username = `tiktok_user_${Date.now()}`

                        const result = storageService.run(
                            `INSERT INTO publish_accounts (platform, username, display_name, avatar_url, cookies_json, session_valid, last_login_at)
                             VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
                            ['tiktok', username, username, '', cookiesJson]
                        )

                        const account = storageService.get(
                            'SELECT * FROM publish_accounts WHERE id = ?',
                            [result.lastInsertId]
                        ) as PublishAccount

                        loginWindow.destroy()
                        resolve(account)
                        return
                    }
                } catch (err) {
                    console.error('Failed to capture on close:', err)
                }

                loginWindow.destroy()
                resolve(null)
            })
        })
    }

    /**
     * List all publish accounts
     */
    listAccounts(): PublishAccount[] {
        return storageService.all(
            'SELECT * FROM publish_accounts ORDER BY created_at DESC'
        ) as PublishAccount[]
    }

    /**
     * Update account settings (proxy, auto-caption, auto-tags, etc.)
     */
    updateAccount(id: number, settings: PublishAccountSettings): void {
        const updates: string[] = []
        const params: any[] = []

        if (settings.proxy_url !== undefined) {
            updates.push('proxy_url = ?')
            params.push(settings.proxy_url)
        }
        if (settings.auto_caption !== undefined) {
            updates.push('auto_caption = ?')
            params.push(settings.auto_caption)
        }
        if (settings.auto_tags !== undefined) {
            updates.push('auto_tags = ?')
            params.push(settings.auto_tags)
        }
        if (settings.settings_json !== undefined) {
            updates.push('settings_json = ?')
            params.push(settings.settings_json)
        }

        if (updates.length === 0) return

        params.push(id)
        storageService.run(
            `UPDATE publish_accounts SET ${updates.join(', ')} WHERE id = ?`,
            params
        )
    }

    /**
     * Remove a publish account
     */
    removeAccount(id: number): void {
        storageService.run('DELETE FROM publish_accounts WHERE id = ?', [id])
    }

    /**
     * Get cookies for a specific account (for use during publishing)
     */
    getAccountCookies(id: number): any[] {
        const account = storageService.get(
            'SELECT cookies_json FROM publish_accounts WHERE id = ?',
            [id]
        )
        if (!account || !account.cookies_json) return []
        try {
            return JSON.parse(account.cookies_json)
        } catch {
            return []
        }
    }

    /**
     * Re-login an existing account (refresh cookies)
     */
    async reLoginAccount(id: number): Promise<PublishAccount | null> {
        const existing = storageService.get(
            'SELECT * FROM publish_accounts WHERE id = ?',
            [id]
        )
        if (!existing) return null

        return new Promise((resolve) => {
            const partitionName = `persist:tiktok-relogin-${id}-${Date.now()}`
            const ses = session.fromPartition(partitionName)

            const loginWindow = new BrowserWindow({
                width: 480,
                height: 720,
                title: `Re-login: ${existing.username} — Close after logging in`,
                autoHideMenuBar: true,
                webPreferences: {
                    session: ses,
                    nodeIntegration: false,
                    contextIsolation: true
                }
            })

            loginWindow.loadURL('https://www.tiktok.com/login')

            let resolved = false

            const updateAndResolve = async (cookiesJson: string) => {
                if (resolved) return
                resolved = true

                try {
                    storageService.run(
                        `UPDATE publish_accounts SET cookies_json = ?, session_valid = 1, last_login_at = datetime('now') WHERE id = ?`,
                        [cookiesJson, id]
                    )

                    const account = storageService.get(
                        'SELECT * FROM publish_accounts WHERE id = ?',
                        [id]
                    ) as PublishAccount

                    if (!loginWindow.isDestroyed()) loginWindow.close()
                    resolve(account)
                } catch (err) {
                    console.error('Re-login save failed:', err)
                    if (!loginWindow.isDestroyed()) loginWindow.close()
                    resolve(null)
                }
            }

            const checkLogin = async (url: string) => {
                if (resolved) return
                const isOnTiktok = url.includes('tiktok.com')
                const isOnLogin = url.includes('/login') || url.includes('/signup')
                if (!isOnTiktok || isOnLogin) return

                await new Promise(r => setTimeout(r, 2000))

                const hasSession = await this.hasSessionCookies(ses)
                if (hasSession) {
                    const cookies = await ses.cookies.get({})
                    await updateAndResolve(JSON.stringify(cookies))
                }
            }

            loginWindow.webContents.on('did-navigate', (_e, url) => checkLogin(url))
            loginWindow.webContents.on('did-navigate-in-page', (_e, url) => checkLogin(url))

            // Capture cookies on close if session exists
            loginWindow.on('close', async (e) => {
                if (resolved) return
                e.preventDefault()
                resolved = true

                try {
                    const hasSession = await this.hasSessionCookies(ses)
                    if (hasSession) {
                        const cookies = await ses.cookies.get({})
                        storageService.run(
                            `UPDATE publish_accounts SET cookies_json = ?, session_valid = 1, last_login_at = datetime('now') WHERE id = ?`,
                            [JSON.stringify(cookies), id]
                        )
                        const account = storageService.get(
                            'SELECT * FROM publish_accounts WHERE id = ?',
                            [id]
                        ) as PublishAccount
                        loginWindow.destroy()
                        resolve(account)
                        return
                    }
                } catch (err) {
                    console.error('Re-login capture on close failed:', err)
                }

                loginWindow.destroy()
                resolve(null)
            })
        })
    }
}

export const publishAccountService = new PublishAccountService()
