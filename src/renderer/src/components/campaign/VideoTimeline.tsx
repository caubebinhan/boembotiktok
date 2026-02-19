import React, { useMemo } from 'react'
import { TimelineItem } from './TimelineItem'
import { determineVideoStatus } from '../../utils/campaignStateManager'

interface Props {
    videos: any[]
    jobs: any[]
    onAction: (action: string, id: number) => void
    campaign?: any
}

/** Extract per-source scan info from SCAN jobs */
function extractSourceScanInfo(jobs: any[]) {
    const scanJobs = jobs.filter(j => j.type === 'SCAN')
    const sources: { type: string; name: string; status: string; videoCount: number; completedAt?: string }[] = []

    for (const sj of scanJobs) {
        try {
            const data = JSON.parse(sj.data_json || '{}')
            const result = sj.result_json ? JSON.parse(sj.result_json) : null

            // Extract sources from scan data
            if (data.sources?.channels) {
                for (const ch of data.sources.channels) {
                    const existing = sources.find(s => s.type === 'channel' && s.name === ch.name)
                    if (!existing) {
                        sources.push({
                            type: 'channel',
                            name: ch.name,
                            status: sj.status === 'running' ? 'scanning' : (sj.status === 'completed' ? 'done' : sj.status),
                            videoCount: 0,
                            completedAt: sj.completed_at
                        })
                    }
                }
            }
            if (data.sources?.keywords) {
                for (const kw of data.sources.keywords) {
                    const existing = sources.find(s => s.type === 'keyword' && s.name === kw.name)
                    if (!existing) {
                        sources.push({
                            type: 'keyword',
                            name: kw.name,
                            status: sj.status === 'running' ? 'scanning' : (sj.status === 'completed' ? 'done' : sj.status),
                            videoCount: 0,
                            completedAt: sj.completed_at
                        })
                    }
                }
            }

            // Get counts from result
            if (result) {
                const totalFound = result.found || result.scheduled || 0
                // Distribute evenly if multiple sources (rough approximation)
                const srcCount = (data.sources?.channels?.length || 0) + (data.sources?.keywords?.length || 0)
                if (srcCount > 0) {
                    const perSource = Math.ceil(totalFound / srcCount)
                    sources.forEach(s => { if (s.videoCount === 0) s.videoCount = perSource })
                }
            }

            // Try to get specific per-source counts from status messages
            if (data.scannedCount) {
                sources.forEach(s => { if (s.videoCount === 0) s.videoCount = data.scannedCount })
            }
        } catch { }
    }

    return sources
}

