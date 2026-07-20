import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTrpcClient, trpc } from './lib/trpc'
import { ConfirmProvider } from './components/ConfirmDialog'
import { TooltipProvider } from './components/ui/tooltip'
import App from './App'
import './styles/globals.css'

function Root(): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } }
      })
  )
  const [trpcClient] = useState(() => createTrpcClient())

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <TooltipProvider delayDuration={400} skipDelayDuration={300}>
            <App />
          </TooltipProvider>
        </ConfirmProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
