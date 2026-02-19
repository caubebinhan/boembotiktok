import React from 'react'
import { VideoStatus, getStatusColorHex } from '../../utils/campaignStateManager'
import { formatDateTime } from '../../utils/formatters'

interface Props {
    video: any
    status: VideoStatus
    downloadJob?: any
    publishJob?: any
    onAction: (action: string, id: number) => void
}

export const TimelineItem: React.FC<Props> = ({ video, status, downloadJob, publishJob, onAction }) => {
    const colorHex = getStatusColorHex(status.color)

    // Calculate progress width if applicable
    const progressWidth = status.progress ? `${status.progress}%` : '0%'
    const showProgress = status.state.includes('UPLOADING') || status.state.includes('EDITING') || status.state.includes('DOWNLOADING')

    return (
        <div style={{
            marginBottom: '24px',
            position: 'relative',
            paddingLeft: '24px'
        }}>
            {/* Timeline Connector */}
            <div style={{
                position: 'absolute', left: '0', top: '32px', bottom: '-24px', width: '2px',
                background: 'var(--border-primary)', zIndex: 0
            }} />

            {/* Time Marker */}
            <div style={{
                position: 'absolute', left: '-80px', top: '4px',
                fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right', width: '70px',
                whiteSpace: 'nowrap'
            }}>
                {formatDateTime(downloadJob?.scheduled_for || downloadJob?.created_at || publishJob?.created_at || new Date().toISOString(), true)}
            </div>

            {/* Main Card */}
            <div className="timeline-item" data-testid={`video-${video.id}`} style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${status.color === 'gray' ? 'var(--border-primary)' : colorHex + '40'}`,
                borderRadius: '12px',
                padding: '16px',
                position: 'relative',
                zIndex: 1,
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                        {/* Thumbnail */}
                        <div style={{
                            width: '48px', height: '64px', borderRadius: '6px',
                            background: '#000', overflow: 'hidden', flexShrink: 0,
                            border: '1px solid var(--border-primary)'
                        }}>
                            {video.thumbnail ? (
                                <img src={video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎬</div>
                            )}
                        </div>

                        {/* Title & Target */}
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                                {(() => {
                                    try {
                                        const d = publishJob?.data_json ? JSON.parse(publishJob.data_json) : {}
                                        return d.caption || video.description || 'Untitled Video'
                                    } catch {
                                        return video.description || 'Untitled Video'
                                    }
                                })()}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    🎯 @{JSON.parse(publishJob?.data_json || '{}').account_name || 'queued'}
                                </span>

                                <span style={{
                                    padding: '2px 8px', borderRadius: '4px',
                                    background: `${colorHex}20`, color: colorHex,
                                    fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px'
                                }}>
                                    {status.icon} {status.state}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {status.action === 'retry' && (
                            <button className="btn btn-sm" style={{ background: '#ef4444', color: '#fff', border: 'none' }}
                                onClick={() => onAction('retry', publishJob?.id || downloadJob?.id)}>
                                🔄 Retry
                            </button>
                        )}
                        {status.action === 'captcha' && (
                            <button className="btn btn-sm" style={{ background: '#f97316', color: '#fff', border: 'none' }}
                                onClick={() => onAction('captcha', publishJob?.id)}>
                                ✋ Solve CAPTCHA
                            </button>
                        )}
                        {publishJob && publishJob.status === 'pending' && (
                            <button className="btn btn-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', fontSize: '11px' }}
                                onClick={() => onAction('edit-caption', publishJob.id)}
                                title="Edit Caption">
                                ✏️ Edit
                            </button>
                        )}
                        {publishJob && publishJob.status === 'completed' && (
                            <button className="btn btn-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', fontSize: '11px' }}
                                onClick={() => onAction('refresh', publishJob.id)}
                                title="Check generic status again">
                                🔄 Status
                            </button>
                        )}
                        <button className="btn btn-ghost btn-sm">⋮</button>
                    </div>
                </div>

                {/* Progress Bar */}
                {showProgress && (
                    <div style={{
                        height: '6px', background: 'var(--bg-primary)', borderRadius: '3px',
                        overflow: 'hidden', marginBottom: '12px'
                    }}>
                        <div style={{
                            width: progressWidth, height: '100%', background: colorHex,
                            transition: 'width 0.5s ease'
                        }} />
                    </div>
                )}

                {/* Status Message */}
                <div style={{ fontSize: '13px', color: colorHex, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {showProgress && <span className="spinner" style={{ width: '12px', height: '12px', borderTopColor: colorHex }} />}
                    {status.message}
                </div>

                {/* Sub-steps (Mini Logs) */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-primary)', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {downloadJob && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {(downloadJob.status === 'completed' || (downloadJob.status.startsWith('Failed') && JSON.parse(downloadJob.result_json || '{}').video_path)) ? (() => {
                                const res = downloadJob.result_json ? JSON.parse(downloadJob.result_json) : {}
                                const filename = res.video_path ? res.video_path.split(/[\\/]/).pop() : ''
                                return (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ color: downloadJob.status === 'completed' ? '#4ade80' : '#ef4444' }}>
                                            {downloadJob.status === 'completed' ? '✓' : '⚠️'}
                                        </span>
                                        {downloadJob.status === 'completed' ? 'Downloaded' : 'Failed Download'}
                                        {res.video_path && (
                                            <span
                                                title={res.video_path}
                                                style={{ cursor: 'pointer', color: 'var(--accent-primary)', textDecoration: 'underline', fontSize: '10px' }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // @ts-ignore
                                                    window.api.invoke('open-path', res.folder_path || res.video_path)
                                                }}
                                            >
                                                📂 {filename || 'Open File'}
                                            </span>
                                        )}
                                        <span style={{ color: 'var(--text-muted)' }}>- {formatDateTime(downloadJob.created_at)}</span>
                                    </span>
                                )
                            })() : (downloadJob.status === 'running'
                                ? `Downloading... - ${formatDateTime(downloadJob.created_at)}`
                                : `Scheduled Download - ${formatDateTime(downloadJob.scheduled_for || downloadJob.created_at)}`)
                            }
                        </div>
                    )}
                    {publishJob && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <span style={{ color: publishJob.status === 'completed' ? '#4ade80' : 'var(--text-muted)' }}>
                                    {publishJob.status === 'completed' ? '✓' : (publishJob.status === 'failed' ? '❌' : '🚀')}
                                </span>
                                Publish: {publishJob.status} - {formatDateTime(publishJob.created_at)}
                            </div>

                            {/* Detailed Error & Screenshot */}
                            {publishJob.status === 'failed' && (
                                <div style={{
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    borderRadius: '6px',
                                    padding: '12px',
                                    marginTop: '4px',
                                    fontSize: '12px',
                                    color: '#fca5a5'
                                }}>
                                    <div style={{ marginBottom: '8px', fontWeight: 600 }}>Error Details:</div>
                                    <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: '100px', overflowY: 'auto' }}>
                                        {publishJob.error_message || 'Unknown error occurred'}
                                    </div>

                                    {/* Debug Artifacts */}
                                    {(() => {
                                        try {
                                            const res = publishJob.result_json ? JSON.parse(publishJob.result_json) : {}
                                            if (res.debugArtifacts && res.debugArtifacts.screenshot) {
                                                return (
                                                    <div style={{ marginTop: '12px' }}>
                                                        <div style={{ marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Debug Screenshot:</div>
                                                        <div
                                                            style={{
                                                                width: '200px',
                                                                height: '112px',
                                                                borderRadius: '4px',
                                                                border: '1px solid var(--border-primary)',
                                                                overflow: 'hidden',
                                                                cursor: 'pointer',
                                                                position: 'relative',
                                                                background: '#000'
                                                            }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                // @ts-ignore
                                                                if (window.api && window.api.invoke) {
                                                                    // @ts-ignore
                                                                    window.api.invoke('open-path', res.debugArtifacts.screenshot)
                                                                }
                                                            }}
                                                            title="Click to open image"
                                                        >
                                                            {/* We can't easily load local file as src in renderer without protocol, 
                                                                so for now just a placeholder or try to use `video` protocol if available. 
                                                                actually, usually electron supports file:// in dev or specific setup. 
                                                                Let's allow user to open it externally for now as per previous logic, 
                                                                but maybe show a 'Click to View' box. 
                                                            */}
                                                            <div style={{
                                                                width: '100%', height: '100%',
                                                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                                                background: 'rgba(0,0,0,0.5)', color: '#fff'
                                                            }}>
                                                                <span style={{ fontSize: '24px' }}>📸</span>
                                                                <span style={{ fontSize: '10px', marginTop: '4px' }}>Open Screenshot</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }
                                        } catch (e) { return null }
                                    })()}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
