import React from 'react'
import { X, Play, Trash2, AlertTriangle, RefreshCw } from 'lucide-react'

interface Job {
    id: number
    type: string
    scheduled_for: string
    data_json: string
}

interface RescheduleModalProps {
    missedJobs: Job[]
    onResume: (rescheduleIds: number[]) => void
    onDiscard: () => void // Just close, effectively discarding processing for now (or maybe clearing them?)
}

// For now, "Resume" means "Reschedule to NOW and process"
// "Discard" might need a backend handler to set them to 'failed' or 'cancelled'?
// Actually, if we just Resume, the backend logic handles them.
// If we want to skip them, we should probably have a way to cancel them.

export const RescheduleModal: React.FC<RescheduleModalProps> = ({ missedJobs, onResume, onDiscard }) => {
    if (missedJobs.length === 0) return null

    const handleResumeAll = () => {
        onResume(missedJobs.map(j => j.id))
    }

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: '#1e1e1e', padding: '24px', borderRadius: '12px',
                width: '500px', maxWidth: '90%', border: '1px solid #333',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', color: '#f59e0b' }}>
                    <AlertTriangle size={24} />
                    <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>Application Crash Detected</h2>
                </div>

                <p style={{ color: '#aaa', marginBottom: '20px', lineHeight: '1.5' }}>
                    The application seems to have closed unexpectedly while <strong>{missedJobs.length} jobs</strong> were scheduled.
                    Would you like to resume them now?
                </p>

                <div style={{
                    maxHeight: '200px', overflowY: 'auto', background: '#111',
                    borderRadius: '8px', padding: '10px', marginBottom: '20px',
                    border: '1px solid #333'
                }}>
                    {missedJobs.map(job => (
                        <div key={job.id} style={{
                            display: 'flex', justifyContent: 'space-between',
                            padding: '8px', borderBottom: '1px solid #222', fontSize: '0.9rem'
                        }}>
                            <span style={{ color: '#fff' }}>[{job.type}] Job #{job.id}</span>
                            <span style={{ color: '#666' }}>{new Date(job.scheduled_for).toLocaleString()}</span>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={onDiscard}
                        style={{
                            padding: '8px 16px', background: 'transparent', border: '1px solid #444',
                            color: '#aaa', borderRadius: '6px', cursor: 'pointer'
                        }}
                    >
                        Ignore (Keep Pending)
                    </button>

                    <button
                        onClick={handleResumeAll}
                        style={{
                            padding: '8px 20px', background: '#3b82f6', border: 'none',
                            color: '#fff', borderRadius: '6px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600
                        }}
                    >
                        <Play size={16} />
                        Resume Queue
                    </button>
                </div>
            </div>
        </div>
    )
}
