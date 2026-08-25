import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Paper, Stack, Typography } from '@mui/material'
import { api, formatDate } from '../api'
import type { AbsenceRequest, User } from '../types'
import { absenceLabels } from '../types'
import StatusChip from '../components/StatusChip'

export default function CalendarPage({ user: _user }: { user: User }) {
  const [rows, setRows] = useState<AbsenceRequest[]>([]); const [error, setError] = useState('')
  useEffect(() => { void api<{ requests: AbsenceRequest[] }>('/requests').then((r) => setRows(r.requests)).catch((e: Error) => setError(e.message)) }, [])
  const grouped = useMemo(() => rows.filter((r) => ['REQUESTED', 'CONFIRMED'].includes(r.status)).sort((a, b) => a.start_date.localeCompare(b.start_date)).reduce<Record<string, AbsenceRequest[]>>((acc, row) => { const key = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${row.start_date}T12:00:00Z`)); (acc[key] ||= []).push(row); return acc }, {}), [rows])
  return <><Box mb={3}><Typography variant="h4">Calendário</Typography><Typography color="text.secondary">Linha do tempo das ausências solicitadas e confirmadas.</Typography></Box>{error && <Alert severity="error">{error}</Alert>}<Stack spacing={2}>{Object.entries(grouped).map(([month, requests]) => <Paper variant="outlined" key={month} sx={{ overflow: 'hidden' }}><Box sx={{ px: 2.5, py: 1.5, bgcolor: '#f1f8fb', borderBottom: '1px solid', borderColor: 'divider' }}><Typography fontWeight={750} sx={{ textTransform: 'capitalize' }}>{month}</Typography></Box>{requests.map((row) => <Box key={row.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr auto' }, gap: 2, px: 2.5, py: 2, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}><Typography variant="body2" color="text.secondary">{formatDate(row.start_date)} — {formatDate(row.end_date)}</Typography><Box><Typography fontWeight={700}>{row.user_name}</Typography><Typography variant="caption" color="text.secondary">{absenceLabels[row.type]} · {row.business_days} dias úteis</Typography></Box><StatusChip status={row.status} /></Box>)}</Paper>)}{!Object.keys(grouped).length && <Paper variant="outlined" sx={{ p: 8, textAlign: 'center', color: 'text.secondary' }}>Nenhuma ausência planejada.</Paper>}</Stack></>
}
