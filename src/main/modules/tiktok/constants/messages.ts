// ─── TikTok Error Messages ────────────────────────────────────────────────────

export const ERROR_MESSAGES = {
    CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
    SESSION_EXPIRED: 'Session expired: redirected to login page. Please re-login.',
    FILE_INPUT_NOT_FOUND: 'File input not found on upload page',
    UPLOAD_FAILED: (attempts: number) => `File upload failed after ${attempts} attempts`,
    POST_BUTTON_NOT_FOUND: 'Could not find or click Post button - Debug artifacts saved.',
    NO_COOKIES: 'No cookies provided. Please re-login the publish account.',
    CAPTCHA_TIMEOUT: 'CAPTCHA_FAILED: User did not solve CAPTCHA in time (5 mins)',
    BROWSER_CLOSED: 'Browser closed unexpectedly before posting.',
} as const

export const BLOCKED_TEXT_INDICATORS = [
    'Too many requests',
    'Vui lòng xác minh',
    'Please verify',
    'xác minh rằng bạn không phải là rô-bốt',
] as const

export const EMPTY_PROFILE_INDICATORS = [
    'no content',
    'user has not published',
    'no videos yet',
    'private account',
] as const
