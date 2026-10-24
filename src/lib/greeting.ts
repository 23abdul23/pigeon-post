/** Greeting for the device's local clock: `getHours()` is local time, so it follows the user's timezone. */
export function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 22) return 'Good evening'
  return 'Good night' // 22:00 to 04:59, so a midnight session is no longer "Good morning"
}
