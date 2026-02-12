import { EditEffect } from '../types'

export const TextOverlayEffect: EditEffect = {
    id: 'text_overlay',
    name: 'Text Overlay',
    description: 'Add text on top of the video',
    icon: '📝',
    category: 'overlay',
    params: [
        {
            key: 'text',
            label: 'Text Content',
            type: 'text',
            default: 'Hello World'
        },
        {
            key: 'fontSize',
            label: 'Font Size',
            type: 'number',
            default: 36,
            min: 8,
            max: 200
        },
        {
            key: 'fontColor',
            label: 'Font Color',
            type: 'color',
            default: '#ffffff'
        },
        {
            key: 'position',
            label: 'Position',
            type: 'select',
            default: 'center',
            options: [
                { value: 'top', label: 'Top Center' },
                { value: 'center', label: 'Center' },
                { value: 'bottom', label: 'Bottom Center' },
                { value: 'top-left', label: 'Top Left' },
                { value: 'top-right', label: 'Top Right' },
                { value: 'bottom-left', label: 'Bottom Left' },
                { value: 'bottom-right', label: 'Bottom Right' }
            ]
        }
    ]
}
