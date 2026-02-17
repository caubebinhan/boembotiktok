import React, { useState, useEffect } from 'react'

interface SettingItem {
    key: string
    label: string
    description: string
    type: 'text' | 'number' | 'toggle' | 'select'
    section: string
    default: string
    options?: { value: string; label: string }[]
}

const SETTING_DEFINITIONS: SettingItem[] = [
    // General
    { key: 'app.downloadPath', label: 'Download Path', description: 'Where downloaded videos are saved', type: 'text', section: 'General', default: '' },
    { key: 'app.maxConcurrentDownloads', label: 'Max Concurrent Downloads (Threads)', description: 'Simultaneous threads per job', type: 'number', section: 'General', default: '3' },
    { key: 'app.maxConcurrentJobs', label: 'Max Concurrent Jobs', description: 'Total jobs running at once', type: 'number', section: 'General', default: '100' },
    { key: 'app.autoStartScheduler', label: 'Auto-start Scheduler', description: 'Automatically start the scheduler on app launch', type: 'toggle', section: 'General', default: 'true' },

    // Browser
    { key: 'browser.headless', label: 'Headless Mode', description: 'Run browser in headless mode (no visible window)', type: 'toggle', section: 'Browser', default: 'true' },
    { key: 'browser.proxy', label: 'Proxy URL', description: 'HTTP/SOCKS5 proxy for browser requests (e.g. socks5://...)', type: 'text', section: 'Browser', default: '' },

    // Video Processing
    {
        key: 'video.defaultQuality', label: 'Default Quality', description: 'Preferred video download quality', type: 'select', section: 'Video Processing', default: 'highest', options: [
            { value: 'highest', label: 'Highest Available' },
            { value: '1080p', label: '1080p' },
            { value: '720p', label: '720p' },
            { value: '480p', label: '480p' }
        ]
    },
    { key: 'video.autoEdit', label: 'Auto-apply Edit Pipeline', description: 'Automatically apply the default edit pipeline after download', type: 'toggle', section: 'Video Processing', default: 'false' },

    // Rate Limiting
    { key: 'rateLimit.scanInterval', label: 'Scan Interval (minutes)', description: 'Minimum time between scans of the same source', type: 'number', section: 'Rate Limiting', default: '60' },
    { key: 'rateLimit.publishDelay', label: 'Publish Delay (seconds)', description: 'Delay between consecutive publishes', type: 'number', section: 'Rate Limiting', default: '300' },
]

