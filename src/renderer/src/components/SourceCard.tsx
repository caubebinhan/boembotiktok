import React from 'react'

interface SourceCardProps {
    type: 'channel' | 'keyword'
    name: string
    filterCriteria: string
    onRemove: () => void
}

export const SourceCard: React.FC<SourceCardProps> = ({ type, name, filterCriteria, onRemove }) => {
    let criteria: any = {}
    try { criteria = JSON.parse(filterCriteria || '{}') } catch { /* ignore */ }

    const filterParts: string[] = []
    if (criteria.minViews > 0) filterParts.push(`≥${(criteria.minViews / 1000).toFixed(0)}k views`)
    if (criteria.minLikes > 0) filterParts.push(`≥${(criteria.minLikes / 1000).toFixed(0)}k likes`)
    if (criteria.minComments > 0) filterParts.push(`≥${criteria.minComments} comments`)
    if (criteria.dateFrom) filterParts.push(`from ${criteria.dateFrom}`)
    if (criteria.dateTo) filterParts.push(`to ${criteria.dateTo}`)

    return (
        <div className="source-card">
            <div className={`source-icon ${type}`}>
                {type === 'channel' ? '📺' : '🔍'}
            </div>
            <div className="source-info">
                <div className="source-name">
                    {type === 'channel' ? `@${name}` : `"${name}"`}
                </div>
                <div className="source-filters">
                    {filterParts.length > 0 ? filterParts.join(' · ') : 'No filters set'}
                </div>
            </div>
            <button className="btn-icon source-remove" onClick={onRemove} title="Remove">
                ✕
            </button>
        </div>
    )
}
