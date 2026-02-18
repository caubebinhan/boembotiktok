import React, { useState, useEffect } from 'react'
import { AlertTriangle, Play, Save, X } from 'lucide-react'
import { SchedulePreview, TimelineItem } from './SchedulePreview'

interface Job {
    id: number
    type: string
    scheduled_for: string
    data_json: string
    campaign_id: number
}

interface RescheduleModalProps {
    missedJobs: Job[]
    onResume: (rescheduleItems: { id: number, scheduled_for: string }[]) => void
    onDiscard: () => void
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({ missedJobs, onResume, onDiscard }) => {
    const [jobs, setJobs] = useState<Job[]>([])
    const [previewItems, setPreviewItems] = useState<TimelineItem[]>([])
    const [scheduleConfig, setScheduleConfig] = useState<any>({
        interval: 15,
        startTime: new Date().toTimeString().slice(0, 5)
    })

    useEffect(() => {
        if (missedJobs.length > 0) {
            setJobs(missedJobs)
            // Convert to TimelineItems
            const items: TimelineItem[] = missedJobs.map(job => {
                const data = JSON.parse(job.data_json || '{}')
                return {
                    id: String(job.id),
                    time: new Date(), // Default to NOW for rescheduling
                    type: job.type === 'PUBLISH' ? 'post' : 'scan',
                    label: job.type === 'PUBLISH' ? `Post to @${data.account_name || '?'}` : `Scan ${data.source || 'Sources'}`,
                    detail: data.caption || data.description || 'No description',
                    icon: job.type === 'PUBLISH' ? '🎬' : '🔍',
                    video: {
                        id: data.platform_id,
                        thumbnail: data.thumbnail,
                        url: data.video_path,
                        stats: data.videoStats
                    },
                    isFixed: false // Allow auto-layout initially
                }
            })
            setPreviewItems(items)
        }
    }, [missedJobs])

    const handleScheduleChange = (updatedItems: TimelineItem[]) => {
        setPreviewItems(updatedItems)
    }

    const handleConfirm = () => {
        // Map back to { id, scheduled_for }
        const updates = previewItems.map(item => ({
            id: Number(item.id),
            scheduled_for: item.time.toISOString()
        }))
        onResume(updates)
    }

    if (jobs.length === 0) return null

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: '#1e1e1e', padding: '0', borderRadius: '12px',
                width: '900px', maxWidth: '95vw', height: '85vh',
                border: '1px solid #333', display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px', borderBottom: '1px solid #333',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(245, 158, 11, 0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            background: '#f59e0b', color: '#000', padding: '8px',
                            borderRadius: '50%', display: 'flex'
                        }}>
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>Missed Jobs Detected</h2>
                            <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                                The app closed unexpectedly with <strong>{jobs.length} pending jobs</strong>. Please reschedule them below.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Body - Schedule Preview */}
                <div style={{ flex: 1, overflow: 'hidden', padding: '20px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ marginBottom: '10px', color: '#888', fontSize: '0.9rem' }}>
                        Adjust the timeline below. Jobs are set to resume from NOW by default.
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #333', borderRadius: '8px', background: '#111' }}>
                        <SchedulePreview
                            sources={[]} // Not needed for pure rescheduling
                            savedVideos={[]} // Not needed
                            schedule={{
                                interval: 15,
                                days: [],
                                runAt: new Date().toISOString()
                            }}
                            initialItems={previewItems}
                            onScheduleChange={handleScheduleChange}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '20px', borderTop: '1px solid #333',
                    display: 'flex', justifyContent: 'flex-end', gap: '12px',
                    background: '#252525'
                }}>
                    <button
                        onClick={onDiscard}
                        style={{
                            padding: '10px 20px', background: 'transparent',
                            border: '1px solid #555', color: '#aaa',
                            borderRadius: '6px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}
                    >
                        <X size={16} />
                        Discard All
                    </button>

                    <button
                        onClick={handleConfirm}
                        style={{
                            padding: '10px 24px', background: '#3b82f6',
                            border: 'none', color: '#fff',
                            borderRadius: '6px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            fontWeight: 600, fontSize: '1rem',
                            boxShadow: '0 4px 6px rgba(59, 130, 246, 0.3)'
                        }}
                    >
                        <Play size={18} />
                        Reschedule & Run
                    </button>
                </div>
            </div>
        </div>
    )
}
