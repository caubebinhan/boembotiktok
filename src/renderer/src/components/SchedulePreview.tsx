import React, { useState } from 'react'

interface SchedulePreviewProps {
    sources: any[]
    savedVideos: any[]
    schedule: {
        interval: number // minutes
        startTime: string // HH:mm
        days: string[]
    }
}

export const SchedulePreview: React.FC<SchedulePreviewProps> = ({ sources, savedVideos, schedule }) => {
    const [zoomLevel, setZoomLevel] = useState(1) // 1 = normal, 0.5 = small, 2 = large
    const [page, setPage] = useState(0)

    const itemsPerPage = 8

    // Simulation Logic
    const simulateTimeline = () => {
        const timeline: any[] = []
        let currentTime = new Date()
        // Set to next occurrence of startTime
        const [sh, sm] = schedule.startTime.split(':').map(Number)
        currentTime.setHours(sh, sm, 0, 0)
        if (currentTime < new Date()) {
            currentTime.setDate(currentTime.getDate() + 1)
        }

        // 1. Saved Videos
        savedVideos.forEach((video, i) => {
            timeline.push({
                time: new Date(currentTime),
                type: 'post',
                label: `Post Video #${i + 1}`,
                detail: video.description || 'Targeted Video',
                icon: '🎬'
            })
            // Increment time by interval
            currentTime = new Date(currentTime.getTime() + schedule.interval * 60000)
        })

        // 2. Sources (Scanning)
        // Assume after posted all videos, it enters scanning loop?
        // Or if sources exist, it alternates?
        // User said: "show timeline 10 videos first then channel"
        // So we assume it exhausts saved videos then falls back to sources.

        if (sources.length > 0) {
            for (let i = 0; i < 10; i++) { // Simulate next 10 slots
                const source = sources[i % sources.length]
                timeline.push({
                    time: new Date(currentTime),
                    type: 'scan',
                    label: `Scan & Post`,
                    detail: `Source: ${source.type === 'channel' ? '@' : ''}${source.name}`,
                    icon: source.type === 'channel' ? '📺' : '🔍'
                })
                currentTime = new Date(currentTime.getTime() + schedule.interval * 60000)
            }
        }

        return timeline
    }

    const timeline = simulateTimeline()
    const displayedItems = timeline.slice(page * itemsPerPage, (page + 1) * itemsPerPage)

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', weekday: 'short' })
    }

    return (
        <div className="wizard-step">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h3 style={{ margin: 0 }}>Step 3: Preview Schedule</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Preview how your campaign will execute over time.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))}>-</button>
                    <span style={{ fontSize: '12px', alignSelf: 'center' }}>Zoom</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setZoomLevel(z => Math.min(2, z + 0.25))}>+</button>
                </div>
            </div>

            <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: '12px',
                padding: '20px',
                overflowX: 'auto',
                border: '1px solid var(--border-primary)',
                marginBottom: '20px'
            }}>
                <div style={{ display: 'flex', gap: '20px', paddingBottom: '10px' }}>
                    {displayedItems.map((item, i) => (
                        <div key={i} style={{
                            flexShrink: 0,
                            width: `${140 * zoomLevel}px`,
                            position: 'relative'
                        }}>
                            {/* Time Line Connector */}
                            <div style={{
                                position: 'absolute', top: '24px', left: '0', right: '-20px',
                                height: '2px', background: 'var(--border-primary)', zIndex: 0
                            }} />

                            {/* Node */}
                            <div style={{
                                width: '12px', height: '12px', borderRadius: '50%',
                                background: item.type === 'post' ? 'var(--accent-primary)' : '#ff9800',
                                margin: '0 0 10px 0', position: 'relative', zIndex: 1,
                                border: '2px solid var(--bg-secondary)'
                            }} />

                            {/* Time */}
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>
                                {formatTime(item.time)}
                            </div>

                            {/* Card */}
                            <div style={{
                                padding: '10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '8px',
                                opacity: 0.9
                            }}>
                                <div style={{ fontSize: '20px', marginBottom: '6px' }}>{item.icon}</div>
                                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '2px' }}>{item.label}</div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{item.detail}</div>
                            </div>
                        </div>
                    ))}
                    {timeline.length > (page + 1) * itemsPerPage && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '100px' }}>
                            <button className="btn btn-ghost" onClick={() => setPage(p => p + 1)}>Next &rarr;</button>
                        </div>
                    )}
                </div>
                {page > 0 && (
                    <div style={{ marginTop: '10px' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => p - 1)}>&larr; Previous</button>
                    </div>
                )}
            </div>

            <div style={{ padding: '15px', background: 'rgba(37, 244, 238, 0.05)', borderRadius: '8px', border: '1px solid rgba(37, 244, 238, 0.2)' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--accent-primary)' }}>Execution Plan</h4>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {savedVideos.length > 0 && (
                        <li>First, <strong>{savedVideos.length} targeted videos</strong> will be published sequentially every {schedule.interval} minutes.</li>
                    )}
                    {sources.length > 0 && (
                        <li>
                            Then, the app will scan <strong>{sources.length} sources</strong>
                            ({sources.map(s => s.name).join(', ')}) to find new videos matching your filters.
                        </li>
                    )}
                    {sources.length > 0 && (
                        <li>New content will be filtered (Min Views: {sources[0]?.minViews || 0}) and added to the queue automatically.</li>
                    )}
                </ul>
            </div>
        </div>
    )
}
