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

                {/* Scanner Overlay (Fullscreen) */}
                {showScanner && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, background: 'var(--bg-primary)' }}>
                        <div style={{ height: '40px', display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                            <button className="btn btn-ghost" onClick={handleScannerClose}>
                                ← Back to Dashboard
                            </button>
                            <span style={{ marginLeft: '10px', fontWeight: 600 }}>Scanner Tool</span>
                            {scannerCallback && (
                                <span style={{
                                    marginLeft: 'auto',
                                    padding: '4px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    background: 'rgba(124, 92, 252, 0.15)',
                                    color: 'var(--accent-primary)'
                                }}>
                                    📡 Select a source for your campaign
                                </span>
                            )}
                        </div>
                        <div style={{ height: 'calc(100% - 40px)' }}>
                            <VideoPicker
                                mode={scannerCallback ? 'select_source' : 'standalone'}
                                onSelectSource={scannerCallback ? handleScannerSourceSelected : undefined}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default App
