import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { themeAtom } from '../lib/atoms'
import logoLight from '../assets/logo-light.png'
import logoDark from '../assets/logo-dark.png'

/**
 * Brand mark that follows the active theme: the light-background logo in
 * light mode, the dark-background one in dark mode. Resolves 'system' via the
 * OS preference so it tracks live when the theme is set to follow the system.
 */
export function Logo({ className }: { className?: string }): React.ReactElement {
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
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  return <img src={dark ? logoDark : logoLight} alt="" className={className} />
}
