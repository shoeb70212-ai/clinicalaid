import { describe, it, expect } from 'vitest'
import { checkInteractions, SEVERITY_COLOR, SEVERITY_LABEL } from '../drugInteractions'

describe('drugInteractions', () => {
  describe('dangerous combinations', () => {
    it('flags warfarin + aspirin as major interaction', () => {
      const result = checkInteractions(['Warfarin', 'Aspirin'])
      expect(result.some((r) => r.severity === 'major')).toBe(true)
      const interaction = result.find((r) => r.drugA === 'Warfarin' && r.drugB === 'Aspirin')
      expect(interaction?.description).toContain('bleeding risk')
    })

    it('flags selegiline + tramadol as contraindicated', () => {
      const result = checkInteractions(['Selegiline', 'Tramadol'])
      expect(result.some((r) => r.severity === 'contraindicated')).toBe(true)
    })

    it('flags sildenafil + nitrates as contraindicated', () => {
      const result = checkInteractions(['Sildenafil', 'Isosorbide'])
      expect(result.some((r) => r.severity === 'contraindicated')).toBe(true)
    })

    it('flags azithromycin + domperidone as contraindicated', () => {
      const result = checkInteractions(['Azithromycin', 'Domperidone'])
      expect(result.some((r) => r.severity === 'contraindicated')).toBe(true)
    })

    it('flags simvastatin + clarithromycin as contraindicated', () => {
      const result = checkInteractions(['Simvastatin', 'Clarithromycin'])
      expect(result.some((r) => r.severity === 'contraindicated')).toBe(true)
    })

    it('flags dual ACE/ARB as contraindicated', () => {
      const result = checkInteractions(['Ramipril', 'Losartan'])
      expect(result.some((r) => r.severity === 'contraindicated')).toBe(true)
    })

    it('flags metformin + alcohol as major', () => {
      const result = checkInteractions(['Metformin', 'Alcohol'])
      expect(result.some((r) => r.severity === 'major')).toBe(true)
    })
  })

  describe('safe combinations', () => {
    it('returns empty for single drug', () => {
      const result = checkInteractions(['Paracetamol'])
      expect(result).toHaveLength(0)
    })

    it('returns empty for paracetamol + omeprazole', () => {
      const result = checkInteractions(['Paracetamol', 'Omeprazole'])
      expect(result).toHaveLength(0)
    })

    it('returns empty for amoxicillin + paracetamol', () => {
      const result = checkInteractions(['Amoxicillin', 'Paracetamol'])
      expect(result).toHaveLength(0)
    })
  })

  describe('order independence', () => {
    it('detects interaction regardless of order (A,B)', () => {
      const result1 = checkInteractions(['Warfarin', 'Aspirin'])
      expect(result1.length).toBeGreaterThan(0)
    })

    it('detects interaction regardless of order (B,A)', () => {
      const result2 = checkInteractions(['Aspirin', 'Warfarin'])
      expect(result2.length).toBeGreaterThan(0)
    })
  })

  describe('severity sorting', () => {
    it('sorts by severity (contraindicated first)', () => {
      const result = checkInteractions(['Tramadol', 'Sertraline', 'Warfarin', 'Aspirin'])
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].severity).toBe('major')
    })
  })

  describe('severity helpers', () => {
    it('provides correct colors for each severity', () => {
      expect(SEVERITY_COLOR.contraindicated.bg).toBe('#fef2f2')
      expect(SEVERITY_COLOR.major.bg).toBe('#fff7ed')
      expect(SEVERITY_COLOR.moderate.bg).toBe('#fffbeb')
    })

    it('provides correct labels for each severity', () => {
      expect(SEVERITY_LABEL.contraindicated).toBe('Contraindicated')
      expect(SEVERITY_LABEL.major).toBe('Major interaction')
      expect(SEVERITY_LABEL.moderate).toBe('Moderate interaction')
    })
  })

  describe('fragment matching', () => {
    it('matches drug with dosage', () => {
      const result = checkInteractions(['WARFARIN 5MG', 'Aspirin'])
      expect(result.some((r) => r.severity === 'major')).toBe(true)
    })

    it('matches partial drug names', () => {
      const result = checkInteractions(['Ciprofloxacin', 'Theophylline'])
      expect(result.some((r) => r.severity === 'major')).toBe(true)
    })
  })
})