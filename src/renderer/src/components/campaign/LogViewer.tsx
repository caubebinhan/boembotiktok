import React, { useState, useMemo } from 'react'
import { formatDateTime } from '../../utils/formatters'

interface Props {
    jobs: any[]
}

export const LogViewer: React.FC<Props> = ({ jobs }) => {
    const [filter, setFilter] = useState<'ALL' | 'ERROR' | 'INFO'>('ALL')

    // Flatten jobs into log entries
    const logs = useMemo(() => {
        const entries: any[] = []
        jobs.forEach(job => {
            // Main job creation entry
            entries.push({
                id: `${job.id}_created`,
                time: job.created_at,
                type: 'INFO',
                message: `Job #${job.id} (${job.type}) created`,
                jobId: job.id
            })

            // Status updates (simulated from current status)
            if (job.status === 'completed') {
                entries.push({
                    id: `${job.id}_completed`,
                    time: job.completed_at || job.updated_at,
                    type: 'SUCCESS',
                    message: `Job #${job.id} completed successfully`,
                    jobId: job.id
                })
            } else if (job.status === 'failed') {
                entries.push({
                    id: `${job.id}_failed`,
                    time: job.updated_at,
                    type: 'ERROR',
                    message: `Job #${job.id} failed: ${job.error_message}`,
                    jobId: job.id
                })
            }

            // Detailed steps from data_json (if we stored log array there)
            // For now, we simulate basic logs
        })
        return entries.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    }, [jobs])

    const filteredLogs = logs.filter(l => {
        if (filter === 'ALL') return true
        if (filter === 'ERROR') return l.type === 'ERROR'
        return true
    })

    return (
        <div style={{ padding: '0 32px 32px 80px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                    📋 DETAILED LOGS
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {['ALL', 'ERROR', 'INFO'].map(f => (
                        <button
                            key={f}
                            className={`btn btn-sm ${filter === f ? 'btn-secondary' : 'btn-ghost'}`}
                            onClick={() => setFilter(f as any)}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{
                background: '#111', borderRadius: '8px',
                border: '1px solid var(--border-primary)',
                fontFamily: 'monospace', fontSize: '12px',
                maxHeight: '400px', overflowY: 'auto'
            }}>
                {filteredLogs.map(log => (
                    <div key={log.id} style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid #222',
                        color: log.type === 'ERROR' ? '#ef4444' : log.type === 'SUCCESS' ? '#4ade80' : '#d1d5db',
                        display: 'flex', gap: '12px'
                    }}>
                        <span style={{ color: '#6b7280', minWidth: '130px' }}>{formatDateTime(log.time)}</span>
                        <span style={{ fontWeight: 700, minWidth: '80px' }}>[{log.type}]</span>
                        <span>{log.message}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
