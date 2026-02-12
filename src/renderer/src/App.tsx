import { useState, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { VideoPicker } from './components/VideoPicker'
import { CampaignsView } from './views/CampaignsView'
import { ResourcesView } from './views/ResourcesView'
import { ScheduleView } from './views/ScheduleView'
import { StatsView } from './views/StatsView'
import { SettingsView } from './views/SettingsView'

function App(): JSX.Element {
    const [activeTab, setActiveTab] = useState<'campaigns' | 'resources' | 'schedule' | 'stats' | 'settings'>('campaigns')
    const [showScanner, setShowScanner] = useState(false)

    // Callback for when scanner is opened from the wizard — receives a function to call with selected source
    const [scannerCallback, setScannerCallback] = useState<((source: any) => void) | null>(null)

    const handleOpenScanner = useCallback(() => {
        setScannerCallback(null) // standalone mode
        setShowScanner(true)
    }, [])

    const handleOpenScannerForWizard = useCallback((callback: (source: any) => void) => {
        setScannerCallback(() => callback) // wrap in closure for useState
        setShowScanner(true)
    }, [])

    const handleScannerSourceSelected = useCallback((source: any) => {
        if (scannerCallback) {
            scannerCallback(source)
            setScannerCallback(null)
        }
        setShowScanner(false)
    }, [scannerCallback])

    const handleScannerClose = useCallback(() => {
        setScannerCallback(null)
        setShowScanner(false)
    }, [])

    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            {/* Sidebar Navigation */}
            <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Main Content Area */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {activeTab === 'campaigns' && (
                    <CampaignsView
                        onOpenScanner={handleOpenScanner}
                        onOpenScannerForWizard={handleOpenScannerForWizard}
                    />
                )}
                {activeTab === 'resources' && <ResourcesView />}
                {activeTab === 'schedule' && <ScheduleView />}
                {activeTab === 'stats' && <StatsView />}
                {activeTab === 'settings' && <SettingsView />}

                {/* Scanner Modal (Windowed) */}
                {showScanner && (
                    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: '92vw', height: '88vh', background: 'var(--bg-primary)', borderRadius: '16px', border: '1px solid var(--border-primary)', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* Window Title Bar */}
                            <div style={{ height: '44px', display: 'flex', alignItems: 'center', padding: '0 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)', flexShrink: 0, borderRadius: '16px 16px 0 0', gap: '12px' }}>
                                <span style={{ fontSize: '16px' }}>🔍</span>
                                <span style={{ fontWeight: 700, fontSize: '14px' }}>Scanner Tool</span>
                                {scannerCallback && (
                                    <span style={{
                                        marginLeft: '8px',
                                        padding: '3px 10px',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        background: 'rgba(124, 92, 252, 0.15)',
                                        color: 'var(--accent-primary)'
                                    }}>
                                        📡 Select a source for your campaign
                                    </span>
                                )}
                                <button
                                    className="btn btn-ghost"
                                    onClick={handleScannerClose}
                                    style={{ marginLeft: 'auto', fontSize: '18px', padding: '4px 10px', lineHeight: 1, borderRadius: '8px' }}
                                >
                                    ✕
                                </button>
                            </div>
                            {/* Scanner Content */}
                            <div style={{ flex: 1, minHeight: 0 }}>
                                <VideoPicker
                                    mode={scannerCallback ? 'select_source' : 'standalone'}
                                    onSelectSource={scannerCallback ? handleScannerSourceSelected : undefined}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default App
