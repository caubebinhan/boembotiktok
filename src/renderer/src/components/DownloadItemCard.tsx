import React from 'react'
import { DownloadItem } from '../types/picker'

interface Props {
    item: DownloadItem
    onRetry: (id: number) => void
    onOpenFile: (path: string) => void
}

const DownloadItemCard: React.FC<Props> = ({ item, onRetry, onOpenFile }) => {
    const isDownloading = item.status === 'downloading'
    const isFailed = item.status === 'failed'
    const isCompleted = item.status === 'completed'

    let metadata: any = {}
    try {
        metadata = item.metadata ? JSON.parse(item.metadata) : {}
    } catch { }

    return (
        <div className="card" style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '10px' }}>
            {/* Thumbnail */}
            <div style={{
                width: '60px',
                height: '80px',
                borderRadius: '6px',
                overflow: 'hidden',
                flexShrink: 0,
                backgroundColor: '#eee'
            }}>
                {metadata.thumbnail ? (
                    <img src={metadata.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                        No Img
                    </div>
                )}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.platform_id}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Status: <span style={{
                        color: isFailed ? 'var(--accent-red)' : isCompleted ? 'var(--accent-green)' : 'var(--text-primary)'
                    }}>{item.status}</span>
                </div>
                {item.error && (
                    <div style={{ fontSize: '11px', color: 'var(--accent-red)' }}>{item.error}</div>
                )}

                {/* Progress Bar (Fake for now as we don't stream progress yet) */}
                {isDownloading && (
                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}>
                        <div className="shimmer" style={{ width: '50%', height: '100%', background: 'var(--accent-blue)' }}></div>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div>
                {isFailed && (
                    <button
                        className="btn-icon"
                        onClick={() => onRetry(item.id)}
                        title="Retry Download"
                    >
                        🔄
                    </button>
                )}
                {isCompleted && item.file_path && (
                    <button
                        className="btn-icon"
                        onClick={() => onOpenFile(item.file_path!)}
                        title="Open File"
                    >
                        📂
                    </button>
                )}
            </div>
        </div>
    )
}

export default DownloadItemCard
