import { describe, it, expect } from 'vitest'
import { isValidHex, contrastRatio, validateWCAGAA } from '../wcag'

describe('wcag contrast', () => {
  describe('isValidHex', () => {
    it('returns true for valid hex colors', () => {
      expect(isValidHex('#000000')).toBe(true)
      expect(isValidHex('#FFFFFF')).toBe(true)
      expect(isValidHex('#ff0000')).toBe(true)
      expect(isValidHex('#123456')).toBe(true)
    })

    it('returns false for invalid hex colors', () => {
      expect(isValidHex('000000')).toBe(false)
      expect(isValidHex('#0000')).toBe(false)
      expect(isValidHex('#gggggg')).toBe(false)
      expect(isValidHex('')).toBe(false)
      expect(isValidHex('#FF')).toBe(false)
    })

    it('handles lowercase', () => {
      expect(isValidHex('#abcdef')).toBe(true)
      expect(isValidHex('#ABCDEF')).toBe(true)
    })
  })

  describe('contrastRatio', () => {
    it('returns high contrast for black on white', () => {
      expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    })

    it('returns high contrast for white on black', () => {
      expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    })

    it('returns 1 for identical colors', () => {
      expect(contrastRatio('#ff0000', '#ff0000')).toBeCloseTo(1, 1)
      expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 1)
    })

    it('returns correct ratio for gray on white', () => {
      const ratio = contrastRatio('#808080', '#ffffff')
      expect(ratio).toBeGreaterThan(3)
      expect(ratio).toBeLessThan(7)
    })

    it('returns correct ratio for dark gray on white', () => {
      const ratio = contrastRatio('#333333', '#ffffff')
      expect(ratio).toBeGreaterThan(8)
      expect(ratio).toBeLessThan(13)
    })
  })

  describe('validateWCAGAA', () => {
    it('returns valid true for black on white', () => {
      const result = validateWCAGAA('#000000')
      expect(result.valid).toBe(true)
      expect(result.ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('returns valid true for dark blue on white', () => {
      const result = validateWCAGAA('#1a237e')
      expect(result.valid).toBe(true)
      expect(result.ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('returns valid false for light gray on white', () => {
      const result = validateWCAGAA('#cccccc')
      expect(result.valid).toBe(false)
      expect(result.ratio).toBeLessThan(4.5)
    })

    it('returns valid false for white on white', () => {
      const result = validateWCAGAA('#ffffff')
      expect(result.valid).toBe(false)
      expect(result.ratio).toBeCloseTo(1, 0)
    })

    it('returns valid for typical primary colors used in clinics', () => {
      expect(validateWCAGAA('#2563eb').valid).toBe(true)
      expect(validateWCAGAA('#dc2626').valid).toBe(true)
      expect(validateWCAGAA('#059669').valid).toBe(false)
      expect(validateWCAGAA('#047857').valid).toBe(true)
    })

    it('rejects colors that fail WCAG AA', () => {
      expect(validateWCAGAA('#e5e5e5').valid).toBe(false)
      expect(validateWCAGAA('#f87171').valid).toBe(false)
    })
  })
})