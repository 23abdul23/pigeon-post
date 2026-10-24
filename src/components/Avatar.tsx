import { useState } from 'react'
import { useStore } from '../lib/store'

/** The signed-in user's Google picture, or a sage circle with their initial when there is none or it fails to load. */
export default function Avatar({ className = '' }: { className?: string }) {
  const user = useStore((s) => s.user)
  const [failed, setFailed] = useState<string>()
  if (user?.picture && failed !== user.picture) {
    return <img src={user.picture} referrerPolicy="no-referrer" alt="" onError={() => setFailed(user.picture)} className={`rounded-full object-cover ${className}`} />
  }
  return (
    <span aria-hidden="true" className={`flex items-center justify-center rounded-full bg-sage font-semibold uppercase text-cream ${className}`}>
      {user?.name?.trim().charAt(0) || '?'}
    </span>
  )
}
