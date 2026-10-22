import { useEffect, useState } from 'react'
import type { BirdSpecies } from '../lib/birds'

/** Still preview of a bird, rendered once and cached. */
export default function BirdThumb({ bird, className = '' }: { bird: BirdSpecies; className?: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    import('../lib/birdModel').then((m) => m.birdThumb(bird)).then((s) => live && setSrc(s))
    return () => {
      live = false
    }
  }, [bird])
  return src ? <img src={src} alt={bird.name} className={className} /> : <div className={className} />
}
