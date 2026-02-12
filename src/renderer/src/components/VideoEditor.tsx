import React, { useState, useEffect } from 'react'

/**
 * VideoEditor — CapCut-style 3-panel layout.
 * 
 * Layout:
 * ┌──────────────────────────────────┐
 * │  Preview (left)  │ Effects (right)│
 * ├──────────────────────────────────┤
 * │        Timeline (bottom)         │
 * └──────────────────────────────────┘
 * 
 * Effects are fetched dynamically from the VideoEditEngine via IPC.
 * The frontend NEVER hardcodes effect-specific UI.
 */

interface EditParam {
    key: string
    label: string
    type: 'file' | 'text' | 'number' | 'color' | 'select'
    default?: any
    options?: { value: string; label: string }[]
    min?: number
    max?: number
    accept?: string
}

interface EditEffect {
    id: string
    name: string
    description: string
    icon: string
    category: string
    params: EditParam[]
}

interface AppliedEffect {
    effectId: string
    params: Record<string, any>
}

interface EditPipeline {
    effects: AppliedEffect[]
}

interface VideoEditorProps {
    pipeline: EditPipeline
    onChange: (pipeline: EditPipeline) => void
}

// Effect colors for timeline blocks
const EFFECT_COLORS = [
    '#7c5cfc', '#25f4ee', '#fe2c55', '#ff9800', '#4caf50',
    '#e91e63', '#00bcd4', '#9c27b0', '#ff5722', '#607d8b'
]

