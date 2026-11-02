import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import App from './App'
import { completeNativeSignIn } from './lib/auth'
import { goTo } from './lib/navigateRef'
import { startAuthListener } from './lib/nativeAuth'
import { isNativeApp } from './lib/platform'
import 'flag-icons/css/flag-icons.min.css'
import './index.css'

if (isNativeApp()) {
  startAuthListener(
    {
      onUrlOpen: (cb) => {
        const handle = CapApp.addListener('appUrlOpen', (e) => cb(e.url))
        return () => void handle.then((h) => h.remove())
      },
    },
    completeNativeSignIn,
    goTo,
    Browser,
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
