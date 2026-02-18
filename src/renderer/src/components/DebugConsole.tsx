import React, { useEffect, useState, useRef } from 'react'

interface LogEntry {
    level: 'info' | 'warn' | 'error' | 'debug'
    message: string
    timestamp: string
    context?: string
}

export const DebugConsole: React.FC = () => {
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [isVisible, setIsVisible] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    const logsEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // Check initial debug mode status from settings (optional, or just default hidden)
        const checkDebugMode = async () => {
            const enabled = await (window as any).api.invoke('get-setting', 'app.debugMode')
            if (enabled === 'true') setIsVisible(true)
        }
        checkDebugMode()

        // Listen for new logs
        const removeListener = (window as any).api.on('logger:new-entry', (_event: any, entry: LogEntry) => {
            setLogs(prev => [...prev.slice(-99), entry]) // Keep last 100 logs
            if (!isVisible) setIsVisible(true) // Auto-show if logs start flowing? Or maybe not.
        })

        return () => {
            removeListener()
        }
    }, [])

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [logs, isVisible, isMinimized])

    if (!isVisible) return null

    return (
        <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            width: '100%',
            height: isMinimized ? '30px' : '200px',
            backgroundColor: '#1e1e1e',
            borderTop: '1px solid #333',
            color: '#d4d4d4',
            zIndex: 9999,
            fontFamily: 'monospace',
            fontSize: '12px',
            display: 'flex',
            flexDirection: 'column',
            transition: 'height 0.2s'
        }}>
            {/* Header */}
            <div style={{
                padding: '5px 10px',
                backgroundColor: '#252526',
                borderBottom: '1px solid #333',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer'
            }} onClick={() => setIsMinimized(!isMinimized)}>
                <span style={{ fontWeight: 'bold' }}>🖥️ Debug Console ({logs.length})</span>
                <div>
                    <button
                        onClick={(e) => { e.stopPropagation(); setLogs([]) }}
                        style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', marginRight: '10px' }}
                    >
                        Clear
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsVisible(false) }}
                        style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer' }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Logs Body */}
            {!isMinimized && (
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '5px 10px'
                }}>
                    {logs.map((log, idx) => (
                        <div key={idx} style={{ marginBottom: '2px', display: 'flex' }}>
                            <span style={{ color: '#569cd6', marginRight: '5px' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span style={{
                                color: log.level === 'error' ? '#f48771' : log.level === 'warn' ? '#cca700' : '#4ec9b0',
                                marginRight: '5px',
                                width: '50px',
                                display: 'inline-block'
                            }}>[{log.level.toUpperCase()}]</span>
                            <span style={{ color: '#ce9178', marginRight: '5px' }}>[{log.context || 'System'}]</span>
                            <span style={{ whiteSpace: 'pre-wrap' }}>{log.message}</span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            )}
        </div>
    )
}
