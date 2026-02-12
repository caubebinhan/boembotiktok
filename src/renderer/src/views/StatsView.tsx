import React, { useState, useEffect } from 'react'

interface Stats {
    totalVideos: number
    downloadedVideos: number
    totalCampaigns: number
    activeCampaigns: number
    totalJobs: number
    completedJobs: number
    failedJobs: number
    pendingJobs: number
    totalChannels: number
    totalKeywords: number
    recentJobs: { type: string; status: string; created_at: string; completed_at?: string; campaign_name?: string }[]
}

export const StatsView: React.FC = () => {
    const [stats, setStats] = useState<Stats | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadStats()
    }, [])

    const loadStats = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-stats')
            setStats(data || null)
        } catch (err) {
            console.error('Failed to load stats:', err)
        } finally {
            setLoading(false)
        }
    }

    const successRate = stats && stats.totalJobs > 0
        ? Math.round((stats.completedJobs / stats.totalJobs) * 100)
        : 0

    const typeLabel = (type: string) => {
        const map: Record<string, { icon: string; label: string }> = {
            'SCAN': { icon: '🔍', label: 'Scan' },
            'DOWNLOAD': { icon: '📥', label: 'Download' },
            'EDIT': { icon: '✂️', label: 'Edit' },
            'PUBLISH': { icon: '📤', label: 'Publish' }
        }
        return map[type] || { icon: '⚡', label: type }
    }

    const statusColor = (status: string) => {
        const map: Record<string, string> = {
            'completed': '#4ade80', 'failed': '#fe2c55',
            'running': '#5c8afc', 'pending': '#fb923c'
        }
        return map[status] || '#aaa'
    }

    const timeSince = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 1) return 'Just now'
        if (mins < 60) return `${mins}m ago`
        const hrs = Math.floor(mins / 60)
        if (hrs < 24) return `${hrs}h ago`
        return `${Math.floor(hrs / 24)}d ago`
    }

    if (loading) {
        return (
            <div className="page-enter" style={{ padding: '24px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="spinner" style={{ width: '24px', height: '24px', marginBottom: '12px' }} />
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading statistics...</div>
                </div>
            </div>
        )
    }

    if (!stats) {
        return (
            <div className="page-enter" style={{ padding: '24px' }}>
                <div className="empty-state" style={{ padding: '60px' }}>
                    <div className="empty-icon">📊</div>
                    <div className="empty-text">Unable to load statistics</div>
                </div>
            </div>
        )
    }

    return (
        <div className="page-enter" style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', padding: '24px', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Statistics</h1>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                        Overview of your content pipeline performance
                    </p>
                </div>
                <button className="btn btn-secondary" onClick={loadStats}>
                    🔄 Refresh
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Top Stats Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
                    {/* Videos */}
                    <div className="card" style={{ padding: '20px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: '12px', right: '14px', fontSize: '28px', opacity: 0.15 }}>🎬</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                            Video Library
                        </div>
                        <div style={{ fontSize: '32px', fontWeight: 700, background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            {stats.totalVideos}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {stats.downloadedVideos} downloaded
                        </div>
                    </div>

                    {/* Campaigns */}
                    <div className="card" style={{ padding: '20px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: '12px', right: '14px', fontSize: '28px', opacity: 0.15 }}>📢</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                            Campaigns
                        </div>
                        <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--accent-teal)' }}>
                            {stats.totalCampaigns}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {stats.activeCampaigns} active
                        </div>
                    </div>

                    {/* Sources */}
                    <div className="card" style={{ padding: '20px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: '12px', right: '14px', fontSize: '28px', opacity: 0.15 }}>📡</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                            Content Sources
                        </div>
                        <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--accent-orange)' }}>
                            {stats.totalChannels + stats.totalKeywords}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {stats.totalChannels} channels · {stats.totalKeywords} keywords
                        </div>
                    </div>

                    {/* Success Rate */}
                    <div className="card" style={{ padding: '20px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: '12px', right: '14px', fontSize: '28px', opacity: 0.15 }}>✅</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                            Success Rate
                        </div>
                        <div style={{ fontSize: '32px', fontWeight: 700, color: successRate >= 80 ? 'var(--accent-green)' : successRate >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                            {successRate}%
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {stats.completedJobs} / {stats.totalJobs} jobs
                        </div>
                    </div>
                </div>

                {/* Jobs Breakdown + Recent Activity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px' }}>
                    {/* Jobs Breakdown */}
                    <div className="card" style={{ padding: '20px' }}>
                        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 600 }}>Jobs Breakdown</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {[{ label: 'Completed', count: stats.completedJobs, color: '#4ade80' },
                            { label: 'Failed', count: stats.failedJobs, color: '#fe2c55' },
                            { label: 'Pending', count: stats.pendingJobs, color: '#fb923c' }
                            ].map(item => (
                                <div key={item.label}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{item.label}</span>
                                        <span style={{ fontSize: '13px', fontWeight: 600, color: item.color }}>{item.count}</span>
                                    </div>
                                    <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                                        <div style={{
                                            width: stats.totalJobs > 0 ? `${(item.count / stats.totalJobs) * 100}%` : '0%',
                                            height: '100%', borderRadius: '3px', background: item.color,
                                            transition: 'width 0.5s ease'
                                        }} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ marginTop: '20px', padding: '14px', borderRadius: '10px', background: 'var(--bg-tertiary)', textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.totalJobs}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Jobs</div>
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="card" style={{ padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 600 }}>Recent Activity</h3>

                        {stats.recentJobs.length === 0 ? (
                            <div className="empty-state" style={{ flex: 1 }}>
                                <div className="empty-icon">💤</div>
                                <div className="empty-text">No recent activity yet. Create a campaign and run it to see activity here.</div>
                            </div>
                        ) : (
                            <div style={{ flex: 1, overflowY: 'auto' }}>
                                {stats.recentJobs.map((job, i) => {
                                    const tl = typeLabel(job.type)
                                    return (
                                        <div key={i} style={{
                                            display: 'flex', alignItems: 'center', gap: '12px',
                                            padding: '10px 0',
                                            borderBottom: i < stats.recentJobs.length - 1 ? '1px solid var(--border-primary)' : 'none'
                                        }}>
                                            <div style={{
                                                width: '36px', height: '36px', borderRadius: '10px',
                                                background: 'var(--bg-tertiary)', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center', fontSize: '16px',
                                                flexShrink: 0
                                            }}>
                                                {tl.icon}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                                    {tl.label}
                                                    {job.campaign_name && (
                                                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '6px' }}>
                                                            — {job.campaign_name}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                    {timeSince(job.created_at)}
                                                </div>
                                            </div>
                                            <div style={{
                                                padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                                                background: `${statusColor(job.status)}18`,
                                                color: statusColor(job.status)
                                            }}>
                                                {job.status.toUpperCase()}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
