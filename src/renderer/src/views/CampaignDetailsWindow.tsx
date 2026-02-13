import React, { useState, useEffect } from 'react'
import { Campaign } from '../types/picker'

interface Props {
    id: number
}

export const CampaignDetailsWindow: React.FC<Props> = ({ id }) => {
    const [campaign, setCampaign] = useState<any>(null)
    const [config, setConfig] = useState<any>(null)
    const [activeTab, setActiveTab] = useState<'overview' | 'sources' | 'videos' | 'jobs' | 'results'>('overview')
    const [jobs, setJobs] = useState<any[]>([])
    const [stats, setStats] = useState({ scanned: 0, pending: 0, completed: 0, failed: 0 })

    const loadCampaign = async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-campaigns')
            const c = data.find((c: any) => c.id === Number(id))
            if (c) {
                setCampaign(c)
                try {
                    setConfig(JSON.parse(c.config_json))
                } catch {
                    setConfig({})
                }
            }
        } catch (err) {
            console.error(err)
        }
    }

    const loadJobs = async () => {
        try {
            // @ts-ignore
            const allJobs = await window.api.invoke('get-jobs')
            const campaignJobs = allJobs.filter((j: any) => j.campaign_id === Number(id))
            setJobs(campaignJobs)

            // Calculate stats
            const s = { scanned: 0, pending: 0, completed: 0, failed: 0 }
            campaignJobs.forEach((j: any) => {
                if (j.type === 'SCAN' && j.status === 'completed') {
                    try {
                        const res = JSON.parse(j.result_json)
                        s.scanned += (res.found || 0)
                    } catch { }
                }
                if (j.type === 'DOWNLOAD') {
                    if (j.status === 'pending') s.pending++
                    if (j.status === 'completed') s.completed++
                    if (j.status === 'failed') s.failed++
                }
            })
            setStats(s)
        } catch (e) {
            console.error(e)
        }
    }

    useEffect(() => {
        loadCampaign()
        loadJobs()
        const interval = setInterval(() => {
            loadJobs() // Real-time update for jobs
        }, 3000)
        return () => clearInterval(interval)
    }, [id])


    const handleRunNow = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('trigger-campaign', id)
            alert('Campaign triggered! Monitoring progress...')
            loadJobs()
        } catch (e) {
            console.error(e)
        }
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
        } catch (e) {
            console.error(e)
        }
    }

    const handleOpenFolder = async (path: string) => {
        // @ts-ignore
        await window.api.invoke('open-path', path)
    }

    const handleOpenScanner = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('open-scanner-window')
        } catch (err) {
            console.error('Failed to open scanner:', err)
        }
    }

    // Listen for scanner results
    useEffect(() => {
        // @ts-ignore
        const removeListener = window.api.on('scanner-results-received', async (results: any) => {
            if (!results) return

            // We need to use functional update to get latest config, or ref. 
            // Since we need to write to DB, we should probably fetch latest or use Current Config state if valid.
            // Let's rely on 'config' dependency in useEffect.
            if (!config) return

            let newConfig = { ...config }
            // Ensure arrays exist
            if (!newConfig.sources) newConfig.sources = { channels: [], keywords: [] }
            if (!newConfig.sources.channels) newConfig.sources.channels = []
            if (!newConfig.sources.keywords) newConfig.sources.keywords = []
            if (!newConfig.videos) newConfig.videos = []

            let addedCount = 0

            // Add source
            if (results.type && results.value) {
                if (results.type === 'channel') {
                    if (!newConfig.sources.channels.some((c: any) => c.name === results.value)) {
                        newConfig.sources.channels.push({ name: results.value })
                        addedCount++
                    }
                } else if (results.type === 'keyword') {
                    if (!newConfig.sources.keywords.some((k: any) => k.name === results.value)) {
                        newConfig.sources.keywords.push({ name: results.value })
                        addedCount++
                    }
                }
            }

            // Add videos
            if (results.videos && Array.isArray(results.videos)) {
                const newVids = results.videos.filter((v: any) => v.selected !== false)
                const existingIds = new Set(newConfig.videos.map((v: any) => v.id))
                const unique = newVids.filter((v: any) => !existingIds.has(v.id)).map((v: any) => ({
                    id: v.id,
                    url: v.url,
                    description: v.description || '',
                    thumbnail: v.thumbnail || '',
                    stats: v.stats || { views: 0, likes: 0, comments: 0 }
                }))
                if (unique.length > 0) {
                    newConfig.videos = [...newConfig.videos, ...unique]
                    addedCount += unique.length
                }
            }

            if (addedCount > 0) {
                await updateConfig(newConfig)
                // alert(`Added ${addedCount} items from scanner!`) // Optional feedback
            }
        })
        return () => removeListener()
    }, [config, id])


    if (!campaign || !config) return <div style={{ padding: 20 }}>Loading...</div>

    const channels = config.sources?.channels || []
    const keywords = config.sources?.keywords || []
    const videos = config.videos || []

    return (
        <div className="page-enter" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            {/* Header */}
            <header style={{ padding: '20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px' }}>{campaign.name}</h1>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '5px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                        <span className={`badge badge-${campaign.status}`}>{campaign.status.toUpperCase()}</span>
                        <span>{campaign.type === 'scan_all' ? '🔄 Full Scan' : '📋 New Items Only'}</span>
                        <span>📅 {campaign.schedule_cron}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-secondary" onClick={handleOpenScanner}>🔍 Scan More</button>
                    <button className="btn btn-secondary" onClick={loadJobs}>Refresh</button>
                    <button className="btn btn-primary" onClick={handleRunNow}>▶ Run Now</button>
                </div>
            </header>

            {/* Tabs */}
            <div className="tabs" style={{ padding: '0 20px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                {['overview', 'sources', 'videos', 'jobs', 'results'].map(tab => (
                    <button
                        key={tab}
                        className={`tab ${activeTab === tab ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab as any)}
                        style={{ padding: '15px 20px', fontSize: '14px', textTransform: 'capitalize' }}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                        <div className="card" style={{ padding: '20px' }}>
                            <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-muted)' }}>Total Scanned Videos</h3>
                            <div style={{ fontSize: '36px', fontWeight: 700 }}>{stats.scanned}</div>
                        </div>
                        <div className="card" style={{ padding: '20px' }}>
                            <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-muted)' }}>Pending Downloads</h3>
                            <div style={{ fontSize: '36px', fontWeight: 700, color: '#facc15' }}>{stats.pending}</div>
                        </div>
                        <div className="card" style={{ padding: '20px' }}>
                            <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-muted)' }}>Completed Downloads</h3>
                            <div style={{ fontSize: '36px', fontWeight: 700, color: '#4ade80' }}>{stats.completed}</div>
                        </div>
                        <div className="card" style={{ padding: '20px' }}>
                            <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-muted)' }}>Failed Downloads</h3>
                            <div style={{ fontSize: '36px', fontWeight: 700, color: '#fe2c55' }}>{stats.failed}</div>
                        </div>
                    </div>
                )}

                {/* SOURCES TAB */}
                {activeTab === 'sources' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                            <h3 style={{ margin: 0 }}>Target Channels ({channels.length})</h3>
                            <button className="btn btn-secondary btn-sm" onClick={handleOpenScanner}>+ Add Source</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
                            {channels.map((c: any) => (
                                <div key={c.name} className="card" style={{ padding: '15px', display: 'flex', gap: '15px', alignItems: 'center' }}>
                                    <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#333', overflow: 'hidden', flexShrink: 0 }}>
                                        {c.metadata?.avatar ? (
                                            <img src={c.metadata.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>👤</div>
                                        )}
                                    </div>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <div style={{ fontWeight: 700, fontSize: '16px' }}>@{c.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            {c.metadata?.followers || '0'} Followers • {c.metadata?.following || '0'} Following
                                        </div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {c.metadata?.bio || 'No bio'}
                                        </div>
                                    </div>
                                    <button className="btn btn-ghost btn-sm" style={{ color: '#fe2c55' }} onClick={() => handleRemoveSource('channel', c.name)}>🗑️</button>
                                </div>
                            ))}
                        </div>

                        <h3 style={{ marginTop: '30px', marginBottom: '15px' }}>Target Keywords ({keywords.length})</h3>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {keywords.map((k: any) => (
                                <div key={k.name} className="badge" style={{ padding: '8px 12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    🔍 {k.name}
                                    <span style={{ cursor: 'pointer', marginLeft: '5px' }} onClick={() => handleRemoveSource('keyword', k.name)}>×</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* VIDEOS TAB */}
                {activeTab === 'videos' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
                        {videos.map((v: any) => (
                            <div key={v.id} className="card" style={{ overflow: 'hidden' }}>
                                <div style={{ height: '250px', position: 'relative' }}>
                                    <img src={v.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', padding: '10px' }}>
                                        <div style={{ fontSize: '12px', color: '#fff', display: 'flex', gap: '10px' }}>
                                            <span>👀 {v.stats?.views || 0}</span>
                                            <span>❤️ {v.stats?.likes || 0}</span>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ padding: '10px' }}>
                                    <div style={{ fontSize: '12px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '32px' }}>
                                        {v.description || 'No description'}
                                    </div>
                                    <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: '10px', color: '#fe2c55' }} onClick={() => handleRemoveVideo(v.id)}>
                                        Remove Target
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button className="card" style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-primary)', cursor: 'pointer' }} onClick={handleOpenScanner}>
                            <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔍</div>
                            <div>Scan More Videos</div>
                        </button>
                    </div>
                )}

                {/* JOBS TAB */}
                {activeTab === 'jobs' && (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Scheduled For</th>
                                <th>Progress / Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.map(job => {
                                let details = ''
                                try {
                                    const data = JSON.parse(job.data_json || '{}')
                                    details = data.status || (job.status === 'running' ? 'Processing...' : (job.result_json || '-'))
                                } catch {
                                    details = job.result_json || '-'
                                }

                                return (
                                    <tr key={job.id}>
                                        <td>#{job.id}</td>
                                        <td>{job.type}</td>
                                        <td>
                                            <span className={`badge badge-${job.status}`}>
                                                {job.status === 'running' ? (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{job.status} <span className="spinner" style={{ width: '8px', height: '8px' }} /></span>
                                                ) : job.status}
                                            </span>
                                        </td>
                                        <td>{job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : 'Immediate'}</td>
                                        <td style={{ fontSize: '12px', fontFamily: 'monospace', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {details}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}

                {/* RESULTS TAB */}
                {activeTab === 'results' && (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Download Job ID</th>
                                <th>Scheduled Time</th>
                                <th>Status</th>
                                <th>File</th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.filter(j => j.type === 'DOWNLOAD' && j.status === 'completed').map(job => (
                                <tr key={job.id}>
                                    <td>#{job.id}</td>
                                    <td>{new Date(job.scheduled_for).toLocaleString()}</td>
                                    <td><span className="badge badge-completed">Success</span></td>
                                    <td>
                                        <button className="btn btn-ghost btn-sm" onClick={() => {
                                            if (job.result_json) {
                                                try {
                                                    const res = JSON.parse(job.result_json);
                                                    if (res.path) handleOpenFolder(res.path) // Path to file
                                                } catch { }
                                            }
                                        }}>
                                            📂 Open Folder
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

            </div>
        </div>
    )
}
