import React from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { FilterCriteria } from '../types/picker'

interface FilterBarProps {
    filters: FilterCriteria
    onFilterChange: (key: keyof FilterCriteria, value: any) => void
    total: number
    visible: number
    onReset: () => void
}

export const FilterBar: React.FC<FilterBarProps> = ({ filters, onFilterChange, total, visible, onReset }) => {
    const isFiltered = filters.minViews > 0 || filters.minLikes > 0 || filters.minComments > 0 || filters.dateFrom || filters.dateTo

    // Parse string dates to Date objects for react-datepicker
    const dateFromObj = filters.dateFrom ? new Date(filters.dateFrom) : null
    const dateToObj = filters.dateTo ? new Date(filters.dateTo) : null

    const formatDate = (d: Date | null): string => {
        if (!d) return ''
        return d.toISOString().split('T')[0]
    }

    return (
        <div className="filter-section">
            <div className="filter-header">
                <h4>Filters</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {visible}/{total}
                    </span>
                    {isFiltered && (
                        <button className="btn btn-ghost btn-sm" onClick={onReset}>
                            Reset
                        </button>
                    )}
                </div>
            </div>
            <div className="filter-grid">
                <div className="filter-item">
                    <label>Min Views</label>
                    <input
                        type="number"
                        placeholder="0"
                        value={filters.minViews || ''}
                        onChange={e => onFilterChange('minViews', parseInt(e.target.value) || 0)}
                    />
                </div>
                <div className="filter-item">
                    <label>Min Likes</label>
                    <input
                        type="number"
                        placeholder="0"
                        value={filters.minLikes || ''}
                        onChange={e => onFilterChange('minLikes', parseInt(e.target.value) || 0)}
                    />
                </div>
                <div className="filter-item">
                    <label>Min Comments</label>
                    <input
                        type="number"
                        placeholder="0"
                        value={filters.minComments || ''}
                        onChange={e => onFilterChange('minComments', parseInt(e.target.value) || 0)}
                    />
                </div>
                <div className="filter-item" /> {/* spacer */}
                <div className="filter-item">
                    <label>Date From</label>
                    <DatePicker
                        selected={dateFromObj}
                        onChange={(date: Date | null) => onFilterChange('dateFrom', formatDate(date))}
                        selectsStart
                        startDate={dateFromObj}
                        endDate={dateToObj}
                        dateFormat="yyyy-MM-dd"
                        placeholderText="Start date"
                        isClearable
                        className="datepicker-input"
                    />
                </div>
                <div className="filter-item">
                    <label>Date To</label>
                    <DatePicker
                        selected={dateToObj}
                        onChange={(date: Date | null) => onFilterChange('dateTo', formatDate(date))}
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
        </div>
    )
}
