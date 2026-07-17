import { createTRPCReact } from '@trpc/react-query'
import { ipcLink } from 'trpc-electron/renderer'
import superjson from 'superjson'
import type { AppRouter } from '../../../main/lib/trpc/routers'

export const trpc = createTRPCReact<AppRouter>()

export function createTrpcClient() {
  return trpc.createClient({
    links: [ipcLink({ transformer: superjson })]
  })
}
