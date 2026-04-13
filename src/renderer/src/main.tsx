import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { CaptureWorker } from './components/CaptureWorker'
import './assets/base.css'

const isCaptureWorker = typeof window !== 'undefined' && window.location.search.includes('capture=1')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCaptureWorker ? <CaptureWorker /> : <App />}
  </React.StrictMode>
)
