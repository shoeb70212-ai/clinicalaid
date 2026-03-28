/**
 * Shared utility functions used across multiple portals.
 */

/**
 * Calculate age in whole years from a date-of-birth string.
 * Returns null if dob is null or invalid.
 */
export function calcAge(dob: string | null): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  if (isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}
