import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { CampaignsView } from './views/CampaignsView'
import { AccountsView } from './views/AccountsView'
import { ResourcesView } from './views/ResourcesView'
import { ScheduleView } from './views/ScheduleView'
import { StatsView } from './views/StatsView'
import { SettingsView } from './views/SettingsView'
import { CampaignDetailsWindow } from './views/CampaignDetailsWindow'

import { ScannerApp } from './ScannerApp'

function App(): JSX.Element {
    const [activeTab, setActiveTab] = useState<'campaigns' | 'accounts' | 'resources' | 'schedule' | 'stats' | 'settings'>('campaigns')
    const [viewMode, setViewMode] = useState<'scan' | 'normal' | 'campaign-details'>('normal')
    const [campaignId, setCampaignId] = useState<number | null>(null)

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const mode = params.get('mode')
        const id = params.get('id')

        if (mode === 'scan') {
            setViewMode('scan')
        } else if (mode === 'campaign-details' && id) {
            setViewMode('campaign-details')
            setCampaignId(Number(id))
        }
    }, [])

    if (viewMode === 'scan') {
        return <ScannerApp />
    }

    if (viewMode === 'campaign-details' && campaignId) {
        return <CampaignDetailsWindow id={campaignId} />
    }

    // Default App Layout
    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            {/* Sidebar Navigation */}
            <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Main Content Area */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {activeTab === 'campaigns' && <CampaignsView />}
                {activeTab === 'accounts' && <AccountsView />}
                {activeTab === 'resources' && <ResourcesView />}
                {activeTab === 'schedule' && <ScheduleView />}
                {activeTab === 'stats' && <StatsView />}
                {activeTab === 'settings' && <SettingsView />}
            </div>
        </div>
    )
}

export default App
