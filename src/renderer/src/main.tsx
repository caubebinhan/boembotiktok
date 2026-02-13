import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ScannerApp } from './ScannerApp'
import './assets/index.css'

// Check if we're in scanner mode (opened as a separate window)
const params = new URLSearchParams(window.location.search)
const isScanner = params.get('mode') === 'scanner'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        {isScanner ? <ScannerApp /> : <App />}
    </React.StrictMode>
)
