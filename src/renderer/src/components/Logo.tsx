import { useIsDark } from '../lib/use-dark'
import logoLight from '../assets/logo-light.png'
import logoDark from '../assets/logo-dark.png'

/**
 * Brand mark that follows the active theme: the light-background logo in
 * light mode, the dark-background one in dark mode.
 */
export function Logo({ className }: { className?: string }): React.ReactElement {
  const dark = useIsDark()
  return <img src={dark ? logoDark : logoLight} alt="" className={className} />
}
