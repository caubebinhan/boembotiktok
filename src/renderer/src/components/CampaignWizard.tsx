import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { VideoEditor } from './VideoEditor'
import { AccountSettingsModal } from './AccountSettingsModal'
import { SchedulePreview } from './SchedulePreview'
import { VideoCard } from './VideoCard'

interface CampaignWizardProps {
    onClose: () => void
    onSave: (campaignData: any, runNow: boolean) => void
    initialData?: any
}

interface SourceEntry {
    name: string
    type: 'channel' | 'keyword'
    videoCount?: number
    maxScanCount?: number
    minViews?: number
    minLikes?: number
    sortOrder?: string
}

interface CampaignFormData {
    id?: number
    name: string
    type: 'one_time' | 'scheduled'
    editPipeline: any
    targetAccounts: string[]
    captionTemplate: string
    postOrder: string
    schedule: {
        runAt: string
        interval: number | string
        startTime: string
        endTime: string
        days: string[]
        jitter: boolean
    }
    advancedVerification: boolean
    autoSchedule: boolean
    executionOrder: any[]
}


export const CampaignWizard: React.FC<CampaignWizardProps> = ({ onClose, onSave, initialData }) => {
    // ─── State ───────────────────────────────────────────────────
    const [step, setStep] = useState(1)
    const [runNow, setRunNow] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [formData, setFormData] = useState<CampaignFormData>(() => {
        if (initialData) {
            const config = typeof initialData.config_json === 'string' ? JSON.parse(initialData.config_json) : initialData.config_json || {}
            return {
                name: initialData.name + ' (Copy)',
                type: initialData.type === 'scan_all' ? 'scheduled' : (initialData.type || 'scheduled'),
                editPipeline: config.editPipeline || { effects: [] },
                targetAccounts: config.targetAccounts || [],
                captionTemplate: config.captionTemplate || '',
                postOrder: config.postOrder || 'newest',
                schedule: config.schedule || {
                    runAt: new Date(Date.now() + 60000).toISOString(),
                    interval: 60,
                    startTime: '09:00',
                    endTime: '21:00',
                    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    jitter: false
                },
                advancedVerification: config.advancedVerification || false,
                autoSchedule: config.autoSchedule !== false,
                executionOrder: [] as any[]
            }
        }
        return {
            name: '',
            type: 'one_time' as 'one_time' | 'scheduled',
            editPipeline: { effects: [] as any[] },
            targetAccounts: [] as string[],
            captionTemplate: '',
            postOrder: 'newest' as 'oldest' | 'newest' | 'most_likes' | 'least_likes',
            schedule: {
                runAt: new Date(Date.now() + 60000).toISOString(),
                interval: 60,
                startTime: '09:00',
                endTime: '21:00',
                days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                jitter: false
            },
            advancedVerification: false,
            autoSchedule: true,
            executionOrder: [] as any[]
        }
    })

    // Init sources and videos AND formData from initialData if present
    useEffect(() => {
        if (initialData) {
            const config = typeof initialData.config_json === 'string' ? JSON.parse(initialData.config_json) : initialData.config_json || {}

            // Sync Sources
            if (config.sources) {
                const newSources: SourceEntry[] = []
                if (config.sources.channels) {
                    config.sources.channels.forEach((c: any) => newSources.push({ ...c, type: 'channel' }))
                }
                if (config.sources.keywords) {
                    config.sources.keywords.forEach((k: any) => newSources.push({ ...k, type: 'keyword' }))
                }
                setSources(newSources)
            }
            // Sync Videos
            if (config.videos) {
                setSavedVideos(config.videos)
                setVideoCount(config.videos.length)
            }

            // Sync Form Data (Critical for Clone/Edit)
            // Adjust runAt: if the original schedule's start time is in the past, set to now + 1 minute
            const clonedSchedule = config.schedule || {
                runAt: '',
                interval: 60,
                startTime: '09:00',
                endTime: '21:00',
                days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                jitter: false
            }
            if (clonedSchedule.runAt) {
                const runAtDate = new Date(clonedSchedule.runAt)
                if (runAtDate.getTime() < Date.now() + 60000) {
                    // Set to 5 minutes in future to give user time to edit comfortably
                    clonedSchedule.runAt = new Date(Date.now() + 300000).toISOString()
                }
            }

            setFormData(prev => ({
                ...prev,
                name: initialData.name + (initialData.id ? ' (Copy)' : ''), // Append copy only if cloning existing
                type: initialData.type === 'scan_all' ? 'scheduled' : (initialData.type || 'scheduled'),
                editPipeline: config.editPipeline || { effects: [] },
                targetAccounts: config.targetAccounts || [],
                postOrder: config.postOrder || 'newest',
                schedule: clonedSchedule,
                autoSchedule: config.autoSchedule !== false,
                advancedVerification: config.advancedVerification || false,
                executionOrder: [] // Do not copy execution order, generate fresh
            }))
        }
    }, [initialData])

    const handleSave = async (data: any, runNowOverride: boolean) => {
        if (isSaving) return;
        setIsSaving(true)
        try {
            await onSave(data, runNowOverride)
        } catch (e) {
            console.error(e)
            setIsSaving(false)
        }
    }

    // Source data for Step 2 — received from scanner window
    const [sources, setSources] = useState<SourceEntry[]>([])
    const [videoCount, setVideoCount] = useState(0)
    const [savedVideos, setSavedVideos] = useState<any[]>([])

    // Publish accounts for Step 4
    const [publishAccounts, setPublishAccounts] = useState<any[]>([])
    const [addingAccount, setAddingAccount] = useState(false)
    const [editingAccount, setEditingAccount] = useState<any | null>(null)

    useEffect(() => {
        loadAccounts()
    }, [])

    // Listen for scanner results from new window
    useEffect(() => {
        // @ts-ignore
        const removeListener = window.api.on('scanner-results-received', (results: any) => {
            if (!results) return

            // Add source entry from Cart (Channels & Keywords)
            if (results.channels || results.keywords) {
                setSources(prev => {
                    const newSources = [...prev];

                    // Process Channels
                    if (Array.isArray(results.channels)) {
                        results.channels.forEach((c: any) => {
                            if (!newSources.some(s => s.name === c.name && s.type === 'channel')) {
                                newSources.push({
                                    name: c.name,
                                    type: 'channel',
                                    videoCount: 0,
                                    maxScanCount: 50
                                });
                            }
                        });
                    }

                    // Process Keywords
                    if (Array.isArray(results.keywords)) {
                        results.keywords.forEach((k: any) => {
                            if (!newSources.some(s => s.name === k.keyword && s.type === 'keyword')) {
                                newSources.push({
                                    name: k.keyword,
                                    type: 'keyword',
                                    videoCount: 0,
                                    maxScanCount: 50
                                });
                            }
                        });
                    }

                    return newSources;
                })
            }

            // Fallback for single item (legacy or standalone)
            if (results.type && results.value) {
                setSources(prev => {
                    const exists = prev.some(s => s.name === results.value && s.type === results.type)
                    if (exists) return prev
                    return [...prev, {
                        name: results.value,
                        type: results.type,
                        videoCount: results.videos?.length || 0
                    }]
                })
            }

            // Accumulate videos
            if (results.videos && Array.isArray(results.videos)) {
                const newVids = results.videos.filter((v: any) => v.selected !== false)
                setSavedVideos(prev => {
                    const existingIds = new Set(prev.map(v => v.id))
                    const unique = newVids.filter((v: any) => !existingIds.has(v.id)).map((v: any) => ({
                        id: v.id,
                        url: v.url,
                        description: v.description || v.desc || '', // Preserve original or fallback to empty string if none found
                        thumbnail: v.thumbnail || '',
                        stats: v.stats || { views: 0, likes: 0, comments: 0 },
                        channelName: results.value || ''
                    }))
                    const merged = [...prev, ...unique]
                    setVideoCount(merged.length)
                    return merged
                })
            }
        })

        return () => removeListener()
    }, [])

    const loadAccounts = async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('publish-account:list')
            setPublishAccounts(data || [])
        } catch { }
    }

    const moveVideo = (index: number, direction: 'up' | 'down') => {
        setSavedVideos(prev => {
            const newArr = [...prev]
            const targetIndex = direction === 'up' ? index - 1 : index + 1
            if (targetIndex < 0 || targetIndex >= newArr.length) return prev
                ;[newArr[index], newArr[targetIndex]] = [newArr[targetIndex], newArr[index]]
            return newArr
        })
    }

    const [dateError, setDateError] = useState<string | null>(null)

    const handleNext = () => {
        // Validate Step 1 Schedule (Time check)
        if (step === 1 && !runNow) {
            const runAt = formData.schedule.runAt ? new Date(formData.schedule.runAt) : null
            if (!runAt || isNaN(runAt.getTime())) {
                setDateError('Please select a valid start time.')
                return
            }
            if (runAt.getTime() <= Date.now()) {
                setDateError('Start time must be in the future.')
                return
            }
        }
        setDateError(null)

        console.log(`[Wizard] handleNext called. Current step: ${step}, Type: ${formData.type}`);
        if (step === 2 && formData.type === 'one_time') {
            // Single campaign: Source -> Editor (skip schedule preview)
            console.log('[Wizard] Skipping schedule for one_time, going to step 4 (Editor)');
            setStep(4)
        } else {
            console.log(`[Wizard] Advancing to step ${step + 1}`);
            setStep(s => s + 1)
        }
    }
    const handleBack = () => {
        if (step === 4 && formData.type === 'one_time') {
            setStep(2)
        } else {
            setStep(s => s - 1)
        }
    }

    // For scheduled campaigns: Details(1) -> Source(2) -> Editor(3) -> SchedulePreview(4) -> Target(5)
    // For single campaigns:    Details(1) -> Source(2) -> Editor(4) -> Target(5)
    const steps = formData.type === 'scheduled'
        ? [
            { id: 1, label: 'Details', icon: '📝' },
            { id: 2, label: 'Source', icon: '📡' },
            { id: 3, label: 'Editor', icon: '✂️' },
            { id: 4, label: 'Schedule', icon: '📅' },
            { id: 5, label: 'Target', icon: '🎯' }
        ]
        : [
            { id: 1, label: 'Details', icon: '📝' },
            { id: 2, label: 'Source', icon: '📡' },
            { id: 4, label: 'Editor', icon: '✂️' },
            { id: 5, label: 'Target', icon: '🎯' }
        ]

    const canAdvance = (): boolean => {
        if (step === 1 && !formData.name.trim()) return false
        if (step === 1 && formData.type === 'one_time' && !runNow && !formData.schedule.runAt) return false
        if (step === 1 && formData.type === 'scheduled' && formData.schedule.days.length === 0) return false

        // Step 2 Validation
        if (step === 2) {
            if (formData.type === 'one_time') {
                return savedVideos.length === 1
            }
            if (sources.length === 0 && savedVideos.length === 0) return false
        }

        if (step === 5 && formData.targetAccounts.length === 0) return false
        return true
    }

    const renderStepper = () => (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px', padding: '0 20px' }}>
            {steps.map((s, index) => {
                const isActive = step === s.id
                const isCompleted = step > s.id
                return (
                    <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '50%',
                            background: isActive ? 'var(--accent-primary)' : (isCompleted ? '#4caf50' : 'var(--bg-secondary)'),
                            color: isActive || isCompleted ? '#fff' : 'var(--text-secondary)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 'bold', border: isActive ? '2px solid #fff' : 'none',
                            boxShadow: isActive ? '0 0 10px var(--accent-primary)' : 'none',
                            zIndex: 2, transition: 'all 0.3s'
                        }}>
                            {isCompleted ? '✓' : s.icon}
                        </div>
                        <div style={{ marginTop: '8px', fontSize: '12px', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {s.label}
                        </div>
                        {index < steps.length - 1 && (
                            <div style={{
                                position: 'absolute', top: '20px', left: '50%', width: '100%', height: '2px',
                                background: isCompleted ? '#4caf50' : 'var(--border-primary)', zIndex: 1
                            }} />
                        )}
                    </div>
                )
            })}
        </div>
    )

    // ─── Step 1: Campaign Details + Schedule ────────────────────
    const renderStep1_Basic = () => (
        <div className="wizard-step">
            <h3>Step 1: Campaign Details & Schedule</h3>
            <div className="form-group">
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        Campaign Name
                    </label>
                    <input
                        type="text"
                        className="form-control"
                        autoFocus
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Morning Motivation"
                        data-testid="campaign-name-input"
                        style={{
                            width: '100%', padding: '12px', background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)', borderRadius: '8px',
                            color: '#fff', fontSize: '14px'
                        }}
                    />
                </div>
            </div>
            <div className="form-group">
                <label>Type</label>
                <div className="radio-group" style={{ display: 'flex', gap: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: formData.type === 'one_time' ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: formData.type === 'one_time' ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
                        <input type="radio" checked={formData.type === 'one_time'} onChange={() => setFormData({ ...formData, type: 'one_time' })} />
                        <div>
                            <strong>One-Time Run</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Run once at a scheduled time</div>
                        </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: formData.type === 'scheduled' ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: formData.type === 'scheduled' ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
                        <input type="radio" checked={formData.type === 'scheduled'} onChange={() => setFormData({ ...formData, type: 'scheduled' })} />
                        <div>
                            <strong data-testid="type-scheduled">Scheduled (Recurring)</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Run automatically on schedule</div>
                        </div>
                    </label>
                </div>
            </div>

            <div className="form-group" style={{ marginTop: '16px', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
                    <input
                        type="checkbox"
                        checked={(formData as any).advancedVerification || false}
                        onChange={e => setFormData({ ...formData, advancedVerification: e.target.checked } as any)}
                        style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)' }}
                    />
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>Advanced Verification (Unique Tag)</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Appends a unique 6-char tag to caption to 100% match the published video.
                            <br />
                            <span style={{ color: 'var(--accent-primary)' }}>Default: Off (Checks by recent upload time)</span>
                        </div>
                    </div>
                </label>
            </div>

            {/* Caution Template Section - Moved from Step 5 for better visibility */}
            <div className="card" style={{ padding: '20px', background: 'rgba(255, 255, 255, 0.05)', marginTop: '16px' }}>
                <h4 style={{ marginTop: 0, marginBottom: '10px' }}>📝 Caption Template</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Customize the caption for published videos. Leave empty to use the original description.
                </p>
                <div style={{ marginBottom: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {[
                        { label: 'Original Desc', code: '{original}' },
                        { label: 'No Hashtags', code: '{original_no_tags}' },
                        { label: 'Time (HH:mm)', code: '{time}' },
                        { label: 'Date (YYYY-MM-DD)', code: '{date}' },
                        { label: 'Author', code: '{author}' },
                        { label: 'Tags', code: '{tags}' }
                    ].map(tag => (
                        <button
                            key={tag.code}
                            className="btn btn-sm btn-ghost"
                            style={{ fontSize: '11px', border: '1px solid var(--border-primary)', padding: '2px 8px', cursor: 'pointer' }}
                            onClick={() => setFormData(prev => ({ ...prev, captionTemplate: (prev.captionTemplate || '') + ' ' + tag.code }))}
                        >
                            {tag.label}
                        </button>
                    ))}
                </div>
                <textarea
                    className="form-control"
                    rows={3}
                    placeholder="e.g. {original} - Reposted from {author} at {time} #fyp"
                    value={formData.captionTemplate || ''}
                    onChange={e => setFormData({ ...formData, captionTemplate: e.target.value })}
                    style={{ width: '100%', resize: 'vertical', position: 'relative', zIndex: 10, minHeight: '80px' }}
                />
            </div>

            {/* ─── Unified Start Time Configuration (For both One-Time and Recurring) ─── */}
            <div className="card" style={{ padding: '20px', background: 'rgba(255, 255, 255, 0.05)', marginTop: '16px' }}>
                <h4 style={{ marginTop: 0 }}>⏰ Start Time</h4>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', position: 'relative', zIndex: 10 }}>
                    <label style={{
                        display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px',
                        background: runNow ? 'rgba(74, 222, 128, 0.1)' : 'transparent',
                        borderRadius: '8px', cursor: 'pointer',
                        border: runNow ? '1px solid #4ade80' : '1px solid var(--border-primary)'
                    }}>
                        <input type="radio" checked={runNow} onChange={() => {
                            setRunNow(true)
                            // If Run Now is selected, set runAt to Now
                            setFormData(prev => ({
                                ...prev,
                                schedule: { ...prev.schedule, runAt: new Date().toISOString() }
                            }))
                        }} />
                        <div>
                            <strong>🚀 Run Immediately</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Start processing right after saving</div>
                        </div>
                    </label>
                    <label style={{
                        display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px',
                        background: !runNow ? 'rgba(124, 92, 252, 0.1)' : 'transparent',
                        borderRadius: '8px', cursor: 'pointer',
                        border: !runNow ? '1px solid var(--accent-primary)' : '1px solid var(--border-primary)'
                    }}>
                        <input type="radio" checked={!runNow} onChange={() => {
                            setRunNow(false)
                            // If switching to scheduled, ensure we have a future time (default +5m)
                            const currentRunAt = formData.schedule.runAt ? new Date(formData.schedule.runAt) : new Date()
                            if (currentRunAt.getTime() <= Date.now()) {
                                setFormData(prev => ({
                                    ...prev,
                                    schedule: { ...prev.schedule, runAt: new Date(Date.now() + 5 * 60000).toISOString() }
                                }))
                            }
                        }} />
                        <div>
                            <strong>📅 Schedule Start</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Pick a specific date & time</div>
                        </div>
                    </label>
                </div>

                {!runNow && (
                    <div className="form-group">
                        <label>First Run Time</label>
                        <div style={{ position: 'relative', zIndex: 100 }}>
                            <DatePicker
                                selected={formData.schedule.runAt ? new Date(formData.schedule.runAt) : null}
                                onChange={(d: Date | null) => {
                                    if (d) {
                                        setFormData(prev => ({
                                            ...prev,
                                            schedule: { ...prev.schedule, runAt: d.toISOString() }
                                        }))
                                        setDateError(null) // Clear error on change
                                    }
                                }}
                                showTimeSelect timeIntervals={15}
                                dateFormat="yyyy-MM-dd HH:mm" timeFormat="HH:mm"
                                minDate={new Date()}
                                placeholderText="Select start time"
                                className={`form-control ${dateError ? 'is-invalid' : ''}`}
                                wrapperClassName="datepicker-wrapper"
                                popperPlacement="bottom-start"
                                // Ensure it doesn't block other inputs
                                onCalendarOpen={() => { }}
                                onCalendarClose={() => { }}
                            />
                            {dateError && (
                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    ⚠️ {dateError}
                                </div>
                            )}
                        </div>

                        <div className="form-group" style={{ marginTop: '20px' }}>
                            <label className="checkbox-container">
                                <input
                                    type="checkbox"
                                    checked={formData.autoSchedule ?? true}
                                    onChange={e => setFormData({ ...formData, autoSchedule: e.target.checked })}
                                />
                                <span className="checkmark"></span>
                                <span className="label-text">
                                    Tự động chạy và schedule
                                    <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                        (Bỏ check nếu máy bạn không phải VPS hoặc không mở liên tục)
                                    </span>
                                </span>
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {formData.type === 'scheduled' && (
                <div className="schedule-ui card" style={{ padding: '20px', marginTop: '16px', borderTop: 'none' }}>
                    <h4 style={{ marginTop: 0 }}>🔄 Recurring Interval</h4>
                    <div className="form-group">
                        <label>Repeat Every (Minutes)</label>
                        <input
                            type="number"
                            className="form-control"
                            min="1"
                            data-testid="interval-input"
                            value={formData.schedule.interval}
                            onChange={e => {
                                const val = e.target.value
                                // @ts-ignore
                                setFormData({ ...formData, schedule: { ...formData.schedule, interval: val === '' ? '' : parseInt(val) } })
                            }}
                            onBlur={() => {
                                if (!formData.schedule.interval || Number(formData.schedule.interval) < 1) {
                                    setFormData({ ...formData, schedule: { ...formData.schedule, interval: 60 } })
                                }
                            }}
                        />
                    </div>
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                        <label style={{ margin: 0 }}>Enable Jitter (Random ±50%)</label>
                        <input type="checkbox"
                            checked={(formData.schedule as any).jitter || false}
                            onChange={e => setFormData({ ...formData, schedule: { ...formData.schedule, jitter: e.target.checked } as any })}
                            style={{ width: '16px', height: '16px' }}
                        />
                    </div>

                    {/* Removed duplicate 'First Run' DatePicker here as it is now handled in the unified 'Start Time' section above */}

                    <div className="form-row" style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Active Hours Start (Daily)</label>
                            <input
                                type="time"
                                className="form-control"
                                data-testid="start-time-input"
                                value={formData.schedule.startTime}
                                onChange={e => setFormData({ ...formData, schedule: { ...formData.schedule, startTime: e.target.value } })}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Active Hours End (Daily)</label>
                            <input
                                type="time"
                                className="form-control"
                                data-testid="end-time-input"
                                value={formData.schedule.endTime}
                                onChange={e => setFormData({ ...formData, schedule: { ...formData.schedule, endTime: e.target.value } })}
                            />
                        </div>
                    </div>
                    <div className="form-group" style={{ marginTop: '12px' }}>
                        <label>Active Days</label>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
                                const isActive = formData.schedule.days.includes(day)
                                return (
                                    <button key={day}
                                        onClick={() => setFormData(prev => ({
                                            ...prev,
                                            schedule: {
                                                ...prev.schedule,
                                                days: isActive ? prev.schedule.days.filter((d: string) => d !== day) : [...prev.schedule.days, day]
                                            }
                                        }))}
                                        style={{
                                            padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                                            border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-primary)',
                                            background: isActive ? 'rgba(124,92,252,0.15)' : 'transparent',
                                            color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)'
                                        }}
                                    >{day}</button>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )

    // ─── Step 2: Source List + Post Order ─────────────────────────
    const handleOpenScanner = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('open-scanner-window')
        } catch (err) {
            console.error('Failed to open scanner:', err)
        }
    }

    const removeSource = (name: string) => {
        setSources(prev => prev.filter(s => s.name !== name))
        // Also remove videos linked to that source? Not necessarily, user might want to keep the videos but stop scanning the source.
        // User spec says: "if collect duplicate... wizard will not add".
        // But here removing source... let's keep videos for now unless user manually removes them.
    }

    const removeVideo = (id: string) => {
        setSavedVideos(prev => {
            const next = prev.filter(v => v.id !== id)
            setVideoCount(next.length)
            return next
        })
    }

    const updateSourceLimit = (name: string, limit: number) => {
        setSources(prev => prev.map(s => s.name === name && s.type === 'keyword' ? { ...s, maxScanCount: limit } : s))
    }

    const [editingSource, setEditingSource] = useState<string | null>(null)

    const updateSourceSettings = (name: string, updates: any) => {
        setSources(prev => prev.map(s => s.name === name ? { ...s, ...updates } : s))
    }

    const postOrderOptions = [
        { value: 'newest', label: '📅 Newest First', desc: 'Post newest videos first' },
        { value: 'oldest', label: '📅 Oldest First', desc: 'Post oldest videos first' },
        { value: 'most_likes', label: '❤️ Most Likes', desc: 'Post most popular videos first' },
        { value: 'least_likes', label: '💙 Least Likes', desc: 'Post hidden gems first' }
    ]

    const renderStep2_Source = () => (
        <div className="wizard-step" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                    <h3 style={{ margin: 0 }}>Step 2: Content Sources</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Configure where to find videos and valid targets.
                    </p>
                </div>
                <button className="btn btn-secondary" onClick={handleOpenScanner}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🔍 Scan More Sources
                </button>
            </div>

            <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
                {/* LEFT COLUMN: SOURCES */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        Sources ({sources.length})
                    </div>

                    {sources.length === 0 ? (
                        <div style={{ padding: '30px', border: '1px dashed var(--border-primary)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                            No sources added.
                        </div>
                    ) : (
                        sources.map(src => (
                            <div key={`${src.type}-${src.name}`} style={{
                                background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                                borderRadius: '8px', overflow: 'hidden'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', padding: '10px', gap: '10px' }}>
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '50%',
                                        background: src.type === 'channel' ? 'linear-gradient(135deg, #25f4ee, #fe2c55)' : 'linear-gradient(135deg, #ff9800, #ff5722)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', fontWeight: 700
                                    }}>
                                        {src.type === 'channel' ? '📺' : '🔍'}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {src.type === 'channel' ? `@${src.name}` : `"${src.name}"`}
                                        </div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            {src.type === 'channel' ? 'Channel' : 'Keyword'}
                                        </div>
                                    </div>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingSource(editingSource === src.name ? null : src.name)}>
                                        ⚙️
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => removeSource(src.name)} style={{ color: 'var(--accent-red)' }}>
                                        ✕
                                    </button>
                                </div>

                                {/* Source Settings Expansion */}
                                {editingSource === src.name && (
                                    <div style={{ padding: '10px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid var(--border-primary)' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                            <div>
                                                <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Min Views</label>
                                                <input type="number" className="form-control" style={{ padding: '4px', fontSize: '12px' }}
                                                    // @ts-ignore
                                                    value={src.minViews || 0} onChange={e => updateSourceSettings(src.name, { minViews: Number(e.target.value) })}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Min Likes</label>
                                                <input type="number" className="form-control" style={{ padding: '4px', fontSize: '12px' }}
                                                    // @ts-ignore
                                                    value={src.minLikes || 0} onChange={e => updateSourceSettings(src.name, { minLikes: Number(e.target.value) })}
                                                />
                                            </div>
                                        </div>
                                        <div style={{ marginBottom: '8px' }}>
                                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Sort Order</label>
                                            <select className="form-control" style={{ padding: '4px', fontSize: '12px' }}
                                                // @ts-ignore
                                                value={src.sortOrder || 'newest'} onChange={e => updateSourceSettings(src.name, { sortOrder: e.target.value })}
                                            >
                                                <option value="newest">Newest First</option>
                                                <option value="oldest">Oldest First</option>
                                                <option value="most_likes">Most Likes</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Max Scan Limit</label>
                                            <input type="number" className="form-control" style={{ padding: '4px', fontSize: '12px' }}
                                                // @ts-ignore
                                                value={src.maxScanCount || 50} onChange={e => updateSourceSettings(src.name, { maxScanCount: Number(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* RIGHT COLUMN: TARGETED VIDEOS */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                            Target Videos ({savedVideos.length})
                        </div>
                        {savedVideos.length > 0 && (
                            <button className="btn btn-ghost btn-sm" onClick={() => setSavedVideos([])} style={{ fontSize: '11px', color: 'var(--accent-red)' }}>
                                Clear All
                            </button>
                        )}
                    </div>

                    {savedVideos.length === 0 ? (
                        <div style={{ padding: '30px', border: '1px dashed var(--border-primary)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                            No videos selected.<br />
                            <span style={{ fontSize: '11px', opacity: 0.7 }}>
                                {formData.type === 'one_time' ?
                                    'For One-Time campaigns, you MUST select exactly 1 video.' :
                                    'Scan sources to find videos automatically when the campaign runs.'}
                            </span>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                            {savedVideos.map((video, idx) => (
                                <div key={video.id} style={{ position: 'relative' }}>
                                    <VideoCard
                                        video={video}
                                        onRemove={() => removeVideo(video.id)}
                                        showStats={true}
                                    />
                                    {/* Reorder buttons */}
                                    <div style={{
                                        position: 'absolute', top: '4px', left: '4px',
                                        display: 'flex', flexDirection: 'column', gap: '2px', zIndex: 20
                                    }}>
                                        {idx > 0 && (
                                            <button onClick={() => moveVideo(idx, 'up')} style={{
                                                width: '20px', height: '20px', borderRadius: '4px',
                                                background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none',
                                                fontSize: '10px', cursor: 'pointer', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center'
                                            }}>▲</button>
                                        )}
                                        {idx < savedVideos.length - 1 && (
                                            <button onClick={() => moveVideo(idx, 'down')} style={{
                                                width: '20px', height: '20px', borderRadius: '4px',
                                                background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none',
                                                fontSize: '10px', cursor: 'pointer', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center'
                                            }}>▼</button>
                                        )}
                                    </div>
                                    {/* Order badge */}
                                    <div style={{
                                        position: 'absolute', top: '32px', right: '4px',
                                        background: 'rgba(124, 92, 252, 0.9)', color: '#fff',
                                        borderRadius: '50%', width: '20px', height: '20px',
                                        fontSize: '10px', fontWeight: 700, display: 'flex',
                                        alignItems: 'center', justifyContent: 'center', zIndex: 20
                                    }}>{idx + 1}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Validation Warning */}
            {formData.type === 'one_time' && savedVideos.length !== 1 && (
                <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(244, 67, 54, 0.1)', border: '1px solid rgba(244, 67, 54, 0.2)', borderRadius: '6px', color: '#f44336', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    ⚠️ One-Time campaigns require exactly 1 target video. You selected {savedVideos.length}.
                </div>
            )}
        </div>
    )

    // ─── Step 3: Video Editor (for scheduled) or Step 4 (for one_time) ────────────────────────────────────
    const renderStep_Editor = () => (
        <div className="wizard-step" style={{ height: '400px' }}>
            <h3>{formData.type === 'scheduled' ? 'Step 3' : 'Step 3'}: Video Editor</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '15px' }}>
                Add effects to process your videos before publishing. Effects are applied in order.
            </p>
            <VideoEditor
                pipeline={formData.editPipeline}
                onChange={(pipeline) => setFormData({ ...formData, editPipeline: pipeline })}
            />
        </div>
    )

    // ─── Step 4: Target (multiple accounts) ──────────────────────
    const toggleAccount = (accId: string) => {
        setFormData(prev => ({
            ...prev,
            targetAccounts: prev.targetAccounts.includes(accId)
                ? prev.targetAccounts.filter((id: string) => id !== accId)
                : [...prev.targetAccounts, accId]
        }))
    }

    const handleAddAccountInline = async () => {
        setAddingAccount(true)
        try {
            // @ts-ignore
            const account = await window.api.invoke('publish-account:add')
            // Refresh list regardless of return to be safe
            await loadAccounts()

            if (account) {
                // If we got the account directly, ensure it's selected
                setFormData(prev => ({
                    ...prev,
                    targetAccounts: [...prev.targetAccounts, String(account.id)]
                }))
            }
        } catch {
            await loadAccounts()
        }
        setAddingAccount(false)
    }

    const handleUpdateAccountInline = async (id: number, settings: any) => {
        try {
            // @ts-ignore
            await window.api.invoke('publish-account:update', id, settings)
            setPublishAccounts(prev => prev.map(a => a.id === id ? { ...a, ...settings } : a))
        } catch { }
    }

    const renderStep4_Target = () => (
        <div className="wizard-step">
            <h3>Step 4: Review & Publish Target</h3>

            {/* Summary Card for Review */}
            <div style={{
                background: 'rgba(124, 92, 252, 0.1)', border: '1px solid var(--accent-primary)',
                borderRadius: '8px', padding: '16px', marginBottom: '20px', display: 'flex', gap: '20px', alignItems: 'center'
            }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Campaign Name</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{formData.name || 'Untitled Campaign'}</div>
                </div>
                <div style={{ width: '1px', height: '30px', background: 'var(--border-primary)' }}></div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Schedule</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--accent-teal)' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--accent-teal)' }}>
                            {formData.type === 'one_time'
                                ? (runNow ? '🚀 Run Immediately' : (() => {
                                    try {
                                        return formData.schedule.runAt ? `📅 ${new Date(formData.schedule.runAt).toLocaleString()}` : 'Not set'
                                    } catch (e) {
                                        return 'Invalid Date'
                                    }
                                })())
                                : `📅 Recurring (Every ${formData.schedule.interval}m)`}
                        </div>
                    </div>
                </div>
                <div style={{ width: '1px', height: '30px', background: 'var(--border-primary)' }}></div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Videos</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{savedVideos.length} Selected</div>
                </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
                Select one or more accounts to publish to.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {Array.isArray(publishAccounts) && publishAccounts.map(acc => {
                    const isSelected = formData.targetAccounts.includes(String(acc.id))
                    const isValid = acc.session_valid === 1
                    return (
                        <div key={acc.id} onClick={() => toggleAccount(String(acc.id))} style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '14px 16px', borderRadius: '10px', cursor: 'pointer',
                            border: isSelected ? '2px solid var(--accent-primary)' : '2px solid var(--border-primary)',
                            background: isSelected ? 'rgba(124, 92, 252, 0.08)' : 'var(--bg-secondary)',
                            transition: 'all 0.2s'
                        }}>
                            <div style={{
                                width: '22px', height: '22px', borderRadius: '6px',
                                border: isSelected ? 'none' : '2px solid var(--border-primary)',
                                background: isSelected ? 'var(--accent-primary)' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                            }}>
                                {isSelected && <span style={{ color: '#fff', fontSize: '14px', fontWeight: 700 }}>✓</span>}
                            </div>
                            <div style={{
                                width: '40px', height: '40px', borderRadius: '50%',
                                background: 'linear-gradient(135deg, #25f4ee, #fe2c55)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '16px', color: '#fff', fontWeight: 700, overflow: 'hidden', flexShrink: 0
                            }}>
                                {acc.avatar_url
                                    ? <img src={acc.avatar_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : (acc.username?.charAt(0)?.toUpperCase() || '?')}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: '14px' }}>{acc.display_name || acc.username}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{acc.username}</div>
                            </div>
                            <span style={{
                                padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                                background: isValid ? 'rgba(74,222,128,0.15)' : 'rgba(244,67,54,0.15)',
                                color: isValid ? '#4ade80' : '#f44336'
                            }}>
                                {isValid ? 'ACTIVE' : 'EXPIRED'}
                            </span>
                            <button className="btn btn-ghost"
                                onClick={(e) => { e.stopPropagation(); setEditingAccount(acc) }}
                                style={{ padding: '4px 8px', fontSize: '12px' }} title="Edit settings">
                                ⚙️
                            </button>
                        </div>
                    )
                })}
            </div>

            <button className="btn btn-secondary" onClick={handleAddAccountInline} disabled={addingAccount}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                {addingAccount ? (
                    <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Waiting for login...</>
                ) : (
                    <>➕ Add New Account</>
                )}
            </button>

            {publishAccounts.length === 0 && !addingAccount && (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    No publish accounts available. Click "Add New Account" to get started.
                </div>
            )}

            {formData.targetAccounts.length > 0 && (
                <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--accent-primary)', fontWeight: 500 }}>
                    ✅ {formData.targetAccounts.length} account{formData.targetAccounts.length > 1 ? 's' : ''} selected
                </div>
            )}
        </div>
    )

    // ─── Build save data ─────────────────────────────────────────
    const buildSaveData = () => ({
        ...formData,
        sourceData: {
            channels: sources.filter(s => s.type === 'channel').map(s => ({
                name: s.name,
                minViews: s.minViews,
                minLikes: s.minLikes,
                sortOrder: s.sortOrder
            })),
            keywords: sources.filter(s => s.type === 'keyword').map(s => ({
                name: s.name,
                maxScanCount: s.maxScanCount || 50,
                minViews: s.minViews,
                minLikes: s.minLikes,
                sortOrder: s.sortOrder
            })),
            videos: savedVideos
        },
        executionOrder: formData.executionOrder
    })

    // DEBUG: Trace description data
    console.log('[DEBUG_DESC] buildSaveData:', {
        videos: savedVideos.map(v => ({ id: v.id, desc: v.description })),
        executionOrder: formData.executionOrder.map(i => ({ type: i.type, desc: i.video?.description }))
    })

    return ReactDOM.createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }} className="no-drag"
        >
            <div
                className="campaign-wizard-modal page-enter no-drag"
                style={{ width: '900px', height: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', pointerEvents: 'auto' } as any}
            // onMouseDown={(e) => e.stopPropagation()} // REMOVED: Caused DatePicker to not close on outside click.
            >
                {renderStepper()}

                <div className="wizard-content" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
                    {step === 1 && renderStep1_Basic()}
                    {step === 2 && renderStep2_Source()}
                    {step === 3 && formData.type === 'scheduled' && renderStep_Editor()}
                    {step === 3 && formData.type !== 'scheduled' && null}
                    {step === 4 && formData.type === 'scheduled' && (
                        <SchedulePreview
                            sources={sources}
                            savedVideos={savedVideos}
                            schedule={{
                                ...formData.schedule,
                                interval: Number(formData.schedule.interval) || 60
                            }}
                            initialItems={formData.executionOrder && formData.executionOrder.length > 0 ? formData.executionOrder : undefined}
                            captionTemplate={formData.captionTemplate}
                            onScheduleChange={(items) => setFormData(prev => ({
                                ...prev,
                                executionOrder: items.map(i => ({
                                    ...i, // Persist all props including time and customCaption
                                    time: i.time // Ensure time is explicitly saved
                                }))
                            }))}
                            onStartTimeChange={(date) => setFormData({ ...formData, schedule: { ...formData.schedule, runAt: date.toISOString() } })}
                            onIntervalChange={(val) => setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, interval: val } }))}
                        />
                    )}
                    {step === 4 && formData.type === 'one_time' && renderStep_Editor()}
                    {step === 5 && renderStep4_Target()}
                </div>

                <div className="wizard-footer">
                    <button className="btn btn-secondary" onClick={step === 1 ? onClose : handleBack}>
                        {step === 1 ? 'Cancel' : 'Back'}
                    </button>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        {step === 5 && (
                            <button className="btn btn-emerald" onClick={() => handleSave(buildSaveData(), true)} disabled={isSaving}>
                                {isSaving ? '🚀 Starting...' : '🚀 Save & Run Now'}
                            </button>
                        )}
                        {step === 5 ? (
                            <button className="btn btn-primary" onClick={() => handleSave(buildSaveData(), false)} disabled={!canAdvance() || isSaving}>
                                {isSaving ? '💾 Saving...' : '💾 Save & Close'}
                            </button>
                        ) : (
                            <button className="btn btn-primary" onClick={handleNext} disabled={!canAdvance()}>
                                Next &rarr;
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {editingAccount && (
                <AccountSettingsModal
                    account={editingAccount}
                    // @ts-ignore
                    onSave={handleUpdateAccountInline}
                    onClose={() => setEditingAccount(null)}
                />
            )}
        </div>,
        document.body
    )
}
