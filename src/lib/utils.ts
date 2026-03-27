/**
 * Shared utility functions used across multiple portals.
 */

/**
 * Calculate age in whole years from a date-of-birth string.
 * Returns null if dob is null or invalid.
 */
export function calcAge(dob: string | null): number | null {
  if (!dob) return null
  const ms = Date.now() - new Date(dob).getTime()
  if (isNaN(ms)) return null
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000))
}
