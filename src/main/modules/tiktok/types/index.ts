// ─── Shared types for TikTok module ───────────────────────────────────────────

export interface ScanOptions {
    limit?: number | 'unlimited'
    mode?: 'incremental' | 'batch'
    sortOrder?: 'newest' | 'oldest' | 'most_likes' | 'most_viewed'
    timeRange?: 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom_range' | 'future_only' | 'history_only' | 'history_and_future' | 'from_now'
    isBackground?: boolean
    startDate?: string   // ISO date string
    endDate?: string     // ISO date string
    onProgress?: (progress: string) => void
    cookies?: any[]      // Account cookies for authenticated scan
    sinceTimestamp?: number // Unix timestamp
}

export interface ScanResult {
    videos: VideoResult[]
    channel?: ChannelInfo | null
    duplicatesCount?: number
}

export interface VideoResult {
    id: string
    url: string
    platform_id?: string
    description?: string
    desc?: string
    thumbnail?: string
    thumb?: string
    stats?: VideoStats
    isPinned?: boolean
    dateStr?: string
}

export interface VideoStats {
    views: string | number
    likes: string | number
    comments: string | number
}

export interface ChannelInfo {
    avatar: string
    nickname: string
    bio: string
    followers: string
    following: string
    likes: string
}

export interface DownloadResult {
    filePath: string
    cached: boolean
    meta?: VideoMetadata
}

export interface VideoMetadata {
    description: string
    author?: {
        nickname: string
        avatar: string
    } | null
}

export interface PublishOptions {
    advancedVerification?: boolean
    username?: string
}

export interface DebugArtifacts {
    screenshot?: string
    html?: string
    logs?: string[]
}

export interface PublishResult {
    success: boolean
    videoUrl?: string
    error?: string
    videoId?: string
    isReviewing?: boolean
    warning?: string
    debugArtifacts?: DebugArtifacts
}
