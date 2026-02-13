import React, { useState, useCallback } from 'react'
import { VideoPicker } from './components/VideoPicker'

/**
 * ScannerApp — rendered when the app loads with ?mode=scanner
 * Full-screen VideoPicker with a prominent "SAVE TARGET SOURCE" button.
 */
export const ScannerApp: React.FC = () => {
    const [saved, setSaved] = useState(false)

    const handleSave = useCallback(async (source: any) => {
        try {
            // @ts-ignore
            await window.api.invoke('scanner-save-results', source)
            setSaved(true)
            setTimeout(() => window.close(), 600)
        } catch (err) {
            console.error('Failed to save scanner results:', err)
        }
    }, [])

    if (saved) {
        return (
            <div style={{
                width: '100vw', height: '100vh',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                flexDirection: 'column', gap: '12px'
            }}>
                <div style={{ fontSize: '60px' }}>✅</div>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>Sources Saved!</div>
                <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Closing window...</div>
            </div>
        )
    }

    return (
        <div style={{
            width: '100vw', height: '100vh',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
            background: 'var(--bg-primary)', color: 'var(--text-primary)'
        }}>
            {/* Scanner Header */}
            <div style={{
                padding: '10px 16px',
                background: 'linear-gradient(135deg, rgba(37, 244, 238, 0.1), rgba(254, 44, 85, 0.1))',
                borderBottom: '1px solid var(--border-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>🔍</span>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '15px' }}>Scanner Tool</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Browse TikTok → Select a source → Click "Save Target Source"
                        </div>
                    </div>
                </div>
            </div>

            {/* VideoPicker fills the rest */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <VideoPicker
                    mode="select_source"
                    onSelectSource={handleSave}
                />
            </div>
        </div>
    )
}
