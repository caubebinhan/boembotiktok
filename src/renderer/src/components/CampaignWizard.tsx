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
    maxScanCount?: number | 'unlimited' // Updated to support unlimited
    minViews?: number
    minLikes?: number
    sortOrder?: 'newest' | 'oldest' | 'most_likes' | 'most_viewed'
    timeRange?: 'future_only' | 'history_only' | 'history_and_future' | 'custom_range'
    startDate?: string // YYYY-MM-DD
    endDate?: string   // YYYY-MM-DD
    // Advanced Limits
    historyLimit?: number | 'unlimited'
    futureLimit?: number | 'unlimited'
    totalLimit?: number | 'unlimited'
    autoSchedule: boolean
}

interface CampaignFormData {
    id?: number
    name: string
    type: 'scan_video' | 'scan_channel_keyword'
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
    autoReschedule?: boolean // New field
    executionOrder: any[]
}


export const CampaignWizard: React.FC<CampaignWizardProps> = ({ onClose, onSave, initialData }) => {
    // ─── State ───────────────────────────────────────────────────
    const [step, setStep] = useState(1)
    const [runNow, setRunNow] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const isInitialized = React.useRef(false)
    const [needsReview, setNeedsReview] = useState(initialData?.status === 'needs_review')
    const [formData, setFormData] = useState<CampaignFormData>(() => {
        if (initialData) {
            const config = typeof initialData.config_json === 'string' ? JSON.parse(initialData.config_json) : initialData.config_json || {}
            return {
                name: initialData.name + ' (Copy)',
                type: initialData.type === 'scan_channel_keyword' || initialData.type === 'scan_all' || initialData.type === 'scheduled' ? 'scan_channel_keyword' : 'scan_video',
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
                autoReschedule: config.autoReschedule ?? true, // Default to true
                executionOrder: [] as any[]
            }
        }
        return {
            name: '',
            type: 'scan_video' as 'scan_video' | 'scan_channel_keyword',
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
            autoReschedule: true, // Default to true
            executionOrder: [] as any[]
        }
    })

    // Init sources and videos AND formData from initialData if present
    useEffect(() => {
        console.log('[CampaignWizard] useEffect triggered - initialData:', initialData?.name);
        if (!initialData || isInitialized.current) {
            console.log('[CampaignWizard] useEffect skipped - already initialized or no initialData');
            return
        }
        isInitialized.current = true
        console.log('[CampaignWizard] Initializing from initialData:', initialData?.name);
        const config = typeof initialData.config_json === 'string' ? JSON.parse(initialData.config_json) : initialData.config_json || {}

        // Restore Sources
        if (config.sources) {
            const restoredSources: SourceEntry[] = []
            if (config.sources.channels) {
                config.sources.channels.forEach((c: any) => {
                    restoredSources.push({
                        ...c,
                        type: 'channel',
                        autoSchedule: c.autoSchedule !== false
                    })
                })
            }
            if (config.sources.keywords) {
                config.sources.keywords.forEach((k: any) => {
                    restoredSources.push({
                        ...k,
                        type: 'keyword',
                        autoSchedule: k.autoSchedule !== false
                    })
                })
            }
            setSources(restoredSources)
        }

        // Special handling for Needs Review
        if (initialData.status === 'needs_review') {
            setStep(4)
            // Fetch videos with 'pending_review' status for this campaign
            const loadPendingVideos = async () => {
                try {
                    // @ts-ignore
                    const videos = await window.api.invoke('campaign:get-pending-videos', initialData.id)
                    if (videos && videos.length > 0) {
                        setSavedVideos(videos)
                    }
                } catch (e) {
                    console.error('Failed to load pending videos:', e)
                }
            }
            loadPendingVideos()
        } else if (config.videos) {
            setSavedVideos(config.videos)
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
            type: initialData.type === 'scan_channel_keyword' || initialData.type === 'scan_all' || initialData.type === 'scheduled' ? 'scan_channel_keyword' : 'scan_video',
            editPipeline: config.editPipeline || { effects: [] },
            targetAccounts: config.targetAccounts || [],
            postOrder: config.postOrder || 'newest',
            schedule: clonedSchedule,
            autoSchedule: config.autoSchedule !== false,
            autoReschedule: config.autoReschedule ?? true, // Default to true
            advancedVerification: config.advancedVerification || false,
            executionOrder: [] // Do not copy execution order, generate fresh
        }))
    }, [initialData])

    const handleSave = async (data: any, runNowOverride: boolean) => {
        console.log('[Wizard_Action] handleSave started', { data, runNowOverride });

        // Stale Time Check: If scheduled start time is in the past (e.g. user took too long to fill form),
        // prompt to bump it to the future or cancel.
        if (!runNowOverride && data.type === 'scheduled' && data.schedule?.runAt) {
            const runAt = new Date(data.schedule.runAt)
            if (runAt.getTime() <= Date.now()) {
                const newTime = new Date(Date.now() + 60000) // Now + 1 min
                const confirmUpdate = window.confirm(
                    `The scheduled start time (${runAt.toLocaleTimeString()}) has passed while you were editing.\n\n` +
                    `Do you want to update it to start in 1 minute (${newTime.toLocaleTimeString()})?`
                )
                if (confirmUpdate) {
                    data.schedule.runAt = newTime.toISOString()
                } else {
                    // User cancelled, abort save to let them fix it manually
                    return
                }
            }
        }

        setIsSaving(true)
        try {
            // @ts-ignore
            await onSave(data, runNowOverride)
            console.log('[Wizard_Action] handleSave success');
        } catch (err: any) {
            console.error('[Wizard_Error] handleSave failed:', err);
            // Optionally alert user
        } finally {
            setIsSaving(false)
        }
    }

    // Source data for Step 2 — received from scanner window
    const [sources, setSources] = useState<SourceEntry[]>([])
    const [videoCount, setVideoCount] = useState(0)
    const [savedVideos, setSavedVideos] = useState<any[]>([])

    const isOneTime = formData.type === 'scan_video'

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
                                    maxScanCount: 50,
                                    timeRange: 'history_and_future',
                                    autoSchedule: true
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
                                    maxScanCount: 50,
                                    timeRange: 'history_and_future',
                                    autoSchedule: true
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
                        videoCount: results.videos?.length || 0,
                        autoSchedule: true
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
        console.log('[Wizard_Action] loadAccounts started');
        try {
            // @ts-ignore
            const accounts = await window.api.invoke('publish-account:list')
            console.log('[Wizard_Action] loadAccounts success:', accounts?.length || 0, 'accounts found');
            setPublishAccounts(accounts || [])
        } catch (err: any) {
            console.error('[Wizard_Error] loadAccounts failed:', err);
        }
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

    // Help to filter out past times for the current day
    const filterPassedTime = (time: Date) => {
        const currentDate = new Date()
        const selectedDate = new Date(time)
        return currentDate.getTime() < selectedDate.getTime()
    }

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

        console.log(`[Wizard_Action] handleNext from step ${step}`);
        if (canAdvance()) {
            console.log(`[Wizard] Advancing to step ${step + 1}`);
            setStep(s => s + 1)
        } else {
            console.warn(`[Wizard_Warning] Cannot advance from step ${step} - validation failed`);
        }
    }
    const handleBack = () => {
        console.log(`[Wizard_Action] handleBack from step ${step} to ${step - 1}`);
        // If going back from the schedule preview step (4) or beyond,
        // clear the cached executionOrder so SchedulePreview rebuilds from the
        // updated Step 1 values (startTime, endTime, interval, runAt) when
        // the user navigates forward again.
        if (step >= 4) {
            setFormData(prev => ({ ...prev, executionOrder: [] }))
        }
        setStep(s => s - 1)
    }

    // For both types, we use a unified 5-step flow:
    // Details(1) -> Source(2) -> Editor(3) -> SchedulePreview(4) -> Target(5)
    const steps = [
        { id: 1, label: 'Details', icon: '📝' },
        { id: 2, label: 'Source', icon: '📡' },
        { id: 3, label: 'Editor', icon: '✂️' },
        { id: 4, label: 'Schedule', icon: '📅' },
        { id: 5, label: 'Target', icon: '🎯' }
    ]

    const canAdvance = (): boolean => {
        const res = ((): boolean => {
            if (step === 1 && !formData.name.trim()) return false
            if (step === 1 && formData.type === 'scan_video' && !runNow && !formData.schedule.runAt) return false
            if (step === 1 && formData.type === 'scan_channel_keyword' && formData.schedule.days.length === 0) return false

            // Step 2 Validation
            if (step === 2) {
                if (formData.type === 'scan_video') {
                    return savedVideos.length >= 1
                }
                if (sources.length === 0 && savedVideos.length === 0) return false
            }

            if (step === 5 && formData.targetAccounts.length === 0) return false
            return true
        })();
        console.log(`[CampaignWizard] canAdvance(step:${step}) -> ${res} (formData.name: "${formData.name}")`);
        return res;
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
                <label>Campaign Name</label>
                <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Daily TikTok Scan"
                    autoFocus
                    value={formData.name}
                    onChange={e => {
                        const val = e.target.value;
                        console.log('[Wizard_Input] Campaign Name BEFORE setFormData:', formData.name);
                        console.log('[Wizard_Input] Campaign Name TARGET VALUE:', val);
                        setFormData(prev => ({ ...prev, name: val }));
                    }}
                    onFocus={() => console.log('[Wizard_Input] Campaign Name Focused')}
                    onBlur={() => console.log('[Wizard_Input] Campaign Name Blurred')}
                    data-testid="campaign-name-input"
                    style={{
                        width: '100%', padding: '12px', background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-primary)', borderRadius: '8px',
                        color: '#fff', fontSize: '14px', position: 'relative', zIndex: 10
                    }}
                />
            </div>

            <div className="form-group">
                <label>Campaign Type</label>
                <div className="radio-group" style={{ display: 'flex', gap: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: formData.type === 'scan_video' ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: formData.type === 'scan_video' ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
                        <input type="radio" checked={formData.type === 'scan_video'} onChange={() => {
                            console.log('[Wizard_Input] Campaign Type: scan_video (Clearing Sources)');
                            setFormData({ ...formData, type: 'scan_video' });
                            setSources([]); // Clear sources when switching to scan_video
                        }} />
                        <div>
                            <strong>Scan Video Mode</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Select specific videos to process</div>
                        </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: formData.type === 'scan_channel_keyword' ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: formData.type === 'scan_channel_keyword' ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
                        <input type="radio" checked={formData.type === 'scan_channel_keyword'} onChange={() => {
                            console.log('[Wizard_Input] Campaign Type: scan_channel_keyword (Clearing Selected Videos)');
                            setFormData({ ...formData, type: 'scan_channel_keyword' });
                            setSavedVideos([]); // Clear videos when switching to scan_channel_keyword
                            setVideoCount(0);
                        }} />
                        <div>
                            <strong data-testid="type-scheduled">Scan Channel/Keyword Mode</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Automatically monitor streams/channels</div>
                        </div>
                    </label>
                </div>
            </div>

            <div className="form-group" style={{ marginTop: '16px', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
                    <input
                        type="checkbox"
                        checked={(formData as any).advancedVerification || false}
                        onChange={e => {
                            const checked = e.target.checked
                            setFormData(prev => ({ ...prev, advancedVerification: checked } as any))
                        }}
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
                    onChange={e => {
                        const val = e.target.value
                        setFormData(prev => ({ ...prev, captionTemplate: val }))
                    }}
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
                            console.log('[Wizard_Input] Run Immediately selected');
                            // If Run Now is selected, set runAt to Now
                            setFormData(prev => ({
                                ...prev,
                                schedule: { ...prev.schedule, runAt: new Date().toISOString() }
                            }))
                        }} />
                        <div>
                            <strong>🚀 Run Now</strong>
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
                            console.log('[Wizard_Input] Schedule Start selected');
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
                                    console.log(`[CampaignWizard] Start Time changed: ${d?.toISOString()}`);
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
                                filterTime={filterPassedTime}
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
                                    onChange={e => {
                                        const val = e.target.checked;
                                        console.log('[Wizard_Input] Auto Schedule:', val);
                                        setFormData({ ...formData, autoSchedule: val });
                                    }}
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

            {formData.type === 'scan_channel_keyword' && (
                <>
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
                                    console.log('[Wizard_Input] Run Interval:', val);
                                    setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, interval: val === '' ? '' : parseInt(val) } }))
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
                                onChange={e => {
                                    console.log('[Wizard_Input] Jitter enabled:', e.target.checked);
                                    setFormData({ ...formData, schedule: { ...formData.schedule, jitter: e.target.checked } as any })
                                }}
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
                                    onChange={e => {
                                        console.log('[Wizard_Input] Active Hours Start:', e.target.value);
                                        setFormData({ ...formData, schedule: { ...formData.schedule, startTime: e.target.value } })
                                    }}
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Active Hours End (Daily)</label>
                                <input
                                    type="time"
                                    className="form-control"
                                    data-testid="end-time-input"
                                    value={formData.schedule.endTime}
                                    onChange={e => {
                                        console.log('[Wizard_Input] Active Hours End:', e.target.value);
                                        setFormData({ ...formData, schedule: { ...formData.schedule, endTime: e.target.value } })
                                    }}
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

                    {/* Missed Job Handling UI */}
                    <div className="card" style={{ padding: '20px', marginTop: '16px', background: 'rgba(255, 255, 255, 0.05)', borderTop: 'none' }}>
                        <h4 style={{ marginTop: 0 }}>🔄 Missed Job Handling</h4>
                        <div style={{ display: 'flex', gap: '20px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: (formData.autoReschedule !== false) ? 'rgba(74, 222, 128, 0.1)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: (formData.autoReschedule !== false) ? '1px solid #4ade80' : '1px solid var(--border-primary)', flex: 1 }}>
                                <input type="radio" checked={formData.autoReschedule !== false} onChange={() => {
                                    console.log('[Wizard_Input] Missed Job Handling: Auto Reschedule');
                                    setFormData({ ...formData, autoReschedule: true });
                                }} style={{ accentColor: '#4ade80' }} />
                                <div>
                                    <strong>Auto Reschedule</strong>
                                    <div style={{ fontSize: '10px', color: 'gray' }}>Automatically reschedule missed jobs</div>
                                </div>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: (formData.autoReschedule === false) ? 'rgba(255, 100, 100, 0.1)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: (formData.autoReschedule === false) ? '1px solid #ff6464' : '1px solid var(--border-primary)', flex: 1 }}>
                                <input type="radio" checked={formData.autoReschedule === false} onChange={() => {
                                    console.log('[Wizard_Input] Missed Job Handling: Manual Reschedule');
                                    setFormData({ ...formData, autoReschedule: false });
                                }} style={{ accentColor: '#ff6464' }} />
                                <div>
                                    <strong>Manual Reschedule</strong>
                                    <div style={{ fontSize: '10px', color: 'gray' }}>Pause campaign and wait for manual action</div>
                                </div>
                            </label>
                        </div>
                    </div>
                </>
            )}
        </div>
    )

    // ─── Step 2: Source List + Post Order ─────────────────────────
    const handleOpenScanner = async () => {
        console.log('[CampaignWizard] Opening scanner window...')
        try {
            // @ts-ignore
            await window.api.openScannerWindow()
            console.log('[CampaignWizard] Scanner window request sent.')
        } catch (err) {
            console.error('[CampaignWizard] Failed to open scanner:', err)
        }
    }

    const removeSource = (name: string) => {
        console.log('[Wizard_Action] removeSource:', name);
        setSources(prev => prev.filter(s => s.name !== name))
    }

    const removeVideo = (id: string) => {
        console.log('[Wizard_Action] removeVideo:', id);
        setSavedVideos(prev => {
            const next = prev.filter(v => v.id !== id)
            setVideoCount(next.length)
            return next
        })
    }

    const updateSourceLimit = (name: string, limit: number) => {
        console.log('[Wizard_Input] updateSourceLimit:', { name, limit });
        setSources(prev => prev.map(s => s.name === name && s.type === 'keyword' ? { ...s, maxScanCount: limit } : s))
    }

    const [editingSource, setEditingSource] = useState<string | null>(null)

    const updateSourceSettings = (name: string, updates: any) => {
        console.log('[Wizard_Input] updateSourceSettings:', { name, updates });
        setSources(prev => prev.map(s => {
            if (s.name !== name) return s

            const newSource = { ...s, ...updates }

            // Log the specific change
            Object.keys(updates).forEach(key => {
                console.log(`[Wizard_Input] Source "${name}" updated: ${key} = ${updates[key]}`);
            });

            // ─── VALIDATION & AUTO-CORRECTION ─────────────────────

            // Rule 1: Engagement sorting requires history
            if (['most_likes', 'most_viewed', 'oldest'].includes(newSource.sortOrder)) {
                if (newSource.timeRange === 'future_only') {
                    console.log('[CampaignWizard] Auto-correction: Engagement sort requires history. Defaulting to all history.')
                    newSource.timeRange = 'history_and_future'
                }
                // Custom range is fine as it includes history
            }

            // Rule 2: "Future Only" forces "Newest"
            if (newSource.timeRange === 'future_only' && newSource.sortOrder !== 'newest') {
                newSource.sortOrder = 'newest'
            }

            return newSource
        }))
    }

    const postOrderOptions = [
        { value: 'newest', label: '📅 Newest First', desc: 'Post newest videos first' },
        { value: 'oldest', label: '📅 Oldest First', desc: 'Post oldest videos first' },
        { value: 'most_likes', label: '❤️ Most Likes', desc: 'Post most popular videos first' },
        { value: 'least_likes', label: '💙 Least Likes', desc: 'Post hidden gems first' }
    ]

    const renderStep2_Source = () => {
        const isOneTime = formData.type === 'scan_video'
        const isScheduled = formData.type === 'scan_channel_keyword'

        return (
            <div className="wizard-step" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Step 2: Content Sources</h3>
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                            {isOneTime ? 'Select specific videos to process.' : 'Configure channels & keywords to monitor.'}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
                    {/* LEFT COLUMN: SOURCES (Only for Scheduled) */}
                    {isScheduled && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                    Sources ({sources.length})
                                </div>
                                {sources.length > 0 && (
                                    <button className="btn btn-secondary btn-sm" onClick={handleOpenScanner}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        🔍 Scan Sources
                                    </button>
                                )}
                            </div>

                            {sources.length === 0 ? (
                                <div style={{
                                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                    padding: '40px', border: '1px dashed var(--border-primary)', borderRadius: '8px',
                                    color: 'var(--text-muted)', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.5 }}>📡</div>
                                    <h4 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>No Sources Configured</h4>
                                    <p style={{ fontSize: '13px', maxWidth: '300px', margin: '0 0 24px' }}>
                                        Add channels or keywords to automatically find content for this campaign.
                                    </p>
                                    <button className="btn btn-primary" onClick={handleOpenScanner}>
                                        🔍 Scan & Add Sources
                                    </button>
                                </div>
                            ) : (
                                (
                                    sources.map(src => (
                                        <div key={`${src.type}-${src.name}`} style={{
                                            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                                            borderRadius: '8px', overflow: 'hidden'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 15px', gap: '10px', borderBottom: '1px solid var(--border-primary)', background: 'rgba(255,255,255,0.02)' }}>
                                                <div style={{
                                                    width: '28px', height: '28px', borderRadius: '50%',
                                                    background: src.type === 'channel' ? 'linear-gradient(135deg, #25f4ee, #fe2c55)' : 'linear-gradient(135deg, #ff9800, #ff5722)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', fontWeight: 700
                                                }}>
                                                    {src.type === 'channel' ? '📺' : '🔍'}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>
                                                        {src.type === 'channel' ? `@${src.name}` : `"${src.name}"`}
                                                    </div>
                                                </div>
                                                <button className="btn btn-ghost btn-sm" onClick={() => removeSource(src.name)} style={{ color: 'var(--accent-red)', opacity: 0.7 }}>
                                                    ✕
                                                </button>
                                            </div>

                                            <div style={{ padding: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                                {/* Scan Limit (Only for History-related modes) */}
                                                {(src.timeRange !== 'future_only') && (
                                                    <div>
                                                        <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>
                                                            🎯 Scan Limit
                                                        </label>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <input
                                                                type="number"
                                                                className="form-control"
                                                                style={{ width: '60px', padding: '4px 8px', fontSize: '12px' }}
                                                                value={src.maxScanCount === 'unlimited' ? '' : (src.maxScanCount || 50)}
                                                                placeholder="∞"
                                                                onChange={e => updateSourceSettings(src.name, {
                                                                    maxScanCount: e.target.value === '' ? 'unlimited' : Number(e.target.value),
                                                                    historyLimit: e.target.value === '' ? 'unlimited' : Number(e.target.value)
                                                                })}
                                                            />
                                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>videos</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Sort Order */}
                                                <div>
                                                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>
                                                        🎲 Sorting
                                                    </label>
                                                    <select
                                                        className="form-control"
                                                        style={{ width: '100%', padding: '4px 8px', fontSize: '12px' }}
                                                        value={src.sortOrder || 'newest'}
                                                        onChange={e => updateSourceSettings(src.name, { sortOrder: e.target.value })}
                                                    >
                                                        <option value="newest">Newest</option>
                                                        <option value="most_likes">Most Likes</option>
                                                        <option value="most_viewed">Most Viewed</option>
                                                        <option value="oldest">Oldest</option>
                                                    </select>
                                                </div>

                                                {/* Time Range */}
                                                <div style={{ gridColumn: 'span 2' }}>
                                                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>
                                                        📅 Time Range
                                                    </label>
                                                    <select
                                                        className="form-control"
                                                        style={{ width: '100%', padding: '4px 8px', fontSize: '12px' }}
                                                        value={src.timeRange || 'history_and_future'}
                                                        onChange={e => updateSourceSettings(src.name, { timeRange: e.target.value })}
                                                    >
                                                        <option value="history_and_future">History & Future (Both)</option>
                                                        <option value="history_only">History (Past Only)</option>
                                                        <option value="future_only">Future (Monitoring Only)</option>
                                                        <option value="custom_range">Custom Date Range...</option>
                                                    </select>
                                                </div>

                                                {/* Custom Date Range Pickers */}
                                                {src.timeRange === 'custom_range' && (
                                                    <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '5px' }}>
                                                        <div>
                                                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Start Date</label>
                                                            <DatePicker
                                                                selected={src.startDate ? new Date(src.startDate) : null}
                                                                onChange={(date: Date | null) => updateSourceSettings(src.name, { startDate: date ? date.toISOString().split('T')[0] : null })}
                                                                dateFormat="yyyy-MM-dd"
                                                                className="form-control"
                                                                placeholderText="Start"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>End Date</label>
                                                            <DatePicker
                                                                selected={src.endDate ? new Date(src.endDate) : null}
                                                                onChange={(date: Date | null) => updateSourceSettings(src.name, { endDate: date ? date.toISOString().split('T')[0] : null })}
                                                                dateFormat="yyyy-MM-dd"
                                                                className="form-control"
                                                                placeholderText="End"
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Auto-Schedule Toggle */}
                                                <div style={{ gridColumn: 'span 2', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-primary)' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={src.autoSchedule ?? true}
                                                            onChange={e => updateSourceSettings(src.name, { autoSchedule: e.target.checked })}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <div>
                                                            <div style={{ fontSize: '12px', fontWeight: 600 }}>Auto-schedule videos</div>
                                                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>If off, you must manually approve videos after scanning</div>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )
                            )}
                        </div>
                    )}

                    {/* RIGHT COLUMN: TARGETED VIDEOS (Only for One-Time) */}
                    {/* User requested: Only show video list for One-Time. Recurrent only needs sources. */}
                    {isOneTime && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                    Target Videos ({savedVideos.length})
                                </div>
                                {savedVideos.length > 0 && (
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button className="btn btn-secondary btn-sm" onClick={handleOpenScanner}
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            🎥 Scan More Videos
                                        </button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setSavedVideos([])} style={{ fontSize: '11px', color: 'var(--accent-red)' }}>
                                            Clear All
                                        </button>
                                    </div>
                                )}
                            </div>

                            {savedVideos.length === 0 ? (
                                <div style={{
                                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                    padding: '40px', border: '1px dashed var(--border-primary)', borderRadius: '8px',
                                    color: 'var(--text-muted)', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.5 }}>🎬</div>
                                    <h4 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>No Videos Selected</h4>
                                    <p style={{ fontSize: '13px', maxWidth: '300px', margin: '0 0 24px' }}>
                                        Scan specific videos to run once immediately.
                                    </p>
                                    <button className="btn btn-primary" onClick={handleOpenScanner}>
                                        🎥 Scan Videos
                                    </button>
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
                                            {/* Reorder and badge logic... */}
                                            <div style={{
                                                position: 'absolute', top: '4px', left: '4px',
                                                display: 'flex', flexDirection: 'column', gap: '2px', zIndex: 20
                                            }}>
                                                {idx > 0 && <button onClick={() => moveVideo(idx, 'up')} style={{ width: '20px', height: '20px', borderRadius: '4px', background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', fontSize: '10px', cursor: 'pointer' }}>▲</button>}
                                                {idx < savedVideos.length - 1 && <button onClick={() => moveVideo(idx, 'down')} style={{ width: '20px', height: '20px', borderRadius: '4px', background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', fontSize: '10px', cursor: 'pointer' }}>▼</button>}
                                            </div>
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
                    )}
                </div>

                {/* Validation Warning */}
                {formData.type === 'scan_video' && savedVideos.length === 0 && (
                    <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(244, 67, 54, 0.1)', border: '1px solid rgba(244, 67, 54, 0.2)', borderRadius: '6px', color: '#f44336', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        ⚠️ One-Time campaigns require at least 1 target video.
                    </div>
                )}
            </div>
        )
    }

    // ─── Step 3: Video Editor (for scheduled) or Step 4 (for one_time) ────────────────────────────────────
    const renderStep_Editor = () => (
        <div className="wizard-step" style={{ height: '400px' }}>
            <h3>{formData.type === 'scan_channel_keyword' ? 'Step 3' : 'Step 3'}: Video Editor</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '15px' }}>
                Add effects to process your videos before publishing. Effects are applied in order.
            </p>
            <VideoEditor
                pipeline={formData.editPipeline}
                onChange={(pipeline) => setFormData(prev => ({ ...prev, editPipeline: pipeline }))}
            />
        </div>
    )

    // ─── Step 4: Target (multiple accounts) ──────────────────────
    const toggleAccount = (accId: string) => {
        console.log('[Wizard_Action] toggleAccount:', accId);
        setFormData(prev => {
            const isSelected = prev.targetAccounts.includes(accId);
            const next = isSelected
                ? prev.targetAccounts.filter((id: string) => id !== accId)
                : [...prev.targetAccounts, accId];
            console.log('[Wizard_Input] Selected Accounts:', next);
            return { ...prev, targetAccounts: next };
        })
    }

    const handleAddAccountInline = async () => {
        console.log('[Wizard_Action] handleAddAccountInline started');
        setAddingAccount(true)
        try {
            // @ts-ignore
            const account = await window.api.invoke('publish-account:add')
            console.log('[Wizard_Action] Account added inline:', account?.username);
            // Refresh list regardless of return to be safe
            await loadAccounts()

            if (account) {
                // If we got the account directly, ensure it's selected
                setFormData(prev => ({
                    ...prev,
                    targetAccounts: [...prev.targetAccounts, String(account.id)]
                }))
            }
        } catch (err: any) {
            console.error('[Wizard_Error] handleAddAccountInline failed:', err);
        } finally {
            setAddingAccount(false)
        }
    }

    const handleUpdateAccountInline = async (id: number, settings: any) => {
        console.log('[Wizard_Action] handleUpdateAccountInline started', { id, settings });
        try {
            // @ts-ignore
            await window.api.invoke('publish-account:update', id, settings)
            console.log('[Wizard_Action] Account setting updated success');
            setPublishAccounts(prev => prev.map(a => a.id === id ? { ...a, ...settings } : a))
        } catch (err: any) {
            console.error('[Wizard_Error] handleUpdateAccountInline failed:', err);
        }
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
                            {formData.type === 'scan_video'
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
    const buildSaveData = () => {
        console.log('[Wizard_Action] buildSaveData started');
        const data = {
            ...formData,
            sourceData: {
                channels: sources.filter(s => s.type === 'channel').map(s => ({
                    name: s.name,
                    timeRange: s.timeRange || 'history_and_future',
                    startDate: s.startDate,
                    endDate: s.endDate,
                    maxScanCount: s.maxScanCount,
                    historyLimit: s.historyLimit,
                    futureLimit: s.futureLimit,
                    totalLimit: s.totalLimit,
                    autoSchedule: s.autoSchedule !== false,
                    minViews: s.minViews,
                    minLikes: s.minLikes,
                    sortOrder: s.sortOrder
                })),
                keywords: sources.filter(s => s.type === 'keyword').map(s => ({
                    name: s.name,
                    timeRange: s.timeRange || 'history_and_future',
                    startDate: s.startDate,
                    endDate: s.endDate,
                    maxScanCount: s.maxScanCount || 50,
                    historyLimit: s.historyLimit,
                    futureLimit: s.futureLimit,
                    totalLimit: s.totalLimit,
                    autoSchedule: s.autoSchedule !== false,
                    minViews: s.minViews,
                    minLikes: s.minLikes,
                    sortOrder: s.sortOrder
                })),
                videos: savedVideos
            },
            executionOrder: formData.executionOrder.map(item => {
                // Ensure time is saved as Local ISO String to respect Computer Time
                if (item.time instanceof Date) {
                    const d = item.time;
                    const offset = d.getTimezoneOffset() * 60000;
                    const localISO = new Date(d.getTime() - offset).toISOString().slice(0, -1);
                    return { ...item, time: localISO };
                }
                return item;
            })
        };
        console.log('[Wizard_Data] Final Build Data:', data);
        return data;
    }

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
                onMouseDown={(e) => e.stopPropagation()}
            >
                {renderStepper()}

                <div className="wizard-content" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
                    {step === 1 && renderStep1_Basic()}
                    {step === 2 && renderStep2_Source()}
                    {step === 3 && renderStep_Editor()}
                    {step === 4 && (
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
                            onStartTimeChange={(date) => {
                                // Convert to Local ISO String (YYYY-MM-DDTHH:mm:ss.ms) to respect Computer Time (NO UTC conversion)
                                const offset = date.getTimezoneOffset() * 60000;
                                const localISO = new Date(date.getTime() - offset).toISOString().slice(0, -1);
                                setFormData({ ...formData, schedule: { ...formData.schedule, runAt: localISO } })
                            }}
                            onIntervalChange={(val) => setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, interval: val } }))}
                            onSourcesChange={(newSources) => setSources(newSources)}
                            onWindowChange={(start, end) => setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, startTime: start, endTime: end } }))}
                        />
                    )}
                    {step === 5 && renderStep4_Target()}
                </div>

                <div className="wizard-footer">
                    <button className="btn btn-secondary" onClick={step === 1 ? onClose : handleBack}>
                        {step === 1 ? 'Cancel' : 'Back'}
                    </button>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        {step === 5 && isOneTime && (
                            <button className="btn btn-emerald" onClick={() => handleSave(buildSaveData(), true)} disabled={isSaving} title="Ignores schedule and runs immediately">
                                {isSaving ? '🚀 Starting...' : '🚀 Save & Execute Immediately'}
                            </button>
                        )}
                        {step === 5 ? (
                            <button className="btn btn-primary" onClick={() => handleSave(buildSaveData(), false)} disabled={!canAdvance() || isSaving}>
                                {isSaving ? '💾 Saving...' : '💾 Save & Schedule'}
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
