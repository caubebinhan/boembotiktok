import React, { useState, useEffect } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { VideoEditor } from './VideoEditor'
import { AccountSettingsModal } from './AccountSettingsModal'

interface CampaignWizardProps {
    onClose: () => void
    onSave: (campaignData: any, runNow: boolean) => void
    onOpenScanner: (callback: (source: any) => void) => void
}

export const CampaignWizard: React.FC<CampaignWizardProps> = ({ onClose, onSave, onOpenScanner }) => {
    const [step, setStep] = useState(1)
    const [formData, setFormData] = useState({
        name: '',
        type: 'one_time' as 'one_time' | 'scheduled',
        sourceConfig: null as any,
        editPipeline: { effects: [] as any[] },
        targetAccounts: [] as string[],
        schedule: {
            runAt: '',  // for one_time: ISO datetime string
            interval: 60,
            startTime: '09:00',
            endTime: '21:00',
            days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        }
    })

    // Publish accounts for Target step
    const [publishAccounts, setPublishAccounts] = useState<any[]>([])
    const [addingAccount, setAddingAccount] = useState(false)
    const [editingAccount, setEditingAccount] = useState<any | null>(null)

    useEffect(() => {
        loadAccounts()
    }, [])

    const loadAccounts = async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('publish-account:list')
            setPublishAccounts(data || [])
        } catch { }
    }

    const handleNext = () => setStep(s => s + 1)
    const handleBack = () => setStep(s => s - 1)

    const steps = [
        { id: 1, label: 'Details', icon: '📝' },
        { id: 2, label: 'Source', icon: '📡' },
        { id: 3, label: 'Editor', icon: '✂️' },
        { id: 4, label: 'Target', icon: '🎯' }
    ]

    // Per-step validation
    const canAdvance = (): boolean => {
        switch (step) {
            case 1:
                if (!formData.name.trim()) return false
                if (formData.type === 'one_time' && !formData.schedule.runAt) return false
                return true
            case 2:
                return !!formData.sourceConfig
            default:
                return true
        }
    }

    const renderStepper = () => (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px', padding: '0 20px' }}>
            {steps.map((s, index) => {
                const isActive = step === s.id;
                const isCompleted = step > s.id;
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
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Morning Viral Repost"
                />
            </div>
            <div className="form-group">
                <label>Type</label>
                <div className="radio-group" style={{ display: 'flex', gap: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: formData.type === 'one_time' ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: formData.type === 'one_time' ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
                        <input
                            type="radio"
                            checked={formData.type === 'one_time'}
                            onChange={() => setFormData({ ...formData, type: 'one_time' })}
                        />
                        <div>
                            <strong>One-Time Run</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Run once at a scheduled time</div>
                        </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '15px', background: formData.type === 'scheduled' ? 'rgba(255,255,255,0.05)' : 'transparent', borderRadius: '8px', cursor: 'pointer', border: formData.type === 'scheduled' ? '1px solid var(--accent-primary)' : '1px solid transparent' }}>
                        <input
                            type="radio"
                            checked={formData.type === 'scheduled'}
                            onChange={() => setFormData({ ...formData, type: 'scheduled' })}
                        />
                        <div>
                            <strong>Scheduled (Recurring)</strong>
                            <div style={{ fontSize: '10px', color: 'gray' }}>Run automatically on schedule</div>
                        </div>
                    </label>
                </div>
            </div>

            {/* Schedule UI — merged from old Step 5 */}
            {formData.type === 'one_time' ? (
                <div className="card" style={{ padding: '20px', background: 'rgba(255, 255, 255, 0.05)', marginTop: '16px' }}>
                    <h4 style={{ marginTop: 0 }}>⏰ Schedule Run Time</h4>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
                        Choose when this campaign should run. It will execute once at the selected time.
                    </p>
                    <div className="form-group">
                        <label>Run At</label>
                        <DatePicker
                            selected={formData.schedule.runAt ? new Date(formData.schedule.runAt) : null}
                            onChange={(date: Date | null) => {
                                setFormData({
                                    ...formData,
                                    schedule: { ...formData.schedule, runAt: date ? date.toISOString() : '' }
                                })
                            }}
                            showTimeSelect
                            timeIntervals={15}
                            dateFormat="yyyy-MM-dd HH:mm"
                            timeFormat="HH:mm"
                            minDate={new Date()}
                            placeholderText="Select date and time"
                            className="form-control"
                            wrapperClassName="datepicker-wrapper"
                        />
                    </div>
                    {!formData.schedule.runAt && (
                        <div style={{ fontSize: '12px', color: '#ff9800', marginTop: '8px' }}>
                            ⚠️ Please select a time. You can also use "Save & Run Now" to run immediately.
                        </div>
                    )}
                </div>
            ) : (
                <div className="schedule-ui card" style={{ padding: '20px', marginTop: '16px' }}>
                    <div className="form-group">
                        <label>Interval</label>
                        <select
                            className="form-control"
                            value={formData.schedule.interval}
                            onChange={e => setFormData({ ...formData, schedule: { ...formData.schedule, interval: parseInt(e.target.value) } })}
                        >
                            <option value="30">Every 30 Minutes</option>
                            <option value="60">Every 1 Hour</option>
                            <option value="120">Every 2 Hours</option>
                            <option value="240">Every 4 Hours</option>
                            <option value="1440">Daily</option>
                        </select>
                    </div>
                    <div className="form-row" style={{ display: 'flex', gap: '16px' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Start Time</label>
                            <input type="time" className="form-control" value={formData.schedule.startTime} onChange={e => setFormData({ ...formData, schedule: { ...formData.schedule, startTime: e.target.value } })} />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>End Time</label>
                            <input type="time" className="form-control" value={formData.schedule.endTime} onChange={e => setFormData({ ...formData, schedule: { ...formData.schedule, endTime: e.target.value } })} />
                        </div>
                    </div>
                    <div className="form-group" style={{ marginTop: '12px' }}>
                        <label>Active Days</label>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
                                const isActive = formData.schedule.days.includes(day)
                                return (
                                    <button
                                        key={day}
                                        onClick={() => {
                                            setFormData(prev => ({
                                                ...prev,
                                                schedule: {
                                                    ...prev.schedule,
                                                    days: isActive
                                                        ? prev.schedule.days.filter(d => d !== day)
                                                        : [...prev.schedule.days, day]
                                                }
                                            }))
                                        }}
                                        style={{
                                            padding: '6px 10px',
                                            borderRadius: '6px',
                                            border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-primary)',
                                            background: isActive ? 'rgba(124,92,252,0.15)' : 'transparent',
                                            color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            fontWeight: 600
                                        }}
                                    >
                                        {day}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )

    // ─── Step 2: Source (opens fullscreen scanner) ────────────────
    const renderStep2_Source = () => (
        <div className="wizard-step">
            <h3>Step 2: Choose Content Source</h3>
            {formData.sourceConfig ? (
                <div style={{ padding: '20px', border: '1px solid var(--accent-green)', borderRadius: '12px', background: 'rgba(0,255,100,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                        <div style={{
                            width: '44px', height: '44px', borderRadius: '10px',
                            background: formData.sourceConfig.type === 'channel' ? 'rgba(37,244,238,0.15)' :
                                formData.sourceConfig.type === 'keyword' ? 'rgba(255,165,0,0.15)' : 'rgba(124,92,252,0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px'
                        }}>
                            {formData.sourceConfig.type === 'channel' ? '📺' :
                                formData.sourceConfig.type === 'keyword' ? '🔍' : '🎬'}
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '15px' }}>✅ Source Selected</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                <strong style={{ textTransform: 'capitalize' }}>{formData.sourceConfig.type}:</strong>{' '}
                                {formData.sourceConfig.value}
                            </div>
                        </div>
                    </div>
                    <button
                        className="btn btn-ghost"
                        onClick={() => setFormData({ ...formData, sourceConfig: null })}
                        style={{ fontSize: '13px' }}
                    >
                        ✕ Change Source
                    </button>
                </div>
            ) : (
                <div style={{
                    padding: '60px',
                    border: '2px dashed var(--border-primary)',
                    borderRadius: '12px',
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>📡</div>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
                        Open the Scanner to browse TikTok and select a channel, search keyword, or video as your content source.
                    </p>
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            onOpenScanner((source) => {
                                setFormData(prev => ({ ...prev, sourceConfig: source }))
                            })
                        }}
                        style={{ fontSize: '16px', padding: '12px 30px' }}
                    >
                        🔍 Open Scanner
                    </button>
                </div>
            )}
        </div>
    )

    // ─── Step 3: Video Editor ────────────────────────────────────
    const renderStep3_Editor = () => (
        <div className="wizard-step" style={{ height: '400px' }}>
            <h3>Step 3: Video Editor</h3>
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
        setFormData(prev => {
            const exists = prev.targetAccounts.includes(accId)
            return {
                ...prev,
                targetAccounts: exists
                    ? prev.targetAccounts.filter(id => id !== accId)
                    : [...prev.targetAccounts, accId]
            }
        })
    }

    const handleAddAccountInline = async () => {
        setAddingAccount(true)
        try {
            // @ts-ignore
            const account = await window.api.invoke('publish-account:add')
            if (account) {
                setPublishAccounts(prev => [account, ...prev])
                // Auto-select the newly added account
                setFormData(prev => ({
                    ...prev,
                    targetAccounts: [...prev.targetAccounts, String(account.id)]
                }))
            }
        } catch { }
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
            <h3>Step 4: Publish Target</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
                Select one or more accounts to publish to. You can add new accounts here too.
            </p>

            {/* Account list with checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {publishAccounts.map(acc => {
                    const isSelected = formData.targetAccounts.includes(String(acc.id))
                    const isValid = acc.session_valid === 1
                    return (
                        <div
                            key={acc.id}
                            onClick={() => toggleAccount(String(acc.id))}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '14px 16px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                border: isSelected ? '2px solid var(--accent-primary)' : '2px solid var(--border-primary)',
                                background: isSelected ? 'rgba(124, 92, 252, 0.08)' : 'var(--bg-secondary)',
                                transition: 'all 0.2s'
                            }}
                        >
                            {/* Checkbox */}
                            <div style={{
                                width: '22px', height: '22px', borderRadius: '6px',
                                border: isSelected ? 'none' : '2px solid var(--border-primary)',
                                background: isSelected ? 'var(--accent-primary)' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, transition: 'all 0.2s'
                            }}>
                                {isSelected && <span style={{ color: '#fff', fontSize: '14px', fontWeight: 700 }}>✓</span>}
                            </div>

                            {/* Avatar */}
                            <div style={{
                                width: '40px', height: '40px', borderRadius: '50%',
                                background: 'linear-gradient(135deg, #25f4ee, #fe2c55)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '16px', color: '#fff', fontWeight: 700,
                                overflow: 'hidden', flexShrink: 0
                            }}>
                                {acc.avatar_url ? (
                                    <img src={acc.avatar_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    acc.username?.charAt(0)?.toUpperCase() || '?'
                                )}
                            </div>

                            {/* Info */}
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: '14px' }}>
                                    {acc.display_name || acc.username}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    @{acc.username}
                                </div>
                            </div>

                            {/* Status */}
                            <span style={{
                                padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                                background: isValid ? 'rgba(74,222,128,0.15)' : 'rgba(244,67,54,0.15)',
                                color: isValid ? '#4ade80' : '#f44336'
                            }}>
                                {isValid ? 'ACTIVE' : 'EXPIRED'}
                            </span>

                            {/* Edit button */}
                            <button
                                className="btn btn-ghost"
                                onClick={(e) => { e.stopPropagation(); setEditingAccount(acc) }}
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                title="Edit settings"
                            >
                                ⚙️
                            </button>
                        </div>
                    )
                })}
            </div>

            {/* Add Account button */}
            <button
                className="btn btn-secondary"
                onClick={handleAddAccountInline}
                disabled={addingAccount}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}
            >
                {addingAccount ? (
                    <>
                        <span className="spinner" style={{ width: '14px', height: '14px' }} />
                        Waiting for login...
                    </>
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

    // Step 5 removed — schedule is now in Step 1

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}>
            <div className="wizard-modal" style={{ width: '900px', height: '700px', background: 'var(--bg-primary)', borderRadius: '16px', display: 'flex', flexDirection: 'column', padding: '30px', border: '1px solid var(--border-primary)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>

                <div style={{ marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, fontSize: '24px' }}>Create New Campaign</h2>
                    <p style={{ margin: '5px 0 0 0', color: 'var(--text-secondary)' }}>Follow the steps to setup your automation</p>
                </div>

                {renderStepper()}

                <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                    {step === 1 && renderStep1_Basic()}
                    {step === 2 && renderStep2_Source()}
                    {step === 3 && renderStep3_Editor()}
                    {step === 4 && renderStep4_Target()}
                </div>

                {/* Footer: Save / Save & Run Now (NO Draft) */}
                <div className="wizard-footer" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', marginTop: 'auto' }}>
                    <button className="btn btn-ghost" onClick={step === 1 ? onClose : handleBack} style={{ fontSize: '16px', padding: '10px 20px' }}>
                        {step === 1 ? 'Cancel' : '← Back'}
                    </button>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        {step < 4 ? (
                            <button className="btn btn-primary" onClick={handleNext} disabled={!canAdvance()} style={{ fontSize: '16px', padding: '10px 30px', opacity: canAdvance() ? 1 : 0.4 }}>Next →</button>
                        ) : (
                            <>
                                <button className="btn btn-secondary" onClick={() => onSave(formData, false)} style={{ fontSize: '16px', padding: '10px 20px' }}>
                                    💾 Save
                                </button>
                                <button className="btn btn-primary" onClick={() => onSave(formData, true)} style={{ fontSize: '16px', background: 'var(--accent-green)', color: '#000', padding: '10px 20px' }}>
                                    Save & Run Now 🚀
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Account Settings Modal */}
            {editingAccount && (
                <AccountSettingsModal
                    account={editingAccount}
                    onSave={handleUpdateAccountInline}
                    onClose={() => setEditingAccount(null)}
                />
            )}
        </div>
    )
}
