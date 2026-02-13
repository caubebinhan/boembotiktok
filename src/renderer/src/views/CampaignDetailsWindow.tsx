import React, { useState, useEffect, useCallback } from 'react'
import { VideoCard } from '../components/VideoCard'
import { formatFrequency, formatDateTime } from '../utils/formatters'

interface Props {
    id: number
}

export const CampaignDetailsWindow: React.FC<Props> = ({ id }) => {
    const [campaign, setCampaign] = useState<any>(null)
    const [config, setConfig] = useState<any>(null)
    const [activeTab, setActiveTab] = useState<'overview' | 'content' | 'jobs'>('overview')
    const [jobs, setJobs] = useState<any[]>([])
    const [stats, setStats] = useState({ scanned: 0, pending: 0, downloading: 0, completed: 0, published: 0, failed: 0 })

    const loadCampaign = useCallback(async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-campaigns')
            const c = data.find((c: any) => c.id === Number(id))
            if (c) {
                setCampaign(c)
                try { setConfig(JSON.parse(c.config_json)) } catch { setConfig({}) }
            }
        } catch (err) { console.error(err) }
    }, [id])

    const loadJobs = useCallback(async () => {
        try {
            // @ts-ignore
            const campaignJobs = await window.api.invoke('get-campaign-jobs', Number(id))
            setJobs(campaignJobs || [])

            // Calculate stats from job data
            const s = { scanned: 0, pending: 0, downloading: 0, completed: 0, published: 0, failed: 0, scanning: false }
                ; (campaignJobs || []).forEach((j: any) => {
                    if (j.type === 'SCAN' && j.status === 'completed') {
                        try {
                            const res = JSON.parse(j.result_json || '{}')
                            s.scanned += (res.found || 0)
                        } catch { }
                    }
                    if (j.type === 'SCAN' && j.status === 'running') s.scanning = true
                    if (j.type === 'DOWNLOAD') {
                        if (j.status === 'pending') s.pending++
                        if (j.status === 'running') s.downloading++
                        if (j.status === 'completed') s.completed++
                        if (j.status === 'failed') s.failed++
                    }
                    if (j.type === 'PUBLISH' && j.status === 'completed') s.published++
                    if (j.type === 'PUBLISH' && j.status === 'failed') s.failed++
                })
            setStats(s)
        } catch (e) { console.error(e) }
    }, [id])

    useEffect(() => {
        loadCampaign()
        loadJobs()
        const interval = setInterval(loadJobs, 3000)
        return () => clearInterval(interval)
    }, [id, loadCampaign, loadJobs])

    const handleRunNow = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('trigger-campaign', id)
            loadJobs()
        } catch (e) { console.error(e) }
    }

    const handleRemoveSource = async (type: 'channel' | 'keyword', name: string) => {
        if (!confirm(`Remove ${type} "${name}"?`)) return
        const newConfig = { ...config }
        if (type === 'channel') {
            newConfig.sources.channels = newConfig.sources.channels.filter((c: any) => c.name !== name)
        } else {
            newConfig.sources.keywords = newConfig.sources.keywords.filter((k: any) => k.name !== name)
        }
        await updateConfig(newConfig)
    }

    const handleRemoveVideo = async (videoId: string) => {
        if (!confirm('Remove video target?')) return
        const newConfig = { ...config }
        newConfig.videos = newConfig.videos.filter((v: any) => v.id !== videoId)
        await updateConfig(newConfig)
    }

    const updateConfig = async (newConfig: any) => {
        try {
            // @ts-ignore
            await window.api.invoke('update-campaign-config', id, newConfig)
            setConfig(newConfig)
            loadCampaign()
        } catch (e) { console.error(e) }
    }

    const handleOpenFolder = async (path: string) => {
        // @ts-ignore
        await window.api.invoke('open-path', path)
    }

    const handleOpenScanner = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('open-scanner-window')
        } catch (err) { console.error('Failed to open scanner:', err) }
    }

    const handlePauseJob = async (jobId: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('job:pause', jobId)
            loadJobs()
        } catch (e) { console.error(e) }
    }

    const handleResumeJob = async (jobId: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('job:resume', jobId)
            loadJobs()
        } catch (e) { console.error(e) }
    }

    const handleRetryJob = async (jobId: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('job:retry', jobId)
            loadJobs()
        } catch (e) { console.error(e) }
    }

    const handleRetryAll = async () => {
        if (!confirm('Retry all failed jobs?')) return
        try {
            // @ts-ignore
            await window.api.invoke('job:retry-all', Number(id))
            loadJobs()
        } catch (e) { console.error(e) }
    }

    // Listen for scanner results
    useEffect(() => {
        // ... (unchanged)
        const removeListener = window.api.on('scanner-results-received', async (results: any) => {
            if (!results || !config) return
            let newConfig = { ...config }
            if (!newConfig.sources) newConfig.sources = { channels: [], keywords: [] }
            if (!newConfig.sources.channels) newConfig.sources.channels = []
            if (!newConfig.sources.keywords) newConfig.sources.keywords = []
            if (!newConfig.videos) newConfig.videos = []
            let added = 0
            if (results.channels) {
                for (const ch of results.channels) {
                    if (!newConfig.sources.channels.some((c: any) => c.name === ch.name)) {
                        newConfig.sources.channels.push(ch)
                        added++
                    }
                }
            }
            if (results.keywords) {
                for (const kw of results.keywords) {
                    if (!newConfig.sources.keywords.some((k: any) => k.name === kw.name)) {
                        newConfig.sources.keywords.push(kw)
                        added++
                    }
                }
            }
            if (results.videos && Array.isArray(results.videos)) {
                const newVids = results.videos.filter((v: any) => v.selected !== false)
                const existingIds = new Set(newConfig.videos.map((v: any) => v.id))
                const unique = newVids.filter((v: any) => !existingIds.has(v.id)).map((v: any) => ({
                    id: v.id, url: v.url, description: v.description || '',
                    thumbnail: v.thumbnail || '', stats: v.stats || { views: 0, likes: 0, comments: 0 }
                }))
                if (unique.length > 0) {
                    newConfig.videos = [...newConfig.videos, ...unique]
                    added += unique.length
                }
            }
            if (added > 0) await updateConfig(newConfig)
        })
        return () => removeListener()
    }, [config, id])

    if (!campaign || !config) return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ width: '32px', height: '32px' }} />
        </div>
    )

    const channels = config.sources?.channels || []
    const keywords = config.sources?.keywords || []
    const videos = config.videos || []

    // Job type styling
    const typeStyles: Record<string, { bg: string; color: string; icon: string }> = {
        'SCAN': { bg: 'rgba(37, 244, 238, 0.12)', color: '#25f4ee', icon: '🔍' },
        'DOWNLOAD': { bg: 'rgba(255, 152, 0, 0.12)', color: '#ff9800', icon: '⬇️' },
        'PUBLISH': { bg: 'rgba(76, 175, 80, 0.12)', color: '#4caf50', icon: '🚀' },
    }

    const statusStyles: Record<string, { bg: string; color: string; dot: string }> = {
        'pending': { bg: 'rgba(250, 204, 21, 0.12)', color: '#facc15', dot: '⏳' },
        'running': { bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', dot: '⚡' },
        'completed': { bg: 'rgba(74, 222, 128, 0.12)', color: '#4ade80', dot: '✅' },
        'failed': { bg: 'rgba(254, 44, 85, 0.12)', color: '#fe2c55', dot: '❌' },
        'paused': { bg: 'rgba(168, 162, 158, 0.12)', color: '#a8a29e', dot: '⏸️' },
    }

    const getJobProgress = (job: any) => {
        try {
            const data = JSON.parse(job.data_json || '{}')
            return data.status || null
        } catch { return null }
    }

    // Extract video info from job data for display
    const getJobVideoInfo = (job: any) => {
        try {
            const data = JSON.parse(job.data_json || '{}')
            return {
                thumbnail: data.thumbnail || '',
                description: data.description || data.caption || '',
                views: data.videoStats?.views || 0,
                likes: data.videoStats?.likes || 0,
                accountName: data.account_name || ''
            }
        } catch { return null }
    }

    // ─── RENDER ────────────────────────────────────────────────────
    return (
        <div className="page-enter" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>

            {/* ═══ HEADER ═══ */}
            <header style={{
                padding: '20px 28px', borderBottom: '1px solid var(--border-primary)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--bg-secondary)'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {campaign.name}
                        <span style={{
                            padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                            background: campaign.status === 'active' ? 'rgba(74,222,128,0.15)' : 'rgba(168,162,158,0.15)',
                            color: campaign.status === 'active' ? '#4ade80' : '#a8a29e'
                        }}>
                            {campaign.status?.toUpperCase()}
                        </span>
                    </h1>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <span>📋 {campaign.type === 'one_time' ? 'One-time' : 'Scheduled'}</span>
                        <span>📅 {formatFrequency(campaign)}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-secondary" onClick={handleOpenScanner}>🔍 Scan More</button>
                    <button className="btn btn-secondary" onClick={() => { loadCampaign(); loadJobs() }}>🔄 Refresh</button>
                    <button className="btn btn-primary" onClick={handleRunNow}>▶ Run Now</button>
                </div>
            </header>

            {/* ═══ TABS ═══ */}
            <div className="tabs" style={{ padding: '0 28px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                {([
                    { key: 'overview', label: '📊 Overview', count: null },
                    { key: 'content', label: '📡 Sources & Videos', count: channels.length + keywords.length + videos.length },
                    { key: 'jobs', label: '⚡ Job History', count: jobs.length },
                ] as const).map(tab => (
                    <button
                        key={tab.key}
                        className={`tab ${activeTab === tab.key ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.key)}
                        style={{ padding: '14px 20px', fontSize: '14px' }}
                    >
                        {tab.label} {tab.count !== null && <span style={{ opacity: 0.6, fontSize: '12px' }}>({tab.count})</span>}
                    </button>
                ))}
            </div>

            {/* ═══ CONTENT ═══ */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

                {/* ─── OVERVIEW TAB ─── */}
                {activeTab === 'overview' && (
                    <div>
                        {/* Stats Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '14px', marginBottom: '28px' }}>
                            {[
                                { label: 'Scanned', value: stats.scanned, color: '#25f4ee', icon: '🔍' },
                                { label: 'Pending', value: stats.pending, color: '#facc15', icon: '⏳' },
                                { label: 'Downloading', value: stats.downloading, color: '#3b82f6', icon: '⬇️' },
                                { label: 'Completed', value: stats.completed, color: '#4ade80', icon: '✅' },
                                { label: 'Published', value: stats.published, color: '#4caf50', icon: '🚀' },
                                { label: 'Failed', value: stats.failed, color: '#fe2c55', icon: '❌' },
                            ].map(stat => (
                                <div key={stat.label} style={{
                                    background: `${stat.color}10`, padding: '18px', borderRadius: '12px',
                                    border: `1px solid ${stat.color}30`, textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '12px', marginBottom: '6px' }}>{stat.icon}</div>
                                    <div style={{ fontSize: '28px', fontWeight: 700, color: stat.color }}>{stat.value}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{stat.label}</div>
                                </div>
                            ))}
                        </div>

                        {/* Scanning status */}
                        {(stats as any).scanning && (
                            <div style={{
                                background: 'rgba(37, 244, 238, 0.08)', padding: '14px 20px', borderRadius: '10px',
                                border: '1px solid rgba(37, 244, 238, 0.2)', marginBottom: '24px',
                                display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px'
                            }}>
                                <span className="spinner" style={{ width: '16px', height: '16px' }} />
                                🔍 <strong>Scanning channels & keywords...</strong> Waiting for schedule generation
                            </div>
                        )}

                        {/* Published count */}
                        {stats.published > 0 && (
                            <div style={{
                                background: 'rgba(76,175,80,0.08)', padding: '14px 20px', borderRadius: '10px',
                                border: '1px solid rgba(76,175,80,0.2)', marginBottom: '24px',
                                display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px'
                            }}>
                                🚀 <strong>{stats.published}</strong> videos published successfully
                            </div>
                        )}

                        {stats.failed > 0 && (
                            <div style={{
                                background: 'rgba(254,44,85,0.08)', padding: '14px 20px', borderRadius: '10px',
                                border: '1px solid rgba(254,44,85,0.2)', marginBottom: '24px',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '14px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    ❌ <strong>{stats.failed}</strong> jobs failed.
                                </div>
                                <button onClick={handleRetryAll} style={{
                                    background: 'rgba(254,44,85,0.1)', color: '#fe2c55', border: '1px solid #fe2c55',
                                    fontWeight: 600, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '6px'
                                }}>
                                    🔄 Retry All Failed
                                </button>
                            </div>
                        )}

                        {/* Campaign Info + Timeline side by side */}
                        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px' }}>

                            {/* Left: Campaign Info */}
                            <div style={{
                                background: 'var(--bg-secondary)', borderRadius: '12px',
                                border: '1px solid var(--border-primary)', padding: '20px'
                            }}>
                                <h3 style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Campaign Info</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>Type</div>
                                        <div style={{ fontWeight: 600 }}>{campaign.type === 'one_time' ? '📋 One-Time' : '🔄 Scheduled'}</div>
                                    </div>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>Schedule</div>
                                        <div style={{ fontWeight: 600 }}>{formatFrequency(campaign)}</div>
                                    </div>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>Sources</div>
                                        <div>{channels.length} channels, {keywords.length} keywords</div>
                                    </div>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>Target Videos</div>
                                        <div>{videos.length} videos</div>
                                    </div>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>Target Accounts</div>
                                        <div>{config.targetAccounts?.length || 0} accounts</div>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Visual Job Timeline */}
                            <div style={{
                                background: 'var(--bg-secondary)', borderRadius: '12px',
                                border: '1px solid var(--border-primary)', padding: '20px',
                                maxHeight: '500px', overflowY: 'auto'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Job Timeline</h3>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{jobs.length} jobs</span>
                                </div>

                                {jobs.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                                        <div style={{ fontSize: '32px', marginBottom: '10px' }}>📋</div>
                                        <div>No jobs yet. Click "Run Now" to start.</div>
                                    </div>
                                ) : (
                                    <div className="job-timeline">
                                        {(() => {
                                            // Group jobs by video
                                            const timelineItems: any[] = []
                                            const videoMap = new Map<string, any>()

                                            // Process jobs in reverse chronological order (newest first)
                                            // But for grouping, we want to find associated pairs.
                                            // Let's iterate all jobs
                                            const sortedJobs = [...jobs].sort((a, b) => b.id - a.id)

                                            sortedJobs.forEach(job => {
                                                if (job.type === 'SCAN') {
                                                    timelineItems.push({ type: 'SCAN', job, date: job.created_at })
                                                } else {
                                                    // Try to find video ID
                                                    let videoId = null
                                                    try {
                                                        const d = JSON.parse(job.data_json || '{}')
                                                        // platform_id is the common key for TikTok videos
                                                        videoId = d.platform_id || d.video_id || d.video?.id
                                                    } catch { }

                                                    if (!videoId) {
                                                        timelineItems.push({ type: 'OTHER', job, date: job.created_at })
                                                    } else {
                                                        if (!videoMap.has(videoId)) {
                                                            const item = {
                                                                type: 'VIDEO_PROCESS',
                                                                videoId,
                                                                videoInfo: getJobVideoInfo(job),
                                                                downloadJob: null,
                                                                publishJob: null,
                                                                date: job.created_at // Initial date
                                                            }
                                                            videoMap.set(videoId, item)
                                                            timelineItems.push(item)
                                                        }
                                                        const item = videoMap.get(videoId)
                                                        if (job.type === 'DOWNLOAD') item.downloadJob = job
                                                        if (job.type === 'PUBLISH') item.publishJob = job
                                                        // Update date to latest interaction? Or keep earliest?
                                                        // Usually we want to verify order in list.
                                                    }
                                                }
                                            })

                                            // Sort items by ID/Date
                                            timelineItems.sort((a, b) => {
                                                const dateA = a.type === 'VIDEO_PROCESS' ? (a.publishJob?.id || a.downloadJob?.id) : a.job.id
                                                const dateB = b.type === 'VIDEO_PROCESS' ? (b.publishJob?.id || b.downloadJob?.id) : b.job.id
                                                return dateB - dateA
                                            })

                                            return timelineItems.slice(0, 30).map((item, i) => {
                                                if (item.type === 'SCAN') {
                                                    const job = item.job
                                                    const ss = statusStyles[job.status] || statusStyles['pending']
                                                    const progress = getJobProgress(job)
                                                    return (
                                                        <div key={job.id} className="timeline-item" style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
                                                            <div style={{ width: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(37, 244, 238, 0.12)', border: '2px solid #25f4ee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔍</div>
                                                                {i < timelineItems.length - 1 && <div style={{ width: '2px', flex: 1, background: 'var(--border-primary)', minHeight: '16px' }} />}
                                                            </div>
                                                            <div style={{ flex: 1, padding: '10px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>Scan Sources</div>
                                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatDateTime(job.scheduled_for || job.created_at)}</span>
                                                                </div>
                                                                <div style={{ fontSize: '12px', color: ss.color, marginTop: '4px' }}>{ss.dot} {job.status} {progress ? `- ${progress}` : ''}</div>
                                                            </div>
                                                        </div>
                                                    )
                                                } else if (item.type === 'VIDEO_PROCESS') {
                                                    const { videoInfo, downloadJob, publishJob } = item
                                                    const dStatus = downloadJob ? (statusStyles[downloadJob.status] || statusStyles['pending']) : { color: 'var(--text-muted)', dot: '⭕' }
                                                    const pStatus = publishJob ? (statusStyles[publishJob.status] || statusStyles['pending']) : { color: 'var(--text-muted)', dot: '⭕' }

                                                    return (
                                                        <div key={item.videoId} className="timeline-item" style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
                                                            <div style={{ width: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(124, 92, 252, 0.12)', border: '2px solid var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                                                    {videoInfo?.thumbnail ? <img src={videoInfo.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🎬'}
                                                                </div>
                                                                {i < timelineItems.length - 1 && <div style={{ width: '2px', flex: 1, background: 'var(--border-primary)', minHeight: '16px' }} />}
                                                            </div>
                                                            <div style={{ flex: 1, padding: '10px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                                                                <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                                                                    <div style={{ fontWeight: 600, fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {videoInfo?.description || 'Untitled Video'}
                                                                    </div>
                                                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                                        {formatDateTime((downloadJob?.scheduled_for || downloadJob?.created_at))}
                                                                    </span>
                                                                </div>

                                                                {/* STEPS */}
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                    {/* Download Step */}
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                                                        <div style={{ width: '16px', textAlign: 'center' }}>⬇️</div>
                                                                        <div style={{ flex: 1, color: downloadJob ? dStatus.color : 'var(--text-muted)' }}>
                                                                            {downloadJob ? `Download: ${downloadJob.status}` : 'Download Pending'}
                                                                            {downloadJob?.status === 'failed' && (
                                                                                <button className="btn-link" onClick={() => handleRetryJob(downloadJob.id)} style={{ marginLeft: '8px', color: '#facc15' }}>Retry</button>
                                                                            )}
                                                                        </div>
                                                                        {downloadJob?.result_json && (() => {
                                                                            try {
                                                                                const res = JSON.parse(downloadJob.result_json)
                                                                                if (res.path) return (
                                                                                    <button className="btn-link" onClick={() => handleOpenFolder(res.path)}>📂 Open</button>
                                                                                )
                                                                            } catch { }
                                                                        })()}
                                                                    </div>

                                                                    {/* Connector */}
                                                                    <div style={{ marginLeft: '7px', height: '8px', width: '2px', background: 'var(--border-primary)' }} />

                                                                    {/* Publish Step */}
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                                                        <div style={{ width: '16px', textAlign: 'center' }}>🚀</div>
                                                                        <div style={{ flex: 1, color: publishJob ? pStatus.color : 'var(--text-muted)' }}>
                                                                            {publishJob ? `Publish: ${publishJob.status}` : 'Publish Pending'}
                                                                            {publishJob?.status === 'failed' && (
                                                                                <button className="btn-link" onClick={() => handleRetryJob(publishJob.id)} style={{ marginLeft: '8px', color: '#facc15' }}>Retry</button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )
                                                }
                                                return null
                                            })
                                        })()}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── SOURCES & VIDEOS TAB ─── */}
                {activeTab === 'content' && (
                    <div>
                        {/* Sources section */}
                        <div style={{ marginBottom: '30px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                <h3 style={{ margin: 0, fontSize: '16px' }}>📡 Sources ({channels.length + keywords.length})</h3>
                                <button className="btn btn-secondary btn-sm" onClick={handleOpenScanner}>+ Add Source</button>
                            </div>

                            {channels.length === 0 && keywords.length === 0 ? (
                                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-primary)', borderRadius: '10px' }}>
                                    No sources configured. Click "Scan More" to add channels or keywords.
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                                    {channels.map((c: any) => (
                                        <div key={c.name} style={{
                                            display: 'flex', gap: '12px', alignItems: 'center',
                                            padding: '14px', borderRadius: '10px',
                                            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)'
                                        }}>
                                            <div style={{
                                                width: '44px', height: '44px', borderRadius: '50%',
                                                background: 'linear-gradient(135deg, #25f4ee, #fe2c55)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '20px', flexShrink: 0, overflow: 'hidden'
                                            }}>
                                                {c.metadata?.avatar ? (
                                                    <img src={c.metadata.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : '📺'}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: '14px' }}>@{c.name}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Channel</div>
                                            </div>
                                            <button className="btn btn-ghost btn-sm" style={{ color: '#fe2c55' }}
                                                onClick={() => handleRemoveSource('channel', c.name)}>🗑️</button>
                                        </div>
                                    ))}
                                    {keywords.map((k: any) => (
                                        <div key={k.name} style={{
                                            display: 'flex', gap: '12px', alignItems: 'center',
                                            padding: '14px', borderRadius: '10px',
                                            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)'
                                        }}>
                                            <div style={{
                                                width: '44px', height: '44px', borderRadius: '50%',
                                                background: 'linear-gradient(135deg, #ff9800, #ff5722)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '20px', flexShrink: 0
                                            }}>🔍</div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: '14px' }}>"{k.name}"</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Keyword</div>
                                            </div>
                                            <button className="btn btn-ghost btn-sm" style={{ color: '#fe2c55' }}
                                                onClick={() => handleRemoveSource('keyword', k.name)}>🗑️</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Videos section */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                <h3 style={{ margin: 0, fontSize: '16px' }}>🎬 Target Videos ({videos.length})</h3>
                                <button className="btn btn-secondary btn-sm" onClick={handleOpenScanner}>+ Add Videos</button>
                            </div>

                            {videos.length === 0 ? (
                                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-primary)', borderRadius: '10px' }}>
                                    No manual videos added. Videos from scanned sources will appear in Job History.
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                                    {videos.map((v: any) => (
                                        <VideoCard key={v.id} video={v} onRemove={() => handleRemoveVideo(v.id)} showStats={true} />
                                    ))}
                                    <button style={{
                                        minHeight: '220px', display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center', gap: '10px',
                                        border: '2px dashed var(--border-primary)', borderRadius: '12px',
                                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                                        fontSize: '14px', transition: 'all 0.2s'
                                    }} onClick={handleOpenScanner}>
                                        Scan More Videos
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ─── JOB HISTORY TAB ─── */}
                {activeTab === 'jobs' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                            <h3 style={{ margin: 0 }}>Job History</h3>
                            <button className="btn btn-secondary btn-sm" onClick={loadJobs}>🔄 Refresh</button>
                        </div>

                        {jobs.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                No jobs found for this campaign.
                            </div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Type</th>
                                        <th>Video</th>
                                        <th>Status</th>
                                        <th>Scheduled</th>
                                        <th>Progress</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {jobs.map(job => {
                                        const ts = typeStyles[job.type] || typeStyles['SCAN']
                                        const ss = statusStyles[job.status] || statusStyles['pending']
                                        const progress = getJobProgress(job)

                                        return (
                                            <tr key={job.id}>
                                                <td>#{job.id}</td>
                                                <td>
                                                    <span style={{
                                                        padding: '3px 8px', borderRadius: '6px', fontSize: '11px',
                                                        fontWeight: 600, background: ts.bg, color: ts.color
                                                    }}>
                                                        {ts.icon} {job.type}
                                                    </span>
                                                </td>
                                                <td>
                                                    {(job.type === 'DOWNLOAD' || job.type === 'PUBLISH') && (() => {
                                                        const vi = getJobVideoInfo(job)
                                                        if (!vi) return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                                                        return (
                                                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                                {vi.thumbnail && (
                                                                    <img src={vi.thumbnail} alt="" style={{ width: '28px', height: '36px', borderRadius: '3px', objectFit: 'cover' }} />
                                                                )}
                                                                <div style={{ fontSize: '11px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                                                                    {vi.description || 'Video'}
                                                                    {vi.accountName && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>→ @{vi.accountName}</div>}
                                                                </div>
                                                            </div>
                                                        )
                                                    })() || <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>}
                                                </td>
                                                <td>
                                                    <span style={{
                                                        padding: '3px 8px', borderRadius: '6px', fontSize: '11px',
                                                        fontWeight: 600, background: ss.bg, color: ss.color,
                                                        display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                    }}>
                                                        {ss.dot} {job.status}
                                                        {job.status === 'running' && <span className="spinner" style={{ width: '10px', height: '10px' }} />}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '12px' }}>
                                                    {job.scheduled_for ? formatDateTime(job.scheduled_for) : 'Immediate'}
                                                </td>
                                                <td style={{ fontSize: '12px', fontFamily: 'monospace', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {progress || (job.error_message ? `Error: ${job.error_message}` : '—')}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        {job.status === 'pending' && (
                                                            <button className="btn btn-ghost btn-sm" onClick={() => handlePauseJob(job.id)} title="Pause">⏸️</button>
                                                        )}
                                                        {job.status === 'paused' && (
                                                            <button className="btn btn-ghost btn-sm" onClick={() => handleResumeJob(job.id)} title="Resume">▶️</button>
                                                        )}
                                                        {job.status === 'failed' && (
                                                            <button className="btn btn-ghost btn-sm" onClick={() => handleRetryJob(job.id)} title="Retry" style={{ color: '#facc15' }}>🔄</button>
                                                        )}
                                                        {(job.status === 'completed' && job.type === 'DOWNLOAD' && job.result_json) && (
                                                            <button className="btn btn-ghost btn-sm" onClick={() => {
                                                                try {
                                                                    const res = JSON.parse(job.result_json)
                                                                    if (res.path) handleOpenFolder(res.path)
                                                                } catch { }
                                                            }} title="Open folder">📂</button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
