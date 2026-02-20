// ─── Cookie helper: sanitize cookies for Playwright context ──────────────────

export function sanitizeCookies(cookies: any[]): any[] {
    return cookies.map((c: any) => {
        if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None'
        if (c.sameSite === 'lax') c.sameSite = 'Lax'
        if (c.sameSite === 'strict') c.sameSite = 'Strict'
        if (c.sameSite === 'None') c.secure = true
        return c
    })
}