export const SettingsView: React.FC = () => {
    const [values, setValues] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState<string | null>(null)
    const [saved, setSaved] = useState<string | null>(null)

    useEffect(() => {
        loadSettings()
    }, [])

    const loadSettings = async () => {
        try {
            // @ts-ignore
            const rows: { key: string; value: string }[] = await window.api.invoke('get-settings')
            const map: Record<string, string> = {}
            for (const def of SETTING_DEFINITIONS) {
                map[def.key] = def.default
            }
            for (const row of (rows || [])) {
                map[row.key] = row.value
            }
            setValues(map)
        } catch (err) {
            console.error('Failed to load settings:', err)
        } finally {
            setLoading(false)
        }
    }

    const saveSetting = async (key: string, value: string) => {
        setSaving(key)
        try {
            setValues(prev => ({ ...prev, [key]: value }))
            // @ts-ignore
            await window.api.invoke('save-setting', key, value)
            setSaved(key)
            setTimeout(() => setSaved(null), 1500)
        } catch (err) {
            console.error('Failed to save setting:', err)
        } finally {
            setSaving(null)
        }
    }

    const handleBrowsePath = async (key: string) => {
        // @ts-ignore
        const filePath = await window.api.invoke('dialog:open-file', { title: 'Select Folder' })
        if (filePath) {
            saveSetting(key, filePath)
        }
    }

    const sections = [...new Set(SETTING_DEFINITIONS.map(s => s.section))]

    const renderInput = (def: SettingItem) => {
        const value = values[def.key] ?? def.default
        const isSaving = saving === def.key
        const isSaved = saved === def.key

        const inputStyle: React.CSSProperties = {
            flex: 1, padding: '10px 14px', borderRadius: '8px',
            border: '1px solid var(--border-primary)', background: 'var(--bg-input)',
            color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit',
            outline: 'none', transition: 'border 0.15s ease'
        }

        switch (def.type) {
            case 'text':
                return (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                            type="text"
                            style={inputStyle}
                            value={value}
                            onChange={e => saveSetting(def.key, e.target.value)}
                            placeholder={def.label}
                        />
                        {def.key.includes('Path') && (
                            <button className="btn btn-ghost" onClick={() => handleBrowsePath(def.key)}
                                style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                                📁 Browse
                            </button>
                        )}
                        {isSaving && <span className="spinner" style={{ width: '14px', height: '14px' }} />}
                        {isSaved && <span style={{ color: 'var(--accent-green)', fontSize: '16px' }}>✓</span>}
                    </div>
                )
            case 'number':
                return (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <input
                            type="number"
                            style={{ ...inputStyle, width: '120px', flex: 'none' }}
                            value={value}
                            onChange={e => saveSetting(def.key, e.target.value)}
                            min={0}
                        />
                        {isSaved && <span style={{ color: 'var(--accent-green)', fontSize: '16px' }}>✓</span>}
                    </div>
                )
            case 'toggle':
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                            onClick={() => saveSetting(def.key, value === 'true' ? 'false' : 'true')}
                            style={{
                                width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer',
                                background: value === 'true' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                                border: '1px solid var(--border-primary)', position: 'relative',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <div style={{
                                width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                                position: 'absolute', top: '2px',
                                left: value === 'true' ? '22px' : '2px',
                                transition: 'left 0.2s ease',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                            }} />
                        </div>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            {value === 'true' ? 'Enabled' : 'Disabled'}
                        </span>
                    </div>
                )
            case 'select':
                return (
                    <select
                        style={{ ...inputStyle, cursor: 'pointer', maxWidth: '250px' }}
                        value={value}
                        onChange={e => saveSetting(def.key, e.target.value)}
                    >
                        {(def.options || []).map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                )
            default:
                return null
        }
    }

    if (loading) {
        return (
            <div className="page-enter" style={{ padding: '24px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="spinner" style={{ width: '24px', height: '24px', marginBottom: '12px' }} />
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading settings...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="page-enter" style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', padding: '24px', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Settings</h1>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                    Configure application behavior and preferences
                </p>
            </div>

            {/* Settings Sections */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '20px' }}>
                {sections.map(section => {
                    const items = SETTING_DEFINITIONS.filter(s => s.section === section)
                    const sectionIcons: Record<string, string> = {
                        'General': '⚙️', 'Browser': '🌐', 'Video Processing': '🎬', 'Rate Limiting': '⏱️'
                    }
                    return (
                        <div key={section}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                <span style={{ fontSize: '18px' }}>{sectionIcons[section] || '📋'}</span>
                                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{section}</h2>
                            </div>
                            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                {items.map((def, i) => (
                                    <div
                                        key={def.key}
                                        style={{
                                            padding: '18px 20px',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            borderBottom: i < items.length - 1 ? '1px solid var(--border-primary)' : 'none',
                                            gap: '24px'
                                        }}
                                    >
                                        <div style={{ flex: '0 0 220px' }}>
                                            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>{def.label}</div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{def.description}</div>
                                        </div>
                                        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                                            {renderInput(def)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                })}

                {/* App Info */}
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                    <div style={{ marginBottom: '4px', fontWeight: 600 }}>Boembo v1.0.0</div>
                    <div>Video management & scheduling desktop app</div>
                </div>
            </div>
        </div>
    )
}
