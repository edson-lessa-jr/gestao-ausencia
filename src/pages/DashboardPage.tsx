import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Grid, Paper, Stack, Typography } from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import BeachAccessOutlined from '@mui/icons-material/BeachAccessOutlined'
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined'
import HourglassTopOutlined from '@mui/icons-material/HourglassTopOutlined'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, formatDate } from '../api'
import type { AbsenceRequest, User } from '../types'
import { absenceLabels } from '../types'
import StatusChip from '../components/StatusChip'
import RequestDrawer from '../components/RequestDrawer'

interface Dashboard { currentBalance: number; projectedYearEnd: number; pendingCount: number; projection: Array<{ month: string; confirmed: number; projected: number }>; quotas: { justified: { used: number; available: number; limit: number }; unjustified: { used: number; available: number; limit: number } } }

function Summary({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return <Paper variant="outlined" sx={{ p: 2.25, height: '100%', display: 'flex', alignItems: 'center', gap: 2 }}><Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: `${accent}18`, color: accent, display: 'grid', placeItems: 'center' }}>{icon}</Box><Box><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h5" color={accent}>{value}</Typography></Box></Paper>
}

export default function DashboardPage({ user }: { user: User }) {
  const [data, setData] = useState<Dashboard | null>(null); const [requests, setRequests] = useState<AbsenceRequest[]>([])
  const [drawer, setDrawer] = useState(false); const [error, setError] = useState('')
  const load = useCallback(async () => { try { const [d, r] = await Promise.all([api<Dashboard>('/dashboard'), api<{ requests: AbsenceRequest[] }>('/requests')]); setData(d); setRequests(r.requests) } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar.') } }, [])
  useEffect(() => { void load() }, [load])
  if (!data) return error ? <Alert severity="error">{error}</Alert> : <Box sx={{ py: 10, textAlign: 'center' }}><CircularProgress /></Box>
  const upcoming = requests.filter((r) => r.end_date >= new Date().toISOString().slice(0, 10) && ['REQUESTED', 'CONFIRMED'].includes(r.status)).slice(0, 5)
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}><Box><Typography variant="h4">Visão geral</Typography><Typography color="text.secondary">Saldos e ausências planejadas da sua equipe.</Typography></Box><Button variant="contained" startIcon={<AddRounded />} onClick={() => setDrawer(true)}>Solicitar ausência</Button></Stack>
    <Grid container spacing={2} mb={2.5}>
      <Grid size={{ xs: 12, sm: 4 }}><Summary icon={<BeachAccessOutlined />} label="Saldo atual de férias" value={`${data.currentBalance.toLocaleString('pt-BR')} dias`} accent="#0799b3" /></Grid>
      <Grid size={{ xs: 12, sm: 4 }}><Summary icon={<EventAvailableOutlined />} label="Saldo projetado em dezembro" value={`${data.projectedYearEnd.toLocaleString('pt-BR')} dias`} accent="#075e86" /></Grid>
      <Grid size={{ xs: 12, sm: 4 }}><Summary icon={<HourglassTopOutlined />} label="Ausências pendentes" value={`${data.pendingCount} ${data.pendingCount === 1 ? 'solicitação' : 'solicitações'}`} accent="#e4680b" /></Grid>
    </Grid>
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, lg: 8 }}><Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, height: 410 }}><Typography variant="h6">Projeção de saldo de férias</Typography><Typography variant="body2" color="text.secondary" mb={2}>Acúmulo mensal menos ausências solicitadas e confirmadas.</Typography><ResponsiveContainer width="100%" height={310}><AreaChart data={data.projection} margin={{ left: -20, right: 8 }}><defs><linearGradient id="confirmed" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#45c0cf" stopOpacity={.34} /><stop offset="100%" stopColor="#45c0cf" stopOpacity={.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8eef2" /><XAxis dataKey="month" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip formatter={(value) => `${Number(value).toLocaleString('pt-BR')} dias`} /><Legend /><Area name="Saldo confirmado" type="monotone" dataKey="confirmed" stroke="#075e86" fill="url(#confirmed)" strokeWidth={3} /><Area name="Saldo projetado" type="monotone" dataKey="projected" stroke="#ff8d33" fill="transparent" strokeWidth={2} strokeDasharray="6 5" /></AreaChart></ResponsiveContainer></Paper></Grid>
      <Grid size={{ xs: 12, lg: 4 }}><Paper variant="outlined" sx={{ p: 2.5, height: 410, overflow: 'auto' }}><Typography variant="h6" mb={2}>Próximas ausências</Typography><Stack spacing={2}>{upcoming.length ? upcoming.map((r) => <Box key={r.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}><Box sx={{ width: 8, height: 42, borderRadius: 4, bgcolor: r.status === 'CONFIRMED' ? 'secondary.main' : 'warning.main' }} /><Box sx={{ minWidth: 0, flex: 1 }}><Typography variant="body2" fontWeight={700} noWrap>{r.user_name}</Typography><Typography variant="caption" color="text.secondary">{absenceLabels[r.type]} · {formatDate(r.start_date)}</Typography></Box><StatusChip status={r.status} /></Box>) : <Typography color="text.secondary">Nenhuma ausência futura.</Typography>}</Stack></Paper></Grid>
      <Grid size={{ xs: 12 }}><Paper variant="outlined" sx={{ p: 2.5 }}><Typography variant="h6">Limites anuais</Typography><Grid container spacing={2} mt={.5}><Grid size={{ xs: 12, sm: 6 }}><Alert severity="info">Ausências justificadas: <strong>{data.quotas.justified.available} de {data.quotas.justified.limit} dias disponíveis</strong></Alert></Grid><Grid size={{ xs: 12, sm: 6 }}><Alert severity="warning">Ausências não justificadas: <strong>{data.quotas.unjustified.available} de {data.quotas.unjustified.limit} dias disponíveis</strong></Alert></Grid></Grid></Paper></Grid>
    </Grid>
    <RequestDrawer open={drawer} onClose={() => setDrawer(false)} user={user} onSaved={() => void load()} />
  </>
}
