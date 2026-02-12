/**
 * Shared type definitions between Main and Renderer processes.
 */

// ========== Database Entities ==========

export interface Campaign {
    id: number
    name: string
    platform: string
    source_account_id: number | null
    target_account_id: number | null
    status: 'active' | 'paused' | 'completed' | 'error'
    schedule_cron: string | null
    created_at: string
    updated_at: string
}

export interface Job {
    id: number
    campaign_id: number
    video_id: number
    type: 'download' | 'process' | 'publish'
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    priority: number
    retry_count: number
    max_retries: number
    error_message: string | null
    started_at: string | null
    completed_at: string | null
    created_at: string
}

export interface Video {
    id: number
    platform: string
    platform_id: string
    url: string
    title: string | null
    description: string | null
    duration: number | null
    local_path: string | null
    processed_path: string | null
    status: 'discovered' | 'downloading' | 'downloaded' | 'processing' | 'processed' | 'publishing' | 'published' | 'failed'
    metadata: string | null // JSON string
    created_at: string
    updated_at: string
}

export interface VideoSource {
    id: number
    video_id: number
    source_type: 'profile' | 'feed' | 'search' | 'manual'
    source_url: string
    discovered_at: string
}

export interface Account {
    id: number
    platform: string
    username: string
    role: 'source' | 'target'
    session_valid: boolean
    proxy_url: string | null
    last_checked_at: string | null
    created_at: string
}

export interface RateLimit {
    id: number
    platform: string
    action: string
    max_requests: number
    window_seconds: number
    current_count: number
    window_start: string
}

export interface Setting {
    key: string
    value: string
    updated_at: string
}

// ========== IPC Channels ==========

export const IPC_CHANNELS = {
    // Campaign
    CAMPAIGN_LIST: 'campaign:list',
    CAMPAIGN_CREATE: 'campaign:create',
    CAMPAIGN_UPDATE: 'campaign:update',
    CAMPAIGN_DELETE: 'campaign:delete',

    // Job
    JOB_LIST: 'job:list',
    JOB_START: 'job:start',
    JOB_CANCEL: 'job:cancel',
    JOB_PROGRESS: 'job:progress',

    // Video
    VIDEO_LIST: 'video:list',
    VIDEO_ADD: 'video:add',

    // Settings
    SETTINGS_GET: 'settings:get',
    SETTINGS_SET: 'settings:set',

    // System
    SYSTEM_INFO: 'system:info'
} as const
