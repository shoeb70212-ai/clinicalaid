import { useEffect } from 'react'
import type { Clinic } from '../types'

export function useClinicTheme(clinic: Clinic | null) {
  useEffect(() => {
    if (clinic?.primary_color) {
      document.documentElement.style.setProperty('--color-clinic', clinic.primary_color)
    }
  }, [clinic?.primary_color])
}