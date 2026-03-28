import { useEffect } from 'react'

type ShortcutMap = Record<string, { handler: () => void; description: string }>

/**
 * Registers keyboard shortcuts for a component.
 * Key format: 'ctrl+s', 'ctrl+d', 'escape', 'shift+enter', etc.
 * Automatically calls e.preventDefault() when a shortcut matches.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when typing in inputs/textareas (unless Escape)
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
      if (isInput && e.key !== 'Escape') return

      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('ctrl')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')
      parts.push(e.key.toLowerCase())
      const key = parts.join('+')

      const shortcut = shortcuts[key]
      if (shortcut) {
        e.preventDefault()
        shortcut.handler()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}
