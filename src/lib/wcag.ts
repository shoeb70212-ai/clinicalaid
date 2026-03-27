/**
 * WCAG AA contrast validation for white-label theming.
 * Primary colour is validated against white (#FFFFFF) before saving.
 * Rejects any colour with contrast ratio < 4.5:1.
 */

/** Returns true if the string looks like a valid 6-digit hex colour */
export function isValidHex(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
}

function luminance(hex: string): number {
  if (!isValidHex(hex)) throw new Error(`Invalid hex color: ${hex}`)
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1)
  const l2 = luminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker  = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Validates that a hex colour meets WCAG AA (4.5:1) against white.
 * Returns { valid: true } or { valid: false, ratio: number }
 */
export function validateWCAGAA(hex: string): { valid: boolean; ratio: number } {
  const ratio = contrastRatio(hex, '#FFFFFF')
  return { valid: ratio >= 4.5, ratio: Math.round(ratio * 100) / 100 }
}
