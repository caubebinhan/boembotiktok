import { EditEffect } from '../types'

export const SubtleZoomEffect: EditEffect = {
    id: 'subtle_zoom',
    name: 'Subtle Zoom',
    description: 'Apply a slight zoom and crop to change the framing',
    icon: '🔍',
    category: 'transform',
    params: [
        {
            key: 'level',
            label: 'Zoom Level (%)',
            type: 'number',
            default: 2,
            min: 1,
            max: 10
        }
    ]
}
