import { useCallback, useEffect, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { api } from './api'
import type { User } from './types'
import LoginPage from './pages/LoginPage'
import Shell from './components/Shell'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const status = await api<{ needsSetup: boolean }>('/status')
      setNeedsSetup(status.needsSetup)
      if (!status.needsSetup) {
        const me = await api<{ user: User }>('/me')
        setUser(me.user)
      }
    } catch { setUser(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  if (loading) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>
  if (!user) return <LoginPage needsSetup={needsSetup} onAuthenticated={refresh} />
  return <Shell user={user} onLogout={() => { setUser(null); void refresh() }} />
}
