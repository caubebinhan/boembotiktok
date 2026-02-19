import { EditEffect } from '../types'

export const MirrorEffect: EditEffect = {
    id: 'mirror',
    name: 'Mirror (Flip)',
    description: 'Flip the video horizontally to bypass duplicate detection',
    icon: '🪞',
    category: 'transform',
    params: [
        {
            key: 'active',
            label: 'Enable Mirroring',
            type: 'select',
            default: 'true',
            options: [
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' }
            ]
        }
    ]
}
