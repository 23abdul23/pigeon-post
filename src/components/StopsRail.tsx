/** Dotted rail of the stops in this run; dots fill as the bird passes them. */
export default function StopsRail({ stops, fromKm, routeKm, km }: { stops: number[]; fromKm: number; routeKm: number; km: number }) {
  const span = Math.max(1, routeKm - fromKm)
  const at = (k: number) => `${Math.min(100, Math.max(0, ((k - fromKm) / span) * 100))}%`
  return (
    <div className="relative mx-1.5 mt-3 h-3" role="img" aria-label={`${stops.filter((s) => km >= s).length} of ${stops.length} stops reached`}>
      <span className="absolute inset-x-0 top-1/2 border-t-2 border-dotted border-line" />
      {stops.map((s) => (
        <span key={s} style={{ left: at(s) }} className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${km >= s ? 'border-sage bg-sage' : 'border-line bg-white'}`} />
      ))}
      <span style={{ left: at(km) }} className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#d58767] shadow-sm" />
    </div>
  )
}
