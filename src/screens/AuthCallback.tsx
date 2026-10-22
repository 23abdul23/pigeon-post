import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { completeSignIn } from '../lib/auth'

export default function AuthCallback() {
  const nav = useNavigate()
  const ran = useRef(false) // StrictMode double-effect would redeem the one-time code twice
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    completeSignIn().then((to) => nav(to, { replace: true }), () => nav('/signin', { replace: true }))
  }, [nav])
  return <p className="p-6 text-center text-ink-2">Signing you in…</p>
}
