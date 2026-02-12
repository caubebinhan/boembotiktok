import React from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { FilterCriteria } from '../types/picker'

interface FollowModalProps {
    type: 'channel' | 'keyword'
    name: string
    onConfirm: (criteria: FilterCriteria) => void
    onCancel: () => void
}

export const FollowModal: React.FC<FollowModalProps> = ({ type, name, onConfirm, onCancel }) => {
    const [criteria, setCriteria] = React.useState<FilterCriteria>({
        minViews: 0,
        minLikes: 0,
        minComments: 0,
        dateFrom: '',
        dateTo: ''
    })

    const update = (key: keyof FilterCriteria, value: any) => {
        setCriteria(prev => ({ ...prev, [key]: value }))
    }

    const formatDate = (d: Date | null): string => {
        if (!d) return ''
        return d.toISOString().split('T')[0]
    }

    const dateFromObj = criteria.dateFrom ? new Date(criteria.dateFrom) : null
    const dateToObj = criteria.dateTo ? new Date(criteria.dateTo) : null

    return (
        <div className="follow-modal-overlay" onClick={onCancel}>
            <div className="follow-modal" onClick={e => e.stopPropagation()}>
                <h3>
                    {type === 'channel' ? '📺 Follow Channel' : '🔍 Follow Keyword'}
                </h3>
                <div className="modal-subtitle">
                    {type === 'channel'
                        ? `Set filter criteria for @${name}`
                        : `Set filter criteria for "${name}"`
                    }
                </div>

                <div className="modal-grid">
                    <div className="modal-field">
                        <label>Min Views</label>
                        <input
                            type="number"
                            placeholder="0"
                            value={criteria.minViews || ''}
                            onChange={e => update('minViews', parseInt(e.target.value) || 0)}
                        />
                    </div>
                    <div className="modal-field">
                        <label>Min Likes</label>
                        <input
                            type="number"
                            placeholder="0"
                            value={criteria.minLikes || ''}
                            onChange={e => update('minLikes', parseInt(e.target.value) || 0)}
                        />
                    </div>
                    <div className="modal-field">
                        <label>Min Comments</label>
                        <input
                            type="number"
                            placeholder="0"
                            value={criteria.minComments || ''}
                            onChange={e => update('minComments', parseInt(e.target.value) || 0)}
                        />
                    </div>
                    <div className="modal-field" />
                    <div className="modal-field">
                        <label>Date From</label>
                        <DatePicker
                            selected={dateFromObj}
                            onChange={(date: Date | null) => update('dateFrom', formatDate(date))}
                            selectsStart
                            startDate={dateFromObj}
                            endDate={dateToObj}
                            dateFormat="yyyy-MM-dd"
                            placeholderText="Start date"
                            isClearable
                            className="datepicker-input"
                        />
                    </div>
                    <div className="modal-field">
                        <label>Date To</label>
                        <DatePicker
                            selected={dateToObj}
                            onChange={(date: Date | null) => update('dateTo', formatDate(date))}
                            selectsEnd
                            startDate={dateFromObj}
                            endDate={dateToObj}
                            minDate={dateFromObj}
                            dateFormat="yyyy-MM-dd"
                            placeholderText="End date"
                            isClearable
                            className="datepicker-input"
                        />
                    </div>
                </div>

                <div className="modal-actions">
                    <button className="btn btn-ghost" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={() => onConfirm(criteria)}>
                        {type === 'channel' ? '+ Follow Channel' : '+ Follow Keyword'}
                    </button>
                </div>
            </div>
        </div>
    )
}
