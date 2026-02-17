export type VideoState =
    // QUEUE
    | 'SCHEDULED' | 'QUEUED' | 'PREPARING'
    // DOWNLOAD
    | 'DOWNLOAD_STARTING' | 'DOWNLOADING' | 'DOWNLOADED' | 'DOWNLOAD_FAILED'
    // EDIT
    | 'EDIT_STARTING' | 'EDITING' | 'EDITED' | 'EDIT_FAILED'
    // BROWSER
    | 'BROWSER_CHECKING' | 'BROWSER_LOGIN' | 'BROWSER_2FA' | 'BROWSER_READY' | 'BROWSER_ERROR'
    // UPLOAD
    | 'UPLOAD_PREPARING' | 'FORM_FILLING' | 'FILE_UPLOADING' | 'TIKTOK_PROCESSING' | 'FINALIZING' | 'PUBLISHED' | 'UPLOAD_FAILED' | 'REVIEWING'
    // SPECIAL
    | 'CAPTCHA_REQUIRED' | 'PAUSED' | 'RETRYING' | 'SKIPPED' | 'DUPLICATE'

export interface VideoStatus {
    state: VideoState
    message: string
    progress?: number // 0-100
    action?: 'retry' | 'captcha' | 'login' | null
    color: 'gray' | 'blue' | 'yellow' | 'purple' | 'green' | 'orange' | 'red'
    icon: string
}

export const determineVideoStatus = (video: any, downloadJob?: any, publishJob?: any): VideoStatus => {
    // 1. Check for SPECIAL states first
    // (In a real app, we might check a 'paused' flag on the video itself)

    // 3. Check Publish Job (Most recent activity usually)
    if (publishJob) {
        const status = publishJob.status;
        const data = JSON.parse(publishJob.data_json || '{}');
        const result = JSON.parse(publishJob.result_json || '{}');
        const msg = data.status || publishJob.error_message || '';

        // FAILED
        if (status === 'failed' || status.toLowerCase().startsWith('failed')) {
            if (msg.includes('CAPTCHA')) return { state: 'CAPTCHA_REQUIRED', message: '⚠️ CAPTCHA detected', color: 'orange', icon: '✋', action: 'captcha' };
            if (msg.includes('Session')) return { state: 'BROWSER_ERROR', message: 'Session expired', color: 'red', icon: '❌', action: 'login' };
            return { state: 'UPLOAD_FAILED', message: msg || 'Upload failed', color: 'red', icon: '❌', action: 'retry' };
        }

        // COMPLETED (Check if still reviewing)
        if (status === 'completed') {
            // Check result_json for is_reviewing flag or status text
            if (result.is_reviewing || msg.includes('Review') || msg.includes('Checking') || msg.toLowerCase().includes('private')) {
                return { state: 'REVIEWING', message: msg || 'Under Review', color: 'yellow', icon: '👀' };
            }
            return { state: 'PUBLISHED', message: '✅ Published', color: 'green', icon: '✅' };
        }

        // RUNNING - Map detailed messages to states
        if (status === 'running') {
            if (msg.includes('Uploading')) return { state: 'FILE_UPLOADING', message: msg, color: 'blue', icon: '📤', progress: 45 };
            if (msg.includes('Caption') || msg.includes('Setting')) return { state: 'FORM_FILLING', message: msg, color: 'yellow', icon: '✍️' };
            if (msg.includes('Post') || msg.includes('Finalizing')) return { state: 'FINALIZING', message: msg, color: 'orange', icon: '⏳' };
            if (msg.includes('Browser') || msg.includes('Login')) return { state: 'BROWSER_CHECKING', message: msg, color: 'blue', icon: '🌐' };
            if (msg.includes('Processing')) return { state: 'TIKTOK_PROCESSING', message: msg, color: 'orange', icon: '⏳' };
            // Add specific check for Reviewing if it's still running for some reason
            if (msg.includes('Review') || msg.includes('Checking')) return { state: 'REVIEWING', message: msg, color: 'yellow', icon: '👀' };

            return { state: 'UPLOAD_PREPARING', message: msg || 'Preparing upload...', color: 'yellow', icon: '📤' };
        }

        // PENDING
        if (status === 'pending') {
            return { state: 'QUEUED', message: 'Waiting for upload...', color: 'blue', icon: '📥' };
        }
    }

    // 3. Check Download Job (If publish hasn't started or is just queued)
    if (downloadJob) {
        const status = downloadJob.status;
        const data = JSON.parse(downloadJob.data_json || '{}');

        if (status === 'failed' || status.toLowerCase().startsWith('failed')) {
            return { state: 'DOWNLOAD_FAILED', message: 'Download failed', color: 'red', icon: '❌', action: 'retry' };
        }
        if (status === 'completed') {
            // If download is done but no publish job yet, we might be editing or just ready
            // For now, let's assume "Ready for Upload" or "Downloaded"
            // If we had an explicit "Edit" job, we'd check that. 
            // Since we don't have separate Edit jobs yet, we can simulate 'EDITED' or 'DOWNLOADED'.
            return { state: 'DOWNLOADED', message: 'Downloaded ready', color: 'green', icon: '✅' };
        }
        if (status === 'running') {
            return { state: 'DOWNLOADING', message: 'Downloading...', color: 'blue', icon: '⬇️' };
        }
        if (status === 'pending') {
            return { state: 'SCHEDULED', message: 'Scheduled download', color: 'gray', icon: '⏱️' };
        }
    }

    // 4. Fallback
    return { state: 'SCHEDULED', message: 'Scheduled', color: 'gray', icon: '⏱️' };
}

export const getStatusColorHex = (color: VideoStatus['color']) => {
    switch (color) {
        case 'gray': return '#9ca3af';
        case 'blue': return '#3b82f6';
        case 'yellow': return '#eab308';
        case 'purple': return '#a855f7';
        case 'green': return '#22c55e';
        case 'orange': return '#f97316';
        case 'red': return '#ef4444';
        default: return '#9ca3af';
    }
}
