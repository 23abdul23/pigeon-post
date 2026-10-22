import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { COGNITO_CONFIGURED, useAuth } from './lib/auth'
import { setState, useStore } from './lib/store'
import { useServerSync } from './lib/sync'
import AuthCallback from './screens/AuthCallback'
import ChooseBird from './screens/ChooseBird'
import Dashboard from './screens/Dashboard'
import AddFriend from './screens/AddFriend'
import Focus from './screens/Focus'
import Friends from './screens/Friends'
import EnvelopeOpening from './screens/EnvelopeOpening'
import HomeCity from './screens/HomeCity'
import JournalDetail from './screens/JournalDetail'
import Journal from './screens/Journal'
import Landing from './screens/Landing'
import Mailbox from './screens/Mailbox'
import OpenedLetter from './screens/OpenedLetter'
import Passport from './screens/Passport'
import Settings from './screens/Settings'
import ShareStamps from './screens/ShareStamps'
import SignIn from './screens/SignIn'
import TripComposer from './screens/TripComposer'

/** Auth + onboarding guard from Flow.md section 2. */
function Guard({ children, onboarding = false }: { children: ReactNode; onboarding?: boolean }) {
  const user = useStore((s) => s.user)
  const home = useStore((s) => s.homeCity)
  const bird = useStore((s) => s.bird)
  const loc = useLocation()
  const auth = useAuth()
  // Signed-in users get their profile from the server (GET /state) before the onboarding checks below.
  const synced = useServerSync(COGNITO_CONFIGURED && auth.status === 'signedIn')
  // With Cognito the session is the source of truth; mirror it into the store for screens that read `user`.
  useEffect(() => {
    if (COGNITO_CONFIGURED && auth.status === 'signedIn' && !user) {
      setState({ user: { name: auth.email?.split('@')[0] ?? 'Traveler', email: auth.email ?? '' } })
    }
  }, [auth.status, auth.email, user])
  if (COGNITO_CONFIGURED) {
    if (auth.status === 'loading') return null
    if (auth.status === 'signedOut') return <Navigate to="/signin" replace state={{ returnTo: loc.pathname + loc.search }} />
    if (!user || !synced) return null
  } else if (!user) return <Navigate to="/signin" replace state={{ returnTo: loc.pathname + loc.search }} />
  if (!onboarding) {
    if (!home) return <Navigate to="/onboarding/city" replace />
    if (!bird) return <Navigate to="/onboarding/bird" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/onboarding/city" element={<Guard onboarding><HomeCity /></Guard>} />
      <Route path="/onboarding/bird" element={<Guard onboarding><ChooseBird /></Guard>} />
      <Route path="/fly/:tripId" element={<Guard><Focus /></Guard>} />
      <Route path="/landing/:storyId" element={<Guard><Landing /></Guard>} />
      <Route path="/trip/new" element={<Guard><TripComposer /></Guard>} />
      <Route path="/friends/add" element={<Guard><AddFriend /></Guard>} />
      <Route path="/friends" element={<Guard><Friends /></Guard>} />
      <Route path="/mailbox" element={<Guard><Mailbox /></Guard>} />
      <Route path="/mailbox/:letterId/opening" element={<Guard><EnvelopeOpening /></Guard>} />
      <Route path="/mailbox/:letterId" element={<Guard><OpenedLetter /></Guard>} />
      <Route path="/journal" element={<Guard><Journal /></Guard>} />
      <Route path="/journal/:storyId" element={<Guard><JournalDetail /></Guard>} />
      <Route path="/passport" element={<Guard><Passport /></Guard>} />
      <Route path="/passport/share" element={<Guard><ShareStamps /></Guard>} />
      <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
      <Route path="/settings/:section" element={<Guard><Settings /></Guard>} />
      <Route path="/home" element={<Guard><Dashboard /></Guard>} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  )
}
