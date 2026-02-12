import { EditEffect } from '../types'

export const WatermarkEffect: EditEffect = {
    id: 'watermark',
    name: 'Watermark',
    description: 'Overlay a logo/image as a watermark on the video',
    icon: '💧',
    category: 'overlay',
    params: [
        {
            key: 'imagePath',
            label: 'Watermark Image',
            type: 'file',
            accept: 'image/png'
        },
        {
            key: 'position',
            label: 'Position',
            type: 'select',
            default: 'bottom-right',
            options: [
                { value: 'top-left', label: 'Top Left' },
                { value: 'top-right', label: 'Top Right' },
                { value: 'bottom-left', label: 'Bottom Left' },
                { value: 'bottom-right', label: 'Bottom Right' },
                { value: 'center', label: 'Center' }
            ]
        },
        {
            key: 'opacity',
            label: 'Opacity (%)',
            type: 'number',
            default: 50,
            min: 10,
            max: 100
        },
        {
            key: 'scale',
            label: 'Scale (%)',
            type: 'number',
            default: 20,
            min: 5,
            max: 80
        }
    ]
}