export const VideoTimeline: React.FC<Props> = ({ videos, jobs, onAction, campaign }) => {
    // 1. Group jobs and extract video info if prop 'videos' is missing/incomplete
    const videoMap = new Map<string, { downloadJob?: any, publishJob?: any, videoInfo?: any }>()
    const scanJob = [...jobs].reverse().find(j => j.type === 'SCAN')
    const scanData = scanJob?.data_json ? (() => { try { return JSON.parse(scanJob.data_json) } catch { return {} } })() : {}

    // Track all unique videos seen in jobs
    const videosFromJobs = new Map<string, any>()

    jobs.forEach(job => {
        let videoId = null
        let videoInfo = null
        try {
            const d = JSON.parse(job.data_json || '{}')
            videoId = d.platform_id || d.video_id || d.video?.id
            videoInfo = d // The job data usually contains thumbnail, url, description etc.
        } catch { }

        if (videoId) {
            const current = videoMap.get(videoId) || {}
            if (job.type === 'DOWNLOAD') current.downloadJob = job
            // Use latest publish job
            if (job.type === 'PUBLISH') {
                if (!current.publishJob || job.id > current.publishJob.id) {
                    current.publishJob = job
                }
            }
            if (!current.videoInfo && videoInfo) current.videoInfo = videoInfo
            videoMap.set(videoId, current)

            if (!videosFromJobs.has(videoId)) {
                videosFromJobs.set(videoId, {
                    id: videoId,
                    url: videoInfo.url,
                    thumbnail: videoInfo.thumbnail,
                    description: videoInfo.caption || videoInfo.description || '',
                    stats: videoInfo.videoStats || { views: 0, likes: 0 }
                })
            }
        }
    })

    // Determine Campaign Mode & Stats
    const config = campaign?.config_json ? JSON.parse(campaign.config_json) : {}
    const hasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)
    const isChannelMode = hasSources || config.video_picker?.mode === 'channels_keywords' || campaign?.type === 'run_channel_keyword'

    // Combine prop videos with ones found in jobs (mostly for Recurrent camps)
    const combinedVideos = [...videos]
    videosFromJobs.forEach((v, id) => {
        if (!combinedVideos.some(cv => cv.id === id)) {
            combinedVideos.push(v)
        }
    })

    // Source Scan Summary
    const sourceScanInfo = useMemo(() => extractSourceScanInfo(jobs), [jobs])

    // Stats for Recurrent Mode
    const totalScanned = combinedVideos.length
    const totalDownloaded = combinedVideos.filter(v => {
        const job = videoMap.get(v.id)
        return job?.downloadJob?.status === 'completed' || v.status === 'downloaded' || v.status === 'published'
    }).length

    // Status Display
    let statusDisplay = { label: '', color: '' }
    if (isChannelMode) {
        if (campaign?.status === 'finished') {
            statusDisplay = { label: '✅ Scan Finished', color: '#10b981' }
        } else if (scanJob?.status === 'running') {
            const data = scanData.status || 'Scanning...'
            statusDisplay = { label: `🔍 ${data}`, color: '#f59e0b' }
        } else if (scanJob?.status === 'pending') {
            const scheduledFor = scanJob.scheduled_for ? new Date(scanJob.scheduled_for).toLocaleString() : ''
            statusDisplay = { label: `⏳ Scan Scheduled${scheduledFor ? ': ' + scheduledFor : ''}`, color: '#f59e0b' }
        } else if (scanData.isMonitoring) {
            statusDisplay = { label: '📡 Monitoring', color: '#8b5cf6' }
        } else if (campaign?.status === 'active') {
            statusDisplay = { label: '⚡ Active (Idling)', color: '#3b82f6' }
        } else {
            statusDisplay = { label: campaign?.status || 'Active', color: 'var(--text-muted)' }
        }
    }

    // Sort videos
    const sortedVideos = [...combinedVideos].sort((a, b) => {
        const jobA = videoMap.get(a.id)?.downloadJob || videoMap.get(a.id)?.publishJob
        const jobB = videoMap.get(b.id)?.downloadJob || videoMap.get(b.id)?.publishJob
        if (jobA?.scheduled_for && jobB?.scheduled_for) {
            return jobA.scheduled_for.localeCompare(jobB.scheduled_for)
        }
        return b.id.toString().localeCompare(a.id.toString())
    })

    return (
        <div style={{ padding: '0 32px 32px 80px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '24px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                    🕐 VIDEO TIMELINE
                </div>
                {isChannelMode && (
                    <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                        <div style={{ background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-primary)' }}>
                            🔍 Scanned: <span style={{ fontWeight: 600 }}>{totalScanned}</span>
                        </div>
                        <div style={{ background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-primary)' }}>
                            ⬇️ Downloaded: <span style={{ fontWeight: 600 }}>{totalDownloaded}</span>
                        </div>
                        <div style={{ background: statusDisplay.color + '20', color: statusDisplay.color, padding: '4px 8px', borderRadius: '4px', fontWeight: 600, border: `1px solid ${statusDisplay.color}40` }}>
                            {statusDisplay.label}
                        </div>
                    </div>
                )}
            </div>

            {/* Source Scan Summary — Shows which channels/keywords are being scanned */}
            {isChannelMode && sourceScanInfo.length > 0 && (
                <div style={{
                    marginBottom: '20px', padding: '12px 16px',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                    borderRadius: '10px'
                }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '10px', letterSpacing: '0.4px' }}>
                        📋 SOURCE SCAN SUMMARY
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {sourceScanInfo.map((src, i) => (
                            <div key={`${src.type}-${src.name}-${i}`} style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '6px 12px', borderRadius: '8px', fontSize: '12px',
                                background: src.status === 'scanning' ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${src.status === 'scanning' ? 'rgba(59,130,246,0.3)' : 'var(--border-subtle)'}`,
                            }}>
                                <span>{src.type === 'channel' ? '📺' : '🔍'}</span>
                                <span style={{ fontWeight: 600 }}>
                                    {src.type === 'channel' ? `@${src.name}` : `"${src.name}"`}
                                </span>
                                {src.status === 'scanning' && (
                                    <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '1.5px' }} />
                                )}
                                <span style={{
                                    color: src.status === 'scanning' ? '#60a5fa' : (src.status === 'done' ? '#4ade80' : 'var(--text-muted)'),
                                    fontSize: '11px'
                                }}>
                                    {src.status === 'scanning' ? 'Scanning...' :
                                        src.status === 'done' ? `${src.videoCount} videos` :
                                            src.status === 'pending' ? 'Queued' : src.status}
                                </span>
                                {src.completedAt && src.status === 'done' && (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                        · {new Date(src.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {sortedVideos.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                    No videos in timeline.
                </div>
            ) : (
                sortedVideos.map(video => {
                    const jobState = videoMap.get(video.id)
                    const status = determineVideoStatus(video, jobState?.downloadJob, jobState?.publishJob)

                    let source = null
                    try {
                        if (jobState?.downloadJob?.data_json) {
                            source = JSON.parse(jobState.downloadJob.data_json).source
                        } else if (video.data_json) {
                            source = JSON.parse(video.data_json).source
                        } else if (video.source) {
                            source = video.source
                        }
                    } catch { }

                    return (
                        <TimelineItem
                            key={video.id}
                            video={video}
                            status={status}
                            source={source}
                            downloadJob={jobState?.downloadJob}
                            publishJob={jobState?.publishJob}
                            onAction={onAction}
                        />
                    )
                })
            )}
        </div>
    )
}
