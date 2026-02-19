import * as Sentry from '@sentry/electron/renderer'
import { initRendererLogger } from './utils/logger'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store/store'
import App from './App'
import { ScannerApp } from './ScannerApp'
import './assets/index.css'

Sentry.init({
    dsn: "https://d1b349bdb3819e07b291007cc5649940@o4510911108546560.ingest.us.sentry.io/4510911110316032",
});

initRendererLogger();

// Check if we're in scanner mode (opened as a separate window)
const params = new URLSearchParams(window.location.search)
const isScanner = params.get('mode') === 'scanner'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Provider store={store}>
            {isScanner ? <ScannerApp /> : <App />}
        </Provider>
    </React.StrictMode>
)
