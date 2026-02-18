import React, { useState, useEffect } from 'react'

interface CampaignDetailsModalProps {
    campaign: any
    onClose: () => void
    onUpdate: () => void
}

export const CampaignDetailsModal: React.FC<CampaignDetailsModalProps> = ({ campaign, onClose, onUpdate }) => {
    const [config, setConfig] = useState<any>(null)
    const [activeTab, setActiveTab] = useState<'sources' | 'videos' | 'jobs' | 'published'>('sources')
    const [jobs, setJobs] = useState<any[]>([])
    const [stats, setStats] = useState({ scanned: 0, downloaded: 0, scheduled: 0, published: 0 })

    useEffect(() => {
        if (campaign?.config_json) {
            try {
                setConfig(JSON.parse(campaign.config_json))
            } catch {
                setConfig({})
            }
        }
        if (campaign) loadStats()
    }, [campaign])

    useEffect(() => {
        if (activeTab === 'jobs') {
            loadJobs()
        }
    }, [activeTab])

    const loadStats = async () => {
        try {
            // @ts-ignore
            const s = await window.api.invoke('get-campaign-stats', campaign.id)
            setStats(s || { scanned: 0, downloaded: 0, scheduled: 0, published: 0 })
        } catch (e) {
            console.error('Failed to load stats', e)
        }
    }

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
            loadStats()
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
                    <button
                        className={`tab ${activeTab === 'published' ? 'active' : ''}`}
                        onClick={() => setActiveTab('published')}
                    >
                        ✅ Published
                    </button>
                </div>

                <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

                    {/* SOURCES TAB */}
                    {activeTab === 'sources' && (
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                                <div style={{ background: 'rgba(37, 244, 238, 0.1)', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(37, 244, 238, 0.2)' }}>
                                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>{stats.scanned}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Scanned</div>
                                </div>
                                <div style={{ background: 'rgba(255, 152, 0, 0.1)', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(255, 152, 0, 0.2)' }}>
                                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ff9800' }}>{stats.downloaded}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Downloaded</div>
                                </div>
                                <div style={{ background: 'rgba(33, 150, 243, 0.1)', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(33, 150, 243, 0.2)' }}>
                                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2196f3' }}>{stats.scheduled}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Scheduled</div>
                                </div>
                                <div style={{ background: 'rgba(76, 175, 80, 0.1)', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(76, 175, 80, 0.2)' }}>
                                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4caf50' }}>{stats.published}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Published</div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                <h3>Active Sources</h3>
                                {(() => {
                                    const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending');
                                    const isRunning = activeJobs.length > 0;
                                    // Finished if NONE are running/pending AND at least one is completed OR paused
                                    // Actually, if we have ANY completed/paused jobs and NO running/pending, we can retry.
                                    // User wants "Paused" = "Finished".
                                    const hasFinished = !isRunning && jobs.some(j => j.status === 'completed' || j.status === 'paused');

                                    return (
                                        <button
                                            className={`btn ${isRunning ? 'btn-secondary' : 'btn-primary'}`}
                                            onClick={handleRunNow}
                                            disabled={isRunning}
                                            style={{
                                                opacity: isRunning ? 0.7 : 1,
                                                cursor: isRunning ? 'not-allowed' : 'pointer',
                                                display: 'flex', alignItems: 'center', gap: '6px'
                                            }}
                                        >
                                            {isRunning ? (
                                                <>
                                                    <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />
                                                    Running...
                                                </>
                                            ) : (
                                                hasFinished ? '↻ Run Again' : '▶ Run Now (Scan & Schedule)'
                                            )}
                                        </button>
                                    );
                                })()}
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
                                                    <span className={`badge badge-${job.status?.split(':')[0].toLowerCase()}`}>
                                                        {job.status}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '12px' }}>
                                                    {job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : 'Immediate'}
                                                </td>
                                                <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                    {(() => {
                                                        try {
                                                            const res = JSON.parse(job.result_json || '{}');
                                                            const metadata = (() => { try { return JSON.parse(job.metadata || '{}') } catch { return {} } })();
                                                            const viewUrl = metadata.publish_url || res.video_url;

                                                            return (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                    <div>{job.result_json && job.result_json.length > 50 && !res.screenshot_path ? job.result_json.substring(0, 50) + '...' : (job.result_json || '-')}</div>

                                                                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                                                        {/* Success Link */}
                                                                        {viewUrl && (
                                                                            <button
                                                                                className="btn-xs btn-emerald"
                                                                                onClick={() => (window as any).api.invoke('open-external', viewUrl)}
                                                                                title="View Published Video"
                                                                                style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
                                                                            >
                                                                                🔗 View Link
                                                                            </button>
                                                                        )}

                                                                        {/* Debug Buttons for Failed Jobs */}
                                                                        {(res.screenshot_path || res?.debugArtifacts?.screenshot) && (
                                                                            <button
                                                                                className="btn-xs btn-outline"
                                                                                onClick={() => (window as any).api.invoke('open-path', res.screenshot_path || res.debugArtifacts.screenshot)}
                                                                                title="View Error Screenshot"
                                                                            >
                                                                                📸 Screenshot
                                                                            </button>
                                                                        )}
                                                                        {(res.html_path || res?.debugArtifacts?.html) && (
                                                                            <button
                                                                                className="btn-xs btn-outline"
                                                                                onClick={() => (window as any).api.invoke('open-path', res.html_path || res.debugArtifacts.html)}
                                                                                title="View HTML Dump"
                                                                            >
                                                                                📄 Log
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    {res.raw_reason && (
                                                                        <div style={{ color: '#ff4d4f', fontSize: '11px', fontStyle: 'italic' }}>
                                                                            {res.raw_reason}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )
                                                        } catch { return job.result_json || '-' }
                                                    })()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {/* PUBLISHED TAB */}
                    {activeTab === 'published' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                <h3>Published Videos</h3>
                                <button className="btn btn-secondary btn-sm" onClick={loadJobs}>Refresh List</button>
                            </div>

                            {jobs.filter(j => j.type === 'PUBLISH' && (j.status.toLowerCase().includes('success') || j.status.toLowerCase().includes('published') || j.status.toLowerCase().includes('complete'))).length === 0 ? (
                                <p style={{ color: 'var(--text-muted)' }}>No published videos yet.</p>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                                    {jobs.filter(j => j.type === 'PUBLISH' && (j.status.toLowerCase().includes('success') || j.status.toLowerCase().includes('published') || j.status.toLowerCase().includes('complete'))).map(job => {
                                        let data: any = {}
                                        try { data = JSON.parse(job.data_json || '{}') } catch { }
                                        let result: any = {}
                                        try { result = JSON.parse(job.result_json || '{}') } catch { }

                                        // Try to find video metadata if linked
                                        // This is a bit disjointed, ideally we'd join with 'videos' table.
                                        // For now, we rely on what's in the job data/result.
                                        const videoId = data.platform_id; // Original video ID
                                        const publishedUrl = result.videoUrl || (data.account_username && result.videoId ? `https://www.tiktok.com/@${data.account_username}/video/${result.videoId}` : null);


                                        return (
                                            <div key={job.id} style={{
                                                padding: '15px', borderRadius: '8px',
                                                background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                                                display: 'flex', gap: '15px'
                                            }}>
                                                <div style={{ width: '80px', height: '110px', background: '#000', borderRadius: '4px', overflow: 'hidden' }}>
                                                    {data.thumbnail ? (
                                                        <img src={data.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>No Preview</div>
                                                    )}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                                                        {data.caption || 'No Caption'}
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                                                        Account: <strong style={{ color: 'var(--text-primary)' }}>@{data.account_name}</strong> •
                                                        Published: {job.completed_at ? new Date(job.completed_at).toLocaleString() : 'Recently'}
                                                    </div>

                                                    {publishedUrl && (
                                                        <div style={{ marginBottom: '10px' }}>
                                                            <a href="#" onClick={(e) => { e.preventDefault(); /* open external */ window.open(publishedUrl, '_blank') }}
                                                                style={{ color: 'var(--accent-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px' }}>
                                                                🔗 View on TikTok
                                                            </a>
                                                        </div>
                                                    )}

                                                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '6px', width: 'fit-content' }}>
                                                        <div style={{ fontSize: '12px', display: 'flex', gap: '5px' }}>
                                                            <span>👁 {data.videoStats?.views || 0}</span>
                                                            <span>❤️ {data.videoStats?.likes || 0}</span>
                                                        </div>
                                                        <button
                                                            className="btn-icon"
                                                            style={{ fontSize: '12px', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer', border: 'none', color: 'var(--text-primary)' }}
                                                            onClick={async () => {
                                                                if (!result.videoId || !data.account_username) {
                                                                    alert('Cannot refresh: Missing Video ID or Username');
                                                                    return;
                                                                }
                                                                // @ts-ignore
                                                                const newStats = await window.api.invoke('tiktok:refresh-stats', result.videoId, data.account_username);
                                                                if (newStats) {
                                                                    alert(`Stats Refreshed!\nViews: ${newStats.views}\nLikes: ${newStats.likes}`);
                                                                    loadJobs(); // Reload to hopefully see update? (Wait, job data isn't updated, video metadata is. UI needs to handle this.)
                                                                    // For now, simple alert is confirmation.
                                                                } else {
                                                                    alert('Could not fetch new stats.');
                                                                }
                                                            }}
                                                        >
                                                            🔄 Refresh
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
