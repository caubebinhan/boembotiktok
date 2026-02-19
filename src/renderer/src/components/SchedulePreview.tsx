import React, { useState, useEffect, useRef } from 'react'
import DatePicker from 'react-datepicker'
import "react-datepicker/dist/react-datepicker.css"
import { format } from 'date-fns'
import { VideoCard } from './VideoCard'

interface SchedulePreviewProps {
    sources: any[]
    savedVideos: any[]
    schedule: {
        interval: number // minutes
        runAt?: string // ISO string or relevant start time
        days: string[]
        startTime?: string
        endTime?: string
        jitter?: boolean
    }
    initialItems?: any[]
    captionTemplate?: string // NEW PROP
    onScheduleChange?: (items: TimelineItem[]) => void
    onStartTimeChange?: (date: Date) => void
    onIntervalChange?: (interval: number) => void
    onSourcesChange?: (sources: any[]) => void
    onWindowChange?: (start: string, end: string) => void // NEW PROP
    onWindowChange?: (start: string, end: string) => void // NEW PROP
}

export interface TimelineItem {
    id: string
    time: Date
    type: 'post' | 'scan'
    label: string
    detail: string
    icon: string
    video?: any
    sourceId?: string
    isFixed?: boolean
    customCaption?: string // NEW FIELD
}

