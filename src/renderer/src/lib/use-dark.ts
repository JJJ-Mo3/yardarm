import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { themeAtom } from './atoms'

/**
 * Effective darkness of the active theme. Resolves 'system' via the OS
 * preference and tracks it live while the theme follows the system.
 */
export function useIsDark(): boolean {
  const theme = useAtomValue(themeAtom)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    if (theme !== 'system') return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [theme])
  return theme === 'dark' || (theme === 'system' && systemDark)
}
