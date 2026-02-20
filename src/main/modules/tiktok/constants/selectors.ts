// ─── TikTok DOM Selectors ─────────────────────────────────────────────────────

export const TIKTOK_SELECTORS = {
    PROFILE: {
        POST_ITEM: '[data-e2e="user-post-item"]',
        USER_TITLE: '[data-e2e="user-title"]',
        USER_BIO: '[data-e2e="user-bio"]',
        FOLLOWERS_COUNT: '[data-e2e="followers-count"]',
        FOLLOWING_COUNT: '[data-e2e="following-count"]',
        LIKES_COUNT: '[data-e2e="likes-count"]',
    },

    CONTENT: [
        '[data-e2e="user-post-item"]',
        '[data-e2e="search_top-item"]',
        'div[class*="DivItemContainer"]',
        '.tiktok-feed-item',
        'a[href*="/video/"]',
    ].join(','),

    UPLOAD: {
        FILE_INPUT: 'input[type="file"]',
        UPLOAD_BUTTONS: [
            '[data-e2e="upload-icon"]',
            '[data-e2e="file-upload-container"]',
            '[data-e2e="upload-video-button"]',
            'div[class*="upload-btn"]',
            'div[class*="upload-container"]',
            '.upload-btn-input',
            'div[role="button"][class*="upload"]',
            'div[role="button"][class*="select"]',
        ] as string[],
        CAPTION_INPUTS: [
            '[data-e2e="caption-input"]',
            '.public-DraftEditor-content',
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"].notranslate',
            'div[contenteditable="true"][data-placeholder]',
            '[contenteditable="true"]',
        ] as string[],
        POST_BUTTONS: [
            '[data-e2e="post-video-button"]',
            '[data-e2e="post-button"]',
            'div[class*="btn-post"]',
        ] as string[],
        READY_INDICATORS: [
            '[data-e2e="caption-input"]',
            '.public-DraftEditor-content',
            '[data-e2e="post-button"]',
            '[data-e2e="post-video-button"]',
        ] as string[],
        CONFIRM_POST: [
            'button:has-text("Post now")',
            'button:has-text("Vẫn đăng")',
            'button:has-text("Continue")',
            'button:has-text("Post anyway")',
            'div[role="dialog"] button:has-text("Post")',
            'div[role="dialog"] button:has-text("Đăng")',
        ] as string[],
    },

    CAPTCHA: [
        '#captcha_container',
        '.verify-wrap',
        '[data-e2e="captcha-card"]',
        '.tiktok-captcha-container',
        'div[class*="captcha"]',
        'iframe[src*="captcha"]',
        '.captcha-verify-container',
        '.captcha_verify_container',
    ] as string[],

    OVERLAYS: [
        'button[aria-label="Close"]',
        'button[aria-label="close"]',
        'svg[data-icon="close"]',
        'div[role="dialog"] button[aria-label="Close"]',
        '[data-e2e="modal-close-inner-button"]',
        '[data-e2e="modal-close-button"]',
        '.tiktok-cookie-setting-modal-close',
        'button:has-text("Decline all")',
        'button:has-text("Accept all")',
        'button:has-text("Từ chối tất cả")',
        'button:has-text("Chấp nhận tất cả")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Decline")',
    ] as string[],

    VIDEO_DESC: [
        '[data-e2e="browse-video-desc"]',
        '[data-e2e="video-desc"]',
    ] as string[],
} as const
