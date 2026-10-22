/** SVG flag (flag-icons) so flags render on Windows, where emoji flags show as letters. */
export default function Flag({ cc, className = '' }: { cc: string; className?: string }) {
  return <span role="img" aria-label={cc.toUpperCase()} className={`fi fi-${cc.toLowerCase()} inline-block shrink-0 rounded-[2px] ${className}`} />
}
