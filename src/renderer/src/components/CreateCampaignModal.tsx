import React, { useState, useEffect } from 'react'

interface Props {
    onClose: () => void
    onSave: (data: any) => Promise<void>
}

export const CreateCampaignModal: React.FC<Props> = ({ onClose, onSave }) => {
    const [name, setName] = useState('')
    const [type, setType] = useState('scan_new')
    const [cron, setCron] = useState('*/30 * * * *') // Default 30 mins
    const [loading, setLoading] = useState(false)
    const [sources, setSources] = useState<any[]>([])
    const [selectedSources, setSelectedSources] = useState<number[]>([])

    useEffect(() => {
        // Load sources to allow selection
        const load = async () => {
            // @ts-ignore
            const data = await window.api.invoke('get-sources')
            const all = [
                ...(data.channels || []).map((c: any) => ({ ...c, type: 'channel' })),
                ...(data.keywords || []).map((k: any) => ({ ...k, type: 'keyword' }))
            ]
            setSources(all)
            // Default select all
            setSelectedSources(all.map((s: any) => s.id))
        }
        load()
    }, [])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name) return
        setLoading(true)
        try {
            await onSave({
                name,
                type,
                cron,
                config: {
                    source_ids: selectedSources
                }
            })
            onClose()
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
            <div className="card" style={{ width: '400px', padding: '20px', background: 'var(--bg-secondary)' }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px' }}>New Campaign</h3>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Name</label>
                        <input
                            className="input"
                            style={{ width: '100%' }}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. Daily Trend Scan"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Type</label>
                        <select className="input" style={{ width: '100%' }} value={type} onChange={e => setType(e.target.value)}>
                            <option value="scan_new">Scan New Videos (Incremental)</option>
                            <option value="scan_all">Scan Full Feed (Deep)</option>
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Schedule (Cron)</label>
                        <input
                            className="input"
                            style={{ width: '100%' }}
                            value={cron}
                            onChange={e => setCron(e.target.value)}
                            placeholder="*/30 * * * *"
                        />
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Default: Every 30 minutes
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
                            Sources ({selectedSources.length}/{sources.length})
                        </label>
                        <div style={{
                            maxHeight: '100px',
                            overflowY: 'auto',
                            border: '1px solid var(--border-primary)',
                            borderRadius: '4px',
                            padding: '4px',
                            background: 'var(--bg-primary)'
                        }}>
                            {sources.map(s => (
                                <label key={s.id} style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '2px 0', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedSources.includes(s.id)}
                                        onChange={e => {
                                            if (e.target.checked) setSelectedSources([...selectedSources, s.id])
                                            else setSelectedSources(selectedSources.filter(id => id !== s.id))
                                        }}
                                    />
                                    {s.username || s.keyword} <span style={{ opacity: 0.5 }}>({s.type})</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={loading || !name}>
                            {loading ? 'Creating...' : 'Create Campaign'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    )
}
