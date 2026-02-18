import React, { useState } from 'react'
import { X, Save } from 'lucide-react'

interface EditCaptionModalProps {
    jobId: number
    initialCaption: string
    onSave: (jobId: number, newCaption: string) => void
    onClose: () => void
}

export const EditCaptionModal: React.FC<EditCaptionModalProps> = ({ jobId, initialCaption, onSave, onClose }) => {
    const [caption, setCaption] = useState(initialCaption)

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: '#1e1e1e', padding: '24px', borderRadius: '12px',
                width: '500px', maxWidth: '90%', border: '1px solid #333',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>Edit Caption</h2>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', color: '#aaa', marginBottom: '8px', fontSize: '0.9rem' }}>Caption</label>
                    <textarea
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                        style={{
                            width: '100%', height: '120px', background: '#111', border: '1px solid #333',
                            color: '#fff', borderRadius: '8px', padding: '12px', fontSize: '0.9rem', resize: 'vertical'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px 16px', background: 'transparent', border: '1px solid #444',
                            color: '#aaa', borderRadius: '6px', cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>

                    <button
                        onClick={() => onSave(jobId, caption)}
                        style={{
                            padding: '8px 20px', background: '#3b82f6', border: 'none',
                            color: '#fff', borderRadius: '6px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600
                        }}
                    >
                        <Save size={16} />
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    )
}
