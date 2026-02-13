import React, { useState, useEffect } from 'react'

interface Job {
    id: number
    campaign_id: number
    campaign_name?: string
    type: string
    platform_id?: string
    status: string
    progress?: number
    result_json?: string
    error_message?: string
    created_at: string
    started_at?: string
    completed_at?: string
    data_json?: string
}

export const ScheduleView: React.FC = () => {
    const [jobs, setJobs] = useState<Job[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'pending' | 'paused'>('all')

    useEffect(() => {
        loadJobs()
        // @ts-ignore
        const remove = window.api.on('jobs-updated', (updated: Job[]) => {
            setJobs(updated || [])
        })
        return () => remove()
    }, [])

    const loadJobs = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-jobs')
            setJobs(data || [])
        } catch (e) {
            console.error('Failed to load jobs:', e)
        } finally {
            setLoading(false)
        }
    }

    const handlePause = async (jobId: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('job:pause', jobId)
            loadJobs()
        } catch (e) {
            console.error('Failed to pause job:', e)
        }
    }

    const handleResume = async (jobId: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('job:resume', jobId)
            loadJobs()
        } catch (e) {
            console.error('Failed to resume job:', e)
        }
    }

    const handleDelete = async (jobId: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('job:delete', jobId)
            loadJobs()
        } catch (e) {
            console.error('Failed to delete job:', e)
        }
    }

    const filtered = jobs.filter(j => filter === 'all' || j.status === filter)

    const counts = {
        total: jobs.length,
        running: jobs.filter(j => j.status === 'running').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        pending: jobs.filter(j => j.status === 'pending').length,
        paused: jobs.filter(j => j.status === 'paused').length
    }

    const statusStyle = (status: string) => {
        const map: Record<string, { bg: string; color: string }> = {
            'completed': { bg: 'rgba(74, 222, 128, 0.12)', color: '#4ade80' },
            'failed': { bg: 'rgba(254, 44, 85, 0.12)', color: '#fe2c55' },
            'running': { bg: 'rgba(92, 138, 252, 0.12)', color: '#5c8afc' },
            'pending': { bg: 'rgba(251, 146, 60, 0.12)', color: '#fb923c' },
            'paused': { bg: 'rgba(156, 163, 175, 0.12)', color: '#9ca3af' }
        }
        return map[status] || { bg: 'rgba(255,255,255,0.05)', color: '#aaa' }
    }

    const typeLabel = (type: string) => {
        const map: Record<string, { icon: string; label: string }> = {
            'SCAN': { icon: '🔍', label: 'Scan' },
            'DOWNLOAD': { icon: '📥', label: 'Download' },
            'EDIT': { icon: '✂️', label: 'Edit' },
            'PUBLISH': { icon: '📤', label: 'Publish' }
        }
        return map[type] || { icon: '⚡', label: type }
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

    const parseDataJson = (json?: string) => {
        try { return json ? JSON.parse(json) : {} } catch { return {} }
    }

    if (loading) {
        return (
            <div className="page-enter" style={{ padding: '24px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="spinner" style={{ width: '24px', height: '24px', marginBottom: '12px' }} />
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading jobs...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="page-enter" style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Schedule & Jobs</h1>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                        Monitor and control all background tasks
                    </p>
                </div>
                <button className="btn btn-secondary" onClick={loadJobs}>
                    🔄 Refresh
                </button>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div className="stat-card" onClick={() => setFilter('all')} style={{ cursor: 'pointer', borderColor: filter === 'all' ? 'var(--accent-purple)' : undefined }}>
                    <div className="stat-value">{counts.total}</div>
                    <div className="stat-label">Total</div>
                </div>
                <div className="stat-card" onClick={() => setFilter('running')} style={{ cursor: 'pointer', borderColor: filter === 'running' ? '#5c8afc' : undefined }}>
                    <div className="stat-value" style={{ color: '#5c8afc' }}>{counts.running}</div>
                    <div className="stat-label">Running</div>
                </div>
                <div className="stat-card" onClick={() => setFilter('pending')} style={{ cursor: 'pointer', borderColor: filter === 'pending' ? '#fb923c' : undefined }}>
                    <div className="stat-value" style={{ color: '#fb923c' }}>{counts.pending}</div>
                    <div className="stat-label">Pending</div>
                </div>
                <div className="stat-card" onClick={() => setFilter('paused')} style={{ cursor: 'pointer', borderColor: filter === 'paused' ? '#9ca3af' : undefined }}>
                    <div className="stat-value" style={{ color: '#9ca3af' }}>{counts.paused}</div>
                    <div className="stat-label">Paused</div>
                </div>
                <div className="stat-card" onClick={() => setFilter('completed')} style={{ cursor: 'pointer', borderColor: filter === 'completed' ? '#4ade80' : undefined }}>
                    <div className="stat-value" style={{ color: '#4ade80' }}>{counts.completed}</div>
                    <div className="stat-label">Completed</div>
                </div>
            </div>

            {/* Jobs Table */}
            <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Table Header */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>
                        {filter === 'all' ? 'All Jobs' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Jobs`}
                        <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>({filtered.length})</span>
                    </div>
                    {filter !== 'all' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setFilter('all')}>
                            Clear Filter
                        </button>
                    )}
                </div>

                {/* Table Content */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filtered.length === 0 ? (
                        <div className="empty-state" style={{ padding: '60px 20px' }}>
                            <div className="empty-icon">
                                {filter === 'failed' ? '🎉' : filter === 'running' ? '💤' : filter === 'paused' ? '⏸️' : '📋'}
                            </div>
                            <div className="empty-text">
                                {filter === 'all'
                                    ? 'No jobs yet. Create a campaign and run it to start processing.'
                                    : filter === 'failed'
                                        ? 'No failed jobs. Everything is running smoothly!'
                                        : filter === 'running'
                                            ? 'No jobs are currently running.'
                                            : filter === 'paused'
                                                ? 'No paused jobs.'
                                                : `No ${filter} jobs found.`
                                }
                            </div>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '50px' }}>ID</th>
                                    <th>Task</th>
                                    <th>Details</th>
                                    <th>Status</th>
                                    <th>Progress</th>
                                    <th>Time</th>
                                    <th style={{ width: '120px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(job => {
                                    const data = parseDataJson(job.data_json)
                                    const tl = typeLabel(job.type)
                                    const ss = statusStyle(job.status)
                                    const canPause = job.status === 'pending'
                                    const canResume = job.status === 'paused'
                                    const canDelete = ['pending', 'paused', 'failed'].includes(job.status)
                                    return (
                                        <tr key={job.id}>
                                            <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '12px' }}>
                                                #{job.id}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span>{tl.icon}</span>
                                                    <span style={{ fontWeight: 500 }}>{tl.label}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div style={{ fontWeight: 500, fontSize: '13px' }}>
                                                    {job.campaign_name || 'Manual'}
                                                </div>
                                                {data.platform_id && (
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                        {data.platform_id.length > 30 ? data.platform_id.substring(0, 30) + '...' : data.platform_id}
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <span className="badge" style={{ background: ss.bg, color: ss.color }}>
                                                    {job.status === 'running' && <span className="spinner" style={{ width: '10px', height: '10px', marginRight: '5px', borderWidth: '1.5px' }} />}
                                                    {job.status === 'paused' && '⏸️ '}
                                                    {job.status.toUpperCase()}
                                                </span>
                                                {job.error_message && (
                                                    <div style={{ fontSize: '11px', color: '#fe2c55', marginTop: '4px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {job.error_message}
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                {job.status === 'running' ? (
                                                    <div style={{ width: '80px' }}>
                                                        <div className="progress-bar">
                                                            <div className="progress-fill indeterminate" />
                                                        </div>
                                                    </div>
                                                ) : job.status === 'completed' ? (
                                                    <span style={{ color: '#4ade80', fontSize: '12px' }}>100%</span>
                                                ) : (
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                {timeSince(job.created_at)}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    {canPause && (
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => handlePause(job.id)}
                                                            title="Pause this job"
                                                            style={{ padding: '4px 8px', fontSize: '12px' }}
                                                        >
                                                            ⏸️
                                                        </button>
                                                    )}
                                                    {canResume && (
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => handleResume(job.id)}
                                                            title="Resume this job"
                                                            style={{ padding: '4px 8px', fontSize: '12px' }}
                                                        >
                                                            ▶️
                                                        </button>
                                                    )}
                                                    {canDelete && (
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => handleDelete(job.id)}
                                                            title="Delete this job"
                                                            style={{ padding: '4px 8px', fontSize: '12px', color: '#fe2c55' }}
                                                        >
                                                            🗑️
                                                        </button>
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
            </div>
        </div>
    )
}
