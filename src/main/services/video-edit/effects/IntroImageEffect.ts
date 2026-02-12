import { EditEffect } from '../types'

export const IntroImageEffect: EditEffect = {
    id: 'intro_image',
    name: 'Intro Image',
    description: 'Insert an image at the beginning of the video for a set duration',
    icon: '🖼️',
    category: 'intro',
    params: [
        {
            key: 'imagePath',
            label: 'Image File',
            type: 'file',
            accept: 'image/*'
        },
        {
            key: 'duration',
            label: 'Duration (seconds)',
            type: 'number',
            default: 3,
            min: 1,
            max: 30
        }
    ]
}
