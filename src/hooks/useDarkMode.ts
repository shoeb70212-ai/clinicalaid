import { useEffect, useState } from 'react'

const STORAGE_KEY = 'clinicflow-theme'

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) return stored === 'dark'
    } catch {}
    // Fall back to OS preference when no stored choice exists
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light') } catch {}
  }, [dark])

  const toggle = () => setDark((prev) => !prev)

  return { dark, toggle }
}
