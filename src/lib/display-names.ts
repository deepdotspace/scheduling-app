/** True when this is the platform "no real display name" sentinel (case-insensitive). */
export function isAnonymousPlaceholderName(name: string | null | undefined): boolean {
  if (name == null) return false
  return name.trim().toLowerCase() === 'anonymous'
}
