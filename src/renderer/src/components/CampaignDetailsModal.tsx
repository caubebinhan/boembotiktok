import React, { useState, useEffect } from 'react'

interface CampaignDetailsModalProps {
    campaign: any
    onClose: () => void
    onUpdate: () => void
}

export const CampaignDetailsModal: React.FC<CampaignDetailsModalProps> = ({ campaign, onClose, onUpdate }) => {
    const [config, setConfig] = useState<any>(null)
    const [activeTab, setActiveTab] = useState<'sources' | 'videos' | 'jobs'>('sources')
    const [jobs, setJobs] = useState<any[]>([])

    useEffect(() => {
        if (campaign?.config_json) {
            try {
                setConfig(JSON.parse(campaign.config_json))
            } catch {
                setConfig({})
            }
        }
    }, [campaign])

    useEffect(() => {
        if (activeTab === 'jobs') {
            loadJobs()
        }
    }, [activeTab])

    const loadJobs = async () => {
        try {
            // @ts-ignore
            const allJobs = await window.api.invoke('get-jobs')
            const campaignJobs = allJobs.filter((j: any) => j.campaign_id === campaign.id)
            setJobs(campaignJobs)
        } catch (e) {
            console.error('Failed to load jobs', e)
        }
    }

    const handleRemoveSource = async (type: 'channel' | 'keyword', name: string) => {
        if (!confirm(`Remove ${type} "${name}" from campaign?`)) return

        const newConfig = { ...config }
        if (!newConfig.sources) return

        if (type === 'channel') {
            newConfig.sources.channels = newConfig.sources.channels.filter((c: any) => c.name !== name)
        } else {
            newConfig.sources.keywords = newConfig.sources.keywords.filter((k: any) => k.name !== name)
        }

        try {
            // @ts-ignore
            await window.api.invoke('update-campaign-config', campaign.id, newConfig)
            setConfig(newConfig)
            onUpdate()
        } catch (e) {
            console.error('Failed to update config', e)
        }
    }

    const handleRemoveVideo = async (videoId: string) => {
        if (!confirm('Remove this video from campaign targets?')) return

        const newConfig = { ...config }
        if (!newConfig.videos) return

        newConfig.videos = newConfig.videos.filter((v: any) => v.id !== videoId)

        try {
            // @ts-ignore
            await window.api.invoke('update-campaign-config', campaign.id, newConfig)
            setConfig(newConfig)
            onUpdate()
        } catch (e) {
            console.error('Failed to update config', e)
        }
    }

    const handleRunNow = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('trigger-campaign', campaign.id)
            alert('Campaign triggered successfully!')
            onUpdate()
            if (activeTab === 'jobs') loadJobs()
        } catch (e) {
            console.error('Failed to trigger campaign', e)
        }
    }

    if (!campaign || !config) return null

    const channels = config.sources?.channels || []
    const keywords = config.sources?.keywords || []
    const videos = config.videos || []

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ width: '800px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                <div className="modal-header">
                    <h2>{campaign.name}</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="tabs" style={{ marginBottom: '0', borderBottom: '1px solid var(--border-primary)' }}>
                    <button
                        className={`tab ${activeTab === 'sources' ? 'active' : ''}`}
                        onClick={() => setActiveTab('sources')}
                    >
                        📡 Sources ({channels.length + keywords.length})
                    </button>
                    <button
                        className={`tab ${activeTab === 'videos' ? 'active' : ''}`}
                        onClick={() => setActiveTab('videos')}
                    >
                        🎬 Target Videos ({videos.length})
                    </button>
                    <button
                        className={`tab ${activeTab === 'jobs' ? 'active' : ''}`}
                        onClick={() => setActiveTab('jobs')}
                    >
                        ⚡ Job History
                    </button>
                </div>

                <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

                    {/* SOURCES TAB */}
                    {activeTab === 'sources' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                <h3>Active Sources</h3>
                                <button className="btn btn-primary" onClick={handleRunNow}>
                                    ▶ Run Now (Scan & Schedule)
                                </button>
                            </div>

                            {channels.length === 0 && keywords.length === 0 && (
                                <p style={{ color: 'var(--text-muted)' }}>No sources configured.</p>
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '10px' }}>
                                {channels.map((c: any) => (
                                    <div key={c.name} style={{
                                        padding: '10px', borderRadius: '8px',
                                        background: 'rgba(37, 244, 238, 0.05)',
                                        border: '1px solid rgba(37, 244, 238, 0.2)',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span>📺</span>
                                            <strong>@{c.name}</strong>
                                        </div>
                                        <button onClick={() => handleRemoveSource('channel', c.name)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fe2c55' }}>
                                            🗑️
                                        </button>
                                    </div>
                                ))}
                                {keywords.map((k: any) => (
                                    <div key={k.name} style={{
                                        padding: '10px', borderRadius: '8px',
                                        background: 'rgba(255, 165, 0, 0.05)',
                                        border: '1px solid rgba(255, 165, 0, 0.2)',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span>🔍</span>
                                            <strong>"{k.name}"</strong>
                                        </div>
                                        <button onClick={() => handleRemoveSource('keyword', k.name)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fe2c55' }}>
                                            🗑️
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* VIDEOS TAB */}
                    {activeTab === 'videos' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                <h3>Manually Added Videos</h3>
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                                    These videos are specifically targeted. Scanned videos will appear in Job History.
                                </div>
                            </div>

                            {videos.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)' }}>No manual videos added.</p>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                                    {videos.map((v: any) => (
                                        <div key={v.id} style={{
                                            padding: '10px', borderRadius: '8px',
                                            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                                            display: 'flex', gap: '12px', alignItems: 'center'
                                        }}>
                                            <img src={v.thumbnail} alt="" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px' }} />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                                                    {v.description ? (v.description.length > 60 ? v.description.substring(0, 60) + '...' : v.description) : 'No description'}
                                                </div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '10px' }}>
                                                    <span>👀 {v.stats?.views || 0}</span>
                                                    <span>❤️ {v.stats?.likes || 0}</span>
                                                    <span>💬 {v.stats?.comments || 0}</span>
                                                </div>
                                            </div>
                                            <button onClick={() => handleRemoveVideo(v.id)}
                                                className="btn btn-ghost btn-sm"
                                                style={{ color: '#fe2c55' }}>
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* JOBS TAB */}
                    {activeTab === 'jobs' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                <h3>Recent Jobs</h3>
                                <button className="btn btn-secondary btn-sm" onClick={loadJobs}>Refresh</button>
                            </div>

                            {jobs.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)' }}>No jobs found for this campaign.</p>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Type</th>
                                            <th>Status</th>
                                            <th>Scheduled For</th>
                                            <th>Result</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {jobs.map(job => (
                                            <tr key={job.id}>
                                                <td>#{job.id}</td>
                                                <td>{job.type}</td>
                                                <td>
                                                    <span className={`badge badge-${job.status}`}>
                                                        {job.status}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '12px' }}>
                                                    {job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : 'Immediate'}
                                                </td>
                                                <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                    {job.result_json || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>
    )
}
