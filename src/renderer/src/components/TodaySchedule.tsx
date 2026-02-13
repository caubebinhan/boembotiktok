import React, { useEffect, useState } from 'react'
import { VideoCard } from './VideoCard'

export const TodaySchedule: React.FC = () => {
    const [jobs, setJobs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    const loadTodayJobs = async () => {
        setLoading(true)
        try {
            const now = new Date()
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString()
            const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

            // @ts-ignore
            const data = await window.api.invoke('get-scheduled-jobs', startOfDay, endOfDay)
            setJobs(data || [])
        } catch (e) {
            console.error('Failed to load today jobs', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadTodayJobs()
        // Refresh every minute to update status/time
        const interval = setInterval(loadTodayJobs, 60000)
        return () => clearInterval(interval)
    }, [])

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'var(--accent-green)'
            case 'failed': return 'var(--accent-red)'
            case 'running': return 'var(--accent-blue)'
            default: return 'var(--text-muted)'
        }
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>📅 Today's Schedule</h3>
                <button className="btn btn-secondary btn-sm" onClick={loadTodayJobs}>Refresh</button>
            </div>

            {loading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
            ) : jobs.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">☕</div>
                    <div className="empty-text">No jobs scheduled for today.<br />Relax or create a new campaign!</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1, paddingRight: '5px' }}>
                    {jobs.map(job => {
                        let video = null
                        if (job.data_json) {
                            try {
                                const data = JSON.parse(job.data_json)
                                video = data.video || data
                            } catch { }
                        }
                        // Fallback to campaign config video if not in job data
                        if (!video && job.config_json) {
                            const config = JSON.parse(job.config_json)
                            // This is tricky, jobs might not link to specific video in config easily without id
                        }

                        return (
                            <div key={job.id} className="card" style={{ padding: '15px', display: 'flex', gap: '15px', alignItems: 'center' }}>
                                <div style={{ width: '80px', height: '120px', flexShrink: 0 }}>
                                    {video ? (
                                        <VideoCard video={video} showStats={false} compact={true} className="w-full h-full" />
                                    ) : (
                                        <div style={{ width: '100%', height: '100%', background: 'var(--bg-tertiary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            ⚡
                                        </div>
                                    )}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{job.type}</div>
                                        <div className="badge" style={{ background: `rgba(0,0,0,0.2)`, color: getStatusColor(job.status), border: `1px solid ${getStatusColor(job.status)}` }}>
                                            {job.status}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '5px' }}>
                                        Campaign: <strong>{job.campaign_name}</strong>
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                        Scheduled: {new Date(job.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    {job.result_json && (
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '5px', background: 'rgba(0,0,0,0.2)', padding: '5px', borderRadius: '4px' }}>
                                            Result: {job.result_json.substring(0, 100)}...
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
