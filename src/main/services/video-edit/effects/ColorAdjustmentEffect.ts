import { EditEffect } from '../types'

export const ColorAdjustmentEffect: EditEffect = {
    id: 'color_adjust',
    name: 'Color Adjust',
    description: 'Tune brightness, contrast, and saturation for a unique look',
    icon: '🎨',
    category: 'filter',
    params: [
        {
            key: 'brightness',
            label: 'Brightness (-1 to 1)',
            type: 'number',
            default: 0.05,
            min: -0.2,
            max: 0.2
        },
        {
            key: 'contrast',
            label: 'Contrast (0 to 2)',
            type: 'number',
            default: 1.05,
            min: 0.8,
            max: 1.2
        },
        {
            key: 'saturation',
            label: 'Saturation (0 to 3)',
            type: 'number',
            default: 1.1,
            min: 0.5,
            max: 2.0
        }
    ]
}
