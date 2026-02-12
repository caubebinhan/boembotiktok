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
     * Opens a BrowserWindow to TikTok login page.
     * After the user logs in, captures cookies and profile info,
     * saves to DB, and closes the window.
     * Returns the created account record.
     */
    async addAccount(): Promise<PublishAccount | null> {
        return new Promise((resolve, reject) => {
            // Create a dedicated session partition so cookies don't conflict
            const partitionName = `persist:tiktok-login-${Date.now()}`
            const ses = session.fromPartition(partitionName)

            const loginWindow = new BrowserWindow({
                width: 480,
                height: 720,
                title: 'Login to TikTok',
                autoHideMenuBar: true,
                webPreferences: {
                    session: ses,
                    nodeIntegration: false,
                    contextIsolation: true
                }
            })

            loginWindow.loadURL('https://www.tiktok.com/login')

            let resolved = false

            // Watch for navigation to a logged-in page (profile or home after login)
            const checkLogin = async (url: string) => {
                if (resolved) return

                // TikTok redirects to home or profile after successful login
                const isLoggedIn = (
                    (url.includes('tiktok.com') && !url.includes('/login')) &&
                    (url === 'https://www.tiktok.com/' ||
                        url.includes('tiktok.com/@') ||
                        url.includes('tiktok.com/foryou') ||
                        url.includes('tiktok.com/following'))
                )

                if (!isLoggedIn) return

                try {
                    // Give TikTok a moment to set all cookies
                    await new Promise(r => setTimeout(r, 2000))

                    // Capture all TikTok cookies
                    const cookies = await ses.cookies.get({ domain: '.tiktok.com' })
                    const cookiesJson = JSON.stringify(cookies)

                    // Try to extract username from the page
                    let username = ''
                    let displayName = ''
                    let avatarUrl = ''

                    try {
                        const result = await loginWindow.webContents.executeJavaScript(`
                            (function() {
                                // Try to get username from various sources
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
                        // If we can't extract profile info, try from cookies
                        const sidCookie = cookies.find(c => c.name === 'sid_tt' || c.name === 'sessionid_ss')
                        if (sidCookie) {
                            username = `tiktok_user_${Date.now()}`
                        }
                    }

                    // If still no username, navigate to profile to get it
                    if (!username) {
                        try {
                            await loginWindow.webContents.loadURL('https://www.tiktok.com/profile')
                            await new Promise(r => setTimeout(r, 3000))
                            const profileUrl = loginWindow.webContents.getURL()
                            const match = profileUrl.match(/@([\w.]+)/)
                            if (match) username = match[1]
                        } catch {
                            username = `tiktok_user_${Date.now()}`
                        }
                    }

                    if (!username) username = `tiktok_user_${Date.now()}`

                    // Save to DB
                    const result = storageService.run(
                        `INSERT INTO publish_accounts (platform, username, display_name, avatar_url, cookies_json, session_valid, last_login_at)
                         VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
                        ['tiktok', username, displayName || username, avatarUrl, cookiesJson]
                    )

                    const account = storageService.get(
                        'SELECT * FROM publish_accounts WHERE id = ?',
                        [result.lastInsertId]
                    ) as PublishAccount

                    resolved = true
                    loginWindow.close()
                    resolve(account)
                } catch (err) {
                    console.error('Failed to capture login:', err)
                    resolved = true
                    loginWindow.close()
                    reject(err)
                }
            }

            loginWindow.webContents.on('did-navigate', (_event, url) => {
                checkLogin(url)
            })
            loginWindow.webContents.on('did-navigate-in-page', (_event, url) => {
                checkLogin(url)
            })

            // User closed without logging in
            loginWindow.on('closed', () => {
                if (!resolved) {
                    resolved = true
                    resolve(null)
                }
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

        // Remove old and re-add
        // Or we can just update cookies after new login
        return new Promise((resolve, reject) => {
            const partitionName = `persist:tiktok-relogin-${id}-${Date.now()}`
            const ses = session.fromPartition(partitionName)

            const loginWindow = new BrowserWindow({
                width: 480,
                height: 720,
                title: `Re-login: ${existing.username}`,
                autoHideMenuBar: true,
                webPreferences: {
                    session: ses,
                    nodeIntegration: false,
                    contextIsolation: true
                }
            })

            loginWindow.loadURL('https://www.tiktok.com/login')

            let resolved = false

            const checkLogin = async (url: string) => {
                if (resolved) return
                const isLoggedIn = url.includes('tiktok.com') && !url.includes('/login') &&
                    (url === 'https://www.tiktok.com/' || url.includes('tiktok.com/@') ||
                        url.includes('tiktok.com/foryou') || url.includes('tiktok.com/following'))

                if (!isLoggedIn) return

                try {
                    await new Promise(r => setTimeout(r, 2000))
                    const cookies = await ses.cookies.get({ domain: '.tiktok.com' })
                    const cookiesJson = JSON.stringify(cookies)

                    storageService.run(
                        `UPDATE publish_accounts SET cookies_json = ?, session_valid = 1, last_login_at = datetime('now') WHERE id = ?`,
                        [cookiesJson, id]
                    )

                    const account = storageService.get(
                        'SELECT * FROM publish_accounts WHERE id = ?',
                        [id]
                    ) as PublishAccount

                    resolved = true
                    loginWindow.close()
                    resolve(account)
                } catch (err) {
                    resolved = true
                    loginWindow.close()
                    reject(err)
                }
            }

            loginWindow.webContents.on('did-navigate', (_e, url) => checkLogin(url))
            loginWindow.webContents.on('did-navigate-in-page', (_e, url) => checkLogin(url))

            loginWindow.on('closed', () => {
                if (!resolved) {
                    resolved = true
                    resolve(null)
                }
            })
        })
    }
}

export const publishAccountService = new PublishAccountService()
