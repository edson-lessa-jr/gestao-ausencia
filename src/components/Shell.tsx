import { lazy, Suspense, useState } from 'react'
import {
  AppBar, Avatar, Box, CircularProgress, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Menu, MenuItem, Toolbar, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import DashboardOutlined from '@mui/icons-material/DashboardOutlined'
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import CelebrationOutlined from '@mui/icons-material/CelebrationOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import MenuRounded from '@mui/icons-material/MenuRounded'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import type { User } from '../types'
import { post } from '../api'

const DashboardPage = lazy(() => import('../pages/DashboardPage'))
const RequestsPage = lazy(() => import('../pages/RequestsPage'))
const HolidaysPage = lazy(() => import('../pages/HolidaysPage'))
const TeamPage = lazy(() => import('../pages/TeamPage'))
const CalendarPage = lazy(() => import('../pages/CalendarPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))

const drawerWidth = 236
type Page = 'dashboard' | 'requests' | 'calendar' | 'team' | 'holidays' | 'settings'
const items: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: 'Visão geral', icon: <DashboardOutlined /> },
  { id: 'requests', label: 'Solicitações', icon: <EventNoteOutlined /> },
  { id: 'calendar', label: 'Calendário', icon: <CalendarMonthOutlined /> },
  { id: 'team', label: 'Equipe', icon: <GroupsOutlined /> },
  { id: 'holidays', label: 'Feriados', icon: <CelebrationOutlined /> },
  { id: 'settings', label: 'Configurações', icon: <SettingsOutlined /> },
]

export default function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const theme = useTheme(); const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const content: Record<Page, React.ReactNode> = {
    dashboard: <DashboardPage user={user} />, requests: <RequestsPage user={user} />,
    calendar: <CalendarPage user={user} />, team: <TeamPage user={user} />,
    holidays: <HolidaysPage user={user} />, settings: <SettingsPage user={user} />,
  }
  const nav = <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#f1f8fb' }}>
    <Box sx={{ height: 80, display: 'flex', alignItems: 'center', px: 2.5 }}><Box component="img" src="/logo.png" alt="Símbolo" sx={{ width: 48, height: 48, objectFit: 'contain' }} /></Box>
    <List sx={{ px: 1.5, pt: 2 }}>
      {items.filter((item) => user.role !== 'EMPLOYEE' || !['team', 'holidays', 'settings'].includes(item.id)).map((item) => <ListItemButton key={item.id} selected={page === item.id} onClick={() => { setPage(item.id); setMobileOpen(false) }} sx={{ mb: .75, borderRadius: 1.5, '&.Mui-selected': { bgcolor: '#dceff7', color: 'primary.main' } }}>
        <ListItemIcon sx={{ minWidth: 42, color: 'inherit' }}>{item.icon}</ListItemIcon><ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: page === item.id ? 700 : 550 }} />
      </ListItemButton>)}
    </List>
    <Box sx={{ mt: 'auto', p: 2 }}><Typography variant="caption" color="text.secondary">Gestão de ausências</Typography></Box>
  </Box>

  return <Box sx={{ minHeight: '100vh', display: 'flex' }}>
    <Drawer variant={desktop ? 'permanent' : 'temporary'} open={desktop || mobileOpen} onClose={() => setMobileOpen(false)} sx={{ width: desktop ? drawerWidth : 0, '& .MuiDrawer-paper': { width: drawerWidth, borderRightColor: 'divider' } }}>{nav}</Drawer>
    <Box sx={{ flex: 1, minWidth: 0, ml: desktop ? 0 : 0 }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'rgba(255,255,255,.96)' }}>
        <Toolbar sx={{ minHeight: '64px !important', gap: 1.5 }}>
          {!desktop && <IconButton onClick={() => setMobileOpen(true)}><MenuRounded /></IconButton>}
          <Typography variant="h6" sx={{ flex: 1 }}>Gestão de ausências</Typography>
          <Divider orientation="vertical" flexItem sx={{ my: 1.5 }} />
          <Tooltip title="Opções da conta"><IconButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ p: .5 }}><Avatar sx={{ bgcolor: 'primary.main', width: 36, height: 36 }}>{user.name.slice(0, 1).toUpperCase()}</Avatar></IconButton></Tooltip>
          <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 130 }}><Typography variant="body2" fontWeight={700}>{user.name}</Typography><Typography variant="caption" color="text.secondary">{user.role === 'ADMIN' ? 'Administrador' : user.role === 'SUPERVISOR' ? 'Supervisor' : 'Colaborador'}</Typography></Box>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}><MenuItem onClick={async () => { await post('/auth/logout'); onLogout() }}><LogoutRounded fontSize="small" sx={{ mr: 1.5 }} /> Sair</MenuItem></Menu>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1500, mx: 'auto' }}><Suspense fallback={<Box sx={{ py: 10, textAlign: 'center' }}><CircularProgress /></Box>}>{content[page]}</Suspense></Box>
    </Box>
  </Box>
}
