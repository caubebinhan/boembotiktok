import { EditEffect } from '../types'

export const SpeedAdjustmentEffect: EditEffect = {
    id: 'speed_adjust',
    name: 'Speed Adjust',
    description: 'Slightly change video and audio speed',
    icon: '⚡',
    category: 'transform',
    params: [
        {
            key: 'multiplier',
            label: 'Speed Multiplier',
            type: 'number',
            default: 1.02,
            min: 0.9,
            max: 1.1
        }
    ]
}