// Simple Caption Generator for Preview
const generateCaption = (template: string, video: any, time: Date): string => {
    if (!template) return video.description || ''

    let caption = template

    // Helper to strip tags from description - Robust Unicode version
    const stripTags = (text: string) => text.replace(/#[\p{L}\p{N}_]+/gu, '').trim()

    if (caption.includes('{original_no_tags}')) {
        caption = caption.replace(/{original_no_tags}/g, stripTags(video.description || ''))
    }
    caption = caption.replace(/{original}/g, video.description || '')

    if (caption.includes('{time}')) {
        caption = caption.replace(/{time}/g, format(time, 'HH:mm'))
    }
    if (caption.includes('{date}')) {
        caption = caption.replace(/{date}/g, format(time, 'yyyy-MM-dd'))
    }
    caption = caption.replace(/{author}/g, video.author || 'unknown')

    if (caption.includes('{tags}')) {
        // Mock tags or extract from desc
        caption = caption.replace(/{tags}/g, '')
    }

    return caption
}

export const SchedulePreview: React.FC<SchedulePreviewProps> = ({ sources, savedVideos, schedule, initialItems, captionTemplate, onScheduleChange, onStartTimeChange, onIntervalChange, onSourcesChange }) => {
    // ... (keep existing state setup) ...
    const [items, setItems] = useState<TimelineItem[]>([])
    const [startTime, setStartTime] = useState<Date>(new Date())
    const [interval, setInterval] = useState<number>(schedule.interval || 15)
    const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null)
    const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null) // Track which item is being edited

    // ... (Keep useEffect for init, but ensure customCaption is preserved/generated) ...
    useEffect(() => {
        // ... (Time init logic matches original) ...
        let start = new Date()
        if (schedule.runAt) {
            const parsed = new Date(schedule.runAt)
            if (!isNaN(parsed.getTime())) {
                start = parsed
                if (start < new Date() && parsed.getTime() < Date.now() - 3600000) {
                    start = new Date()
                }
            }
        }
        if (!schedule.runAt) {
            start = new Date(Date.now() + 5 * 60000)
        }
        setStartTime(start)
        setInterval(schedule.interval || 15)

        if (initialItems && initialItems.length > 0) {
            const restored = initialItems.map(i => ({
                ...i,
                time: new Date(i.time)
            }))
            setItems(restored)
            return
        }

        const newItems: TimelineItem[] = []
        // Helper
        const formatCount = (n: number | string | undefined): string => {
            const num = typeof n === 'string' ? parseInt(n) : (n || 0)
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
            return String(num)
        }

        savedVideos.forEach((video, i) => {
            const stats = video.stats || {}
            newItems.push({
                id: `post-${video.id}`,
                time: new Date(),
                type: 'post',
                label: `Post Video`,
                detail: `👁️ ${formatCount(stats.views)} • ❤️ ${formatCount(stats.likes)}`,
                icon: '🎬',
                video: video,
                customCaption: undefined // Use undefined to allow dynamic template fallback
            })
        })

        // Scans ...
        sources.forEach((source, i) => {
            newItems.push({
                id: `scan-${source.name}-${i}`,
                time: new Date(),
                type: 'scan',
                label: `Scan Source`,
                detail: `${source.type === 'channel' ? '@' : ''}${source.name}`,
                icon: source.type === 'channel' ? '📺' : '🔍',
                sourceId: source.name
            })
        })

        recalculateTimes(newItems, start, schedule.interval || 15)
    }, [savedVideos, sources, schedule.runAt, schedule.interval, captionTemplate, (schedule as any).startTime, (schedule as any).endTime])

    // Helper to filter out past times for the selected date
    const filterPassedTime = (time: Date) => {
        const currentDate = new Date()
        const selectedDate = new Date(time)
        return currentDate.getTime() < selectedDate.getTime()
    }

    // ... (Keep recalculateTimes, handlers, drag & drop) ...
    // Recalculate times based on order + start + interval + jitter + daily constraints
    // ... (Keep exact implementation of recalculateTimes from lines 147-210 of original)
    const recalculateTimes = (currentItems: TimelineItem[], start: Date, step: number) => {
        let cursorTime = new Date(start)
        const getMinutes = (timeStr: string) => {
            const [h, m] = timeStr.split(':').map(Number)
            return (h || 0) * 60 + (m || 0)
        }
        const dailyStart = (schedule as any).startTime ? getMinutes((schedule as any).startTime) : 9 * 60
        const dailyEnd = (schedule as any).endTime ? getMinutes((schedule as any).endTime) : 21 * 60

        const ensureValidTime = (date: Date): Date => {
            let d = new Date(date)
            let currentMins = d.getHours() * 60 + d.getMinutes()
            if (currentMins < dailyStart) {
                d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
            }
            else if (currentMins >= dailyEnd) {
                d.setDate(d.getDate() + 1)
                d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
            }
            return d
        }

        const updated = currentItems.map((item, index) => {
            const naturalTime = ensureValidTime(new Date(cursorTime))
            let itemTime: Date
            if (item.isFixed && item.time) {
                itemTime = new Date(item.time)
            } else {
                itemTime = new Date(naturalTime)
            }
            let duration = step * 60000
            const hasJitter = (schedule as any).jitter
            if (hasJitter) {
                const variation = (Math.random() * 0.4) - 0.2
                duration = duration * (1 + variation)
            }
            cursorTime = new Date(naturalTime.getTime() + duration)
            return { ...item, time: itemTime }
        })
        updated.sort((a, b) => a.time.getTime() - b.time.getTime())
        setItems(updated)
        onScheduleChange?.(updated)
    }

    // ... (Keep existing handlers with same logic) ...
    const handleStartTimeChange = (date: Date | null) => {
        if (date && !isNaN(date.getTime())) {
            setStartTime(date)
            onStartTimeChange?.(date)
            const newItems = [...items]
            if (newItems.length > 0) { (newItems[0] as any).isFixed = false }
            recalculateTimes(newItems, date, interval)
        }
    }

    const handleIntervalChange = (valInput: string | number) => {
        if (valInput === '') { setInterval(0); return } // hack to avoid error but handle empty
        const val = Number(valInput)
        const newInterval = Math.max(1, val)
        setInterval(newInterval)
        recalculateTimes(items, startTime, newInterval)
        onIntervalChange?.(newInterval)
    }

    const onDragStart = (e: React.DragEvent, index: number) => {
        setDraggedItemIndex(index)
        e.dataTransfer.effectAllowed = "move"
    }

    const onDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        if (draggedItemIndex === null || draggedItemIndex === index) return
        const newItems = [...items]
        const draggedItem = newItems[draggedItemIndex]
        newItems.splice(draggedItemIndex, 1)
        newItems.splice(index, 0, draggedItem)
        setItems(newItems)
        setDraggedItemIndex(index)
    }

    const onDragEnd = () => {
        setDraggedItemIndex(null)
        recalculateTimes(items, startTime, interval)
    }

    const handleManualTimeChange = (index: number, date: Date | null) => {
        if (!date || isNaN(date.getTime())) return
        const newItems = [...items]
        newItems[index] = { ...newItems[index], time: date, isFixed: true }
        if (index === 0) { setStartTime(date) }
        recalculateTimes(newItems, startTime, interval)
    }

    const toggleExpand = (id: string) => {
        setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }))
    }

    // NEW: Handle Caption Change
    const handleCaptionChange = (index: number, val: string) => {
        const newItems = [...items]
        newItems[index] = { ...newItems[index], customCaption: val }
        setItems(newItems)
        onScheduleChange?.(newItems)
    }


    // Group items by Date label (Same logic)
    const groupedItems: { label: string; items: { data: TimelineItem; index: number }[] }[] = []
    let lastDateLabel = ''
    items.forEach((item, index) => {
        const today = new Date().toDateString()
        const tomorrow = new Date(Date.now() + 86400000).toDateString()
        const itemDate = item.time.toDateString()
        let label = item.time.toLocaleDateString()
        if (itemDate === today) label = 'Today'
        else if (itemDate === tomorrow) label = 'Tomorrow'
        if (label !== lastDateLabel) {
            groupedItems.push({ label, items: [] })
            lastDateLabel = label
        }
        groupedItems[groupedItems.length - 1].items.push({ data: item, index })
    })

    return (
        <div className="wizard-step">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
                {/* ... (Keep existing Header UI) ... */}
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Campaign Start Time</label>
                    <DatePicker
                        selected={startTime}
                        onChange={handleStartTimeChange}
                        showTimeSelect timeIntervals={15}
                        dateFormat="yyyy-MM-dd HH:mm" timeFormat="HH:mm"
                        minDate={new Date()}
                        filterTime={filterPassedTime}
                        className="form-control"
                        wrapperClassName="datepicker-wrapper"
                    />

                </div>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Gap between actions</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="number"
                            min="1"
                            value={interval}
                            onChange={(e) => handleIntervalChange(e.target.value)}
                            className="form-control"
                            style={{ width: '80px', padding: '6px' }}
                        />
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>minutes</span>
                    </div>
                </div>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Daily Window</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <input
                            type="time"
                            value={(schedule as any).startTime || '07:00'}
                            onChange={(e) => {
                                const newStart = e.target.value;
                                const currentEnd = (schedule as any).endTime || '23:00';
                                onWindowChange?.(newStart, currentEnd);
                            }}
                            className="form-control"
                            style={{ width: '80px', padding: '4px', fontSize: '12px' }}
                        />
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                        <input
                            type="time"
                            value={(schedule as any).endTime || '23:00'}
                            onChange={(e) => {
                                const newEnd = e.target.value;
                                const currentStart = (schedule as any).startTime || '07:00';
                                onWindowChange?.(currentStart, newEnd);
                            }}
                            className="form-control"
                            style={{ width: '80px', padding: '4px', fontSize: '12px' }}
                        />
                    </div>
                </div>
            </div>

            {/* Timing Summary */}
            <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px', display: 'flex', gap: '20px', fontSize: '13px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>First Scan:</span>
                    <span>{items.find(i => i.type === 'scan')?.time.toLocaleString() || 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600, color: '#10b981' }}>First Upload:</span>
                    <span>{items.find(i => i.type === 'post')?.time.toLocaleString() || 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Total Items:</span>
                    <span>{items.length} actions</span>
                </div>
            </div>

            {/* Source Configuration Section */}
            <div style={{ marginBottom: '20px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase' }}>
                    Source Verification Options
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                    {sources.map((src, idx) => (
                        <div key={idx} style={{ background: 'var(--bg-primary)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '16px' }}>{src.type === 'channel' ? '📺' : '🔍'}</span>
                                <div style={{ fontSize: '13px', fontWeight: 500 }}>{src.name}</div>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={src.autoSchedule ?? true}
                                    onChange={e => {
                                        const newSources = [...sources]
                                        newSources[idx] = { ...newSources[idx], autoSchedule: e.target.checked }
                                        onSourcesChange?.(newSources)
                                    }}
                                    style={{ width: '14px', height: '14px' }}
                                />
                                <span style={{ fontSize: '12px' }}>Auto-schedule</span>
                            </label>
                        </div>
                    ))}
                </div>
            </div>

            <div className="timeline-container" style={{ padding: '0 10px', maxHeight: '500px', overflowY: 'auto' }}>
                {groupedItems.map((group, gIdx) => (
                    <div key={gIdx} style={{ marginBottom: '25px' }}>
                        <div style={{
                            fontSize: '13px', fontWeight: 600, color: 'var(--accent-primary)',
                            marginBottom: '12px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)',
                            padding: '8px 0', textTransform: 'uppercase', letterSpacing: '0.5px'
                        }}>
                            {group.label}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {group.items.map(({ data: item, index }) => (
                                <div
                                    key={item.id}
                                    draggable
                                    onDragStart={(e) => onDragStart(e, index)}
                                    onDragOver={(e) => onDragOver(e, index)}
                                    onDragEnd={onDragEnd}
                                    style={{
                                        display: 'flex', gap: '16px', alignItems: 'flex-start',
                                        background: draggedItemIndex === index ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                                        border: draggedItemIndex === index ? '1px dashed var(--accent-primary)' : '1px solid var(--border-primary)',
                                        padding: '12px', borderRadius: '8px', cursor: 'grab',
                                        transition: 'transform 0.2s, box-shadow 0.2s',
                                        opacity: draggedItemIndex === index ? 0.6 : 1
                                    }}
                                >
                                    {/* Drag Handle & Time */}
                                    <div style={{ minWidth: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', paddingTop: '4px' }}>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '20px', lineHeight: '10px' }}>⋮⋮</div>
                                        <DatePicker
                                            selected={item.time}
                                            onChange={(date: Date | null) => handleManualTimeChange(index, date)}
                                            showTimeSelect timeIntervals={15}
                                            dateFormat="MM/dd HH:mm" timeFormat="HH:mm"
                                            minDate={new Date()}
                                            filterTime={filterPassedTime}
                                            className="form-control"
                                            // @ts-ignore
                                            onKeyDown={(e) => e.stopPropagation()}
                                            // @ts-ignore
                                            onClickOutside={(e) => { }}
                                            popperPlacement="right"
                                            customInput={
                                                <input style={{
                                                    background: 'var(--bg-input)', border: '1px solid var(--border-primary)',
                                                    color: 'var(--text-primary)', borderRadius: '4px', padding: '4px 8px',
                                                    fontSize: '12px', width: '120px', textAlign: 'center', cursor: 'pointer'
                                                }} />
                                            }
                                        />
                                        {item.isFixed && <span style={{ fontSize: '10px', color: 'var(--accent-primary)' }}>Fixed</span>}
                                    </div>

                                    {/* Content */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '16px' }}>{item.icon}</span>
                                                <span style={{ fontWeight: 600, fontSize: '14px' }}>{item.label}</span>
                                                <span className="tabular-nums" style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                                                    Seq #{index + 1}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const newItems = [...items]
                                                    newItems.splice(index, 1)
                                                    setItems(newItems)
                                                    recalculateTimes(newItems, startTime, interval)
                                                }}
                                                className="btn btn-ghost"
                                                style={{ padding: '4px', height: 'auto', color: 'var(--text-muted)' }}
                                                title="Remove from schedule"
                                            >
                                                🗑️
                                            </button>
                                        </div>

                                        {item.video && (
                                            <div style={{
                                                marginTop: '4px',
                                                display: 'flex',
                                                gap: '12px',
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-primary)',
                                                borderRadius: '6px',
                                                padding: '8px'
                                            }}>
                                                <div style={{ position: 'relative', width: '60px', height: '80px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden' }}>
                                                    {item.video.thumbnail ? (
                                                        <img src={item.video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎬</div>
                                                    )}
                                                    <div style={{
                                                        position: 'absolute', bottom: 0, left: 0, width: '100%',
                                                        background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
                                                        padding: '4px 2px', display: 'flex', justifyContent: 'center', gap: '4px'
                                                    }}>
                                                        <span className="tabular-nums" style={{ fontSize: '9px', color: '#fff' }}>👁️ {item.video.stats?.views ? (typeof item.video.stats.views === 'number' ? (item.video.stats.views > 1000 ? (item.video.stats.views / 1000).toFixed(1) + 'K' : item.video.stats.views) : item.video.stats.views) : '0'}</span>
                                                    </div>
                                                </div>

                                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {/* Editable Caption Preview */}
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                                        Caption Preview:
                                                    </div>

                                                    {/* We use customCaption if set, otherwise generate from template */}
                                                    {editingCaptionId === item.id ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                                {[
                                                                    { label: 'Orig', code: '{original}' },
                                                                    { label: 'NoTags', code: '{original_no_tags}' },
                                                                    { label: 'Time', code: '{time}' },
                                                                    { label: 'Date', code: '{date}' }
                                                                ].map(tag => (
                                                                    <button
                                                                        key={tag.code}
                                                                        className="btn btn-xs btn-ghost"
                                                                        style={{ fontSize: '9px', padding: '2px 4px', border: '1px solid var(--border-primary)', cursor: 'pointer' }}
                                                                        onClick={() => handleCaptionChange(index, (item.customCaption !== undefined ? item.customCaption : (captionTemplate || item.video?.description || '')) + ' ' + tag.code)}
                                                                        title={`Insert ${tag.code}`}
                                                                    >
                                                                        {tag.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <textarea
                                                                    className="form-control"
                                                                    value={item.customCaption !== undefined ? item.customCaption : (captionTemplate || item.video?.description || '')}
                                                                    onChange={(e) => handleCaptionChange(index, e.target.value)}
                                                                    rows={3}
                                                                    style={{ width: '100%', fontSize: '12px', padding: '6px' }}
                                                                    autoFocus
                                                                />
                                                                <button
                                                                    className="btn btn-sm btn-primary"
                                                                    onClick={() => setEditingCaptionId(null)}
                                                                    style={{ height: '30px' }}
                                                                >
                                                                    Done
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div
                                                            onClick={() => setEditingCaptionId(item.id)}
                                                            style={{
                                                                fontSize: '12px',
                                                                color: 'var(--text-primary)',
                                                                lineHeight: '1.3',
                                                                padding: '6px',
                                                                background: 'var(--bg-input)',
                                                                border: '1px solid transparent',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                minHeight: '20px'
                                                            }}
                                                            title="Click to edit caption"
                                                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-primary)'}
                                                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                                                        >
                                                            {item.customCaption !== undefined
                                                                ? (item.customCaption || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(Empty caption)</span>)
                                                                : (captionTemplate || item.video?.description || '')
                                                            }
                                                        </div>
                                                    )}

                                                    <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                                        <span className="tabular-nums" style={{ color: '#ff2c55', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                            ❤️ {item.video.stats?.likes ? (typeof item.video.stats.likes === 'number' ? (item.video.stats.likes > 1000 ? (item.video.stats.likes / 1000).toFixed(1) + 'K' : item.video.stats.likes) : item.video.stats.likes) : '0'}
                                                        </span>
                                                        <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {item.video.url}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {!item.video && (
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                {item.detail}
                                            </div>
                                        )}
                                    </div>

                                </div>
                            ))}
                        </div>
                    </div>
                ))
                }
            </div >
        </div >
    )
}