export const VideoEditor: React.FC<VideoEditorProps> = ({ pipeline, onChange }) => {
    const [availableEffects, setAvailableEffects] = useState<EditEffect[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

    useEffect(() => {
        loadEffects()
    }, [])

    const loadEffects = async () => {
        try {
            // @ts-ignore
            const effects = await window.api.invoke('edit:get-effects')
            setAvailableEffects(effects || [])
        } catch (err) {
            console.error('Failed to load effects:', err)
        } finally {
            setLoading(false)
        }
    }

    const addEffect = (effect: EditEffect) => {
        const defaultParams: Record<string, any> = {}
        for (const p of effect.params) {
            defaultParams[p.key] = p.default ?? ''
        }
        const newPipeline: EditPipeline = {
            effects: [...pipeline.effects, { effectId: effect.id, params: defaultParams }]
        }
        onChange(newPipeline)
        setSelectedIndex(newPipeline.effects.length - 1)
    }

    const removeEffect = (index: number) => {
        const newEffects = [...pipeline.effects]
        newEffects.splice(index, 1)
        onChange({ effects: newEffects })
        setSelectedIndex(null)
    }

    const updateParam = (index: number, key: string, value: any) => {
        const newEffects = [...pipeline.effects]
        newEffects[index] = {
            ...newEffects[index],
            params: { ...newEffects[index].params, [key]: value }
        }
        onChange({ effects: newEffects })
    }

    const moveEffect = (index: number, direction: 'up' | 'down') => {
        const newEffects = [...pipeline.effects]
        const swapIndex = direction === 'up' ? index - 1 : index + 1
        if (swapIndex < 0 || swapIndex >= newEffects.length) return
            ;[newEffects[index], newEffects[swapIndex]] = [newEffects[swapIndex], newEffects[index]]
        onChange({ effects: newEffects })
        setSelectedIndex(swapIndex)
    }

    const getEffectDef = (effectId: string): EditEffect | undefined => {
        return availableEffects.find(e => e.id === effectId)
    }

    const getEffectColor = (index: number): string => {
        return EFFECT_COLORS[index % EFFECT_COLORS.length]
    }

    const handleFileSelect = async (index: number, paramKey: string) => {
        try {
            // @ts-ignore
            const filePath = await window.api.invoke('dialog:open-file', { title: 'Select File' })
            if (filePath) updateParam(index, paramKey, filePath)
        } catch (err) {
            console.error('File select failed:', err)
        }
    }

    // ─── Dynamic Param Renderer ────────────────────────────────
    const renderParam = (param: EditParam, value: any, index: number) => {
        const inputStyle: React.CSSProperties = {
            width: '100%', padding: '8px 12px', border: '1px solid var(--border-primary)',
            borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)',
            fontSize: '13px'
        }

        switch (param.type) {
            case 'text':
                return (
                    <input type="text" style={inputStyle} value={value || ''}
                        onChange={e => updateParam(index, param.key, e.target.value)}
                        placeholder={param.label} />
                )
            case 'number':
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input type="range" min={param.min ?? 0} max={param.max ?? 100}
                            value={value ?? param.default ?? 0}
                            onChange={e => updateParam(index, param.key, Number(e.target.value))}
                            style={{ flex: 1 }} />
                        <span style={{ minWidth: '36px', textAlign: 'right', fontWeight: 500, fontSize: '13px' }}>
                            {value ?? param.default ?? 0}
                        </span>
                    </div>
                )
            case 'color':
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input type="color" value={value || param.default || '#ffffff'}
                            onChange={e => updateParam(index, param.key, e.target.value)}
                            style={{ width: '36px', height: '28px', border: 'none', cursor: 'pointer' }} />
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{value || param.default}</span>
                    </div>
                )
            case 'select':
                return (
                    <select style={inputStyle} value={value || param.default || ''}
                        onChange={e => updateParam(index, param.key, e.target.value)}>
                        {(param.options || []).map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                )
            case 'file':
                return (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input type="text" style={{ ...inputStyle, flex: 1 }} value={value || ''} readOnly placeholder="No file selected" />
                        <button className="btn btn-secondary"
                            style={{ padding: '8px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                            onClick={() => handleFileSelect(index, param.key)}>
                            Browse
                        </button>
                    </div>
                )
            default:
                return <span>Unsupported: {param.type}</span>
        }
    }

    // ─── Render ────────────────────────────────────────────────
    if (loading) {
        return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading effects...</div>
    }

    const selectedEffect = selectedIndex !== null ? pipeline.effects[selectedIndex] : null
    const selectedDef = selectedEffect ? getEffectDef(selectedEffect.effectId) : null

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0' }}>
            {/* ═══ Top Section: Preview + Effects/Params ═══ */}
            <div style={{ flex: 1, display: 'flex', gap: '0', minHeight: 0, borderBottom: '1px solid var(--border-primary)' }}>

                {/* Left: Preview Panel */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#000',
                    borderRadius: '8px 0 0 0',
                    position: 'relative',
                    minWidth: 0
                }}>
                    <div style={{ textAlign: 'center', color: '#555' }}>
                        <div style={{ fontSize: '48px', marginBottom: '8px' }}>▶</div>
                        <div style={{ fontSize: '13px' }}>Video Preview</div>
                        <div style={{ fontSize: '11px', marginTop: '4px', color: '#444' }}>
                            Select a video to preview with effects
                        </div>
                    </div>

                    {/* Effect count badge */}
                    {pipeline.effects.length > 0 && (
                        <div style={{
                            position: 'absolute', top: '10px', right: '10px',
                            padding: '4px 10px', borderRadius: '10px',
                            background: 'rgba(124, 92, 252, 0.2)', color: '#7c5cfc',
                            fontSize: '11px', fontWeight: 600
                        }}>
                            {pipeline.effects.length} effect{pipeline.effects.length > 1 ? 's' : ''} applied
                        </div>
                    )}
                </div>

                {/* Right: Effects Palette / Params */}
                <div style={{
                    width: '220px',
                    flexShrink: 0,
                    borderLeft: '1px solid var(--border-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    {selectedDef && selectedIndex !== null ? (
                        /* ── Selected Effect Params ── */
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                <button
                                    onClick={() => setSelectedIndex(null)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '14px' }}
                                >←</button>
                                <span style={{ fontSize: '20px' }}>{selectedDef.icon}</span>
                                <span style={{ fontWeight: 600, fontSize: '14px' }}>{selectedDef.name}</span>
                            </div>

                            {selectedDef.params.map(param => (
                                <div key={param.key} style={{ marginBottom: '12px' }}>
                                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 500 }}>
                                        {param.label}
                                    </label>
                                    {renderParam(param, selectedEffect!.params[param.key], selectedIndex)}
                                </div>
                            ))}

                            <div style={{ marginTop: '16px', display: 'flex', gap: '6px' }}>
                                <button
                                    onClick={() => moveEffect(selectedIndex, 'up')}
                                    disabled={selectedIndex === 0}
                                    className="btn btn-ghost"
                                    style={{ flex: 1, padding: '6px', fontSize: '12px', opacity: selectedIndex === 0 ? 0.3 : 1 }}
                                >▲ Up</button>
                                <button
                                    onClick={() => moveEffect(selectedIndex, 'down')}
                                    disabled={selectedIndex === pipeline.effects.length - 1}
                                    className="btn btn-ghost"
                                    style={{ flex: 1, padding: '6px', fontSize: '12px', opacity: selectedIndex === pipeline.effects.length - 1 ? 0.3 : 1 }}
                                >▼ Down</button>
                            </div>

                            <button
                                onClick={() => removeEffect(selectedIndex)}
                                className="btn btn-ghost"
                                style={{ width: '100%', marginTop: '8px', color: '#f44336', fontSize: '12px', padding: '6px' }}
                            >🗑️ Remove Effect</button>
                        </div>
                    ) : (
                        /* ── Effects Palette ── */
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
                                Add Effect
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {availableEffects.map(effect => (
                                    <div
                                        key={effect.id}
                                        onClick={() => addEffect(effect)}
                                        style={{
                                            padding: '10px',
                                            border: '1px solid var(--border-primary)',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            background: 'var(--bg-secondary)',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                        onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '18px' }}>{effect.icon}</span>
                                            <div>
                                                <div style={{ fontSize: '12px', fontWeight: 600 }}>{effect.name}</div>
                                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{effect.description}</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {availableEffects.length === 0 && (
                                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                                        No effects available.<br />Effects are loaded from plugins.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ Bottom: Timeline ═══ */}
            <div style={{
                height: '100px',
                flexShrink: 0,
                background: 'var(--bg-secondary)',
                borderRadius: '0 0 8px 8px',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Timeline header */}
                <div style={{
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid var(--border-primary)',
                    fontSize: '11px',
                    color: 'var(--text-secondary)'
                }}>
                    <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        ⏱ Timeline — {pipeline.effects.length} Layer{pipeline.effects.length !== 1 ? 's' : ''}
                    </span>
                    <span>Click a layer to edit • Drag to reorder (coming soon)</span>
                </div>

                {/* Timeline tracks */}
                <div style={{ flex: 1, padding: '8px 12px', overflowX: 'auto', display: 'flex', alignItems: 'center' }}>
                    {pipeline.effects.length === 0 ? (
                        <div style={{
                            width: '100%', height: '100%',
                            border: '2px dashed var(--border-primary)', borderRadius: '6px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-muted)', fontSize: '12px'
                        }}>
                            Add effects from the palette to build your editing pipeline →
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', width: '100%' }}>
                            {pipeline.effects.map((applied, index) => {
                                const def = getEffectDef(applied.effectId)
                                const color = getEffectColor(index)
                                const isSelected = selectedIndex === index
                                return (
                                    <div
                                        key={index}
                                        onClick={() => setSelectedIndex(isSelected ? null : index)}
                                        style={{
                                            flex: 1,
                                            minWidth: '80px',
                                            height: '48px',
                                            borderRadius: '6px',
                                            background: `${color}${isSelected ? '40' : '20'}`,
                                            border: isSelected ? `2px solid ${color}` : `1px solid ${color}50`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            position: 'relative'
                                        }}
                                    >
                                        <span style={{ fontSize: '16px' }}>{def?.icon || '❓'}</span>
                                        <span style={{ fontSize: '11px', fontWeight: 600, color: color }}>
                                            {def?.name || applied.effectId}
                                        </span>
                                        {/* Layer number */}
                                        <span style={{
                                            position: 'absolute',
                                            top: '2px',
                                            left: '6px',
                                            fontSize: '9px',
                                            color: `${color}80`,
                                            fontWeight: 700
                                        }}>
                                            L{index + 1}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
