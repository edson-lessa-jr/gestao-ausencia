import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import { api, formatDate, patch } from '../api'
import type { AbsenceRequest, RequestStatus, User } from '../types'
import { absenceLabels } from '../types'
import StatusChip from '../components/StatusChip'
import RequestDrawer from '../components/RequestDrawer'

export default function RequestsPage({ user }: { user: User }) {
  const [rows, setRows] = useState<AbsenceRequest[]>([]); const [filter, setFilter] = useState('ALL'); const [error, setError] = useState(''); const [drawer, setDrawer] = useState(false)
  const load = useCallback(async () => { try { setRows((await api<{ requests: AbsenceRequest[] }>('/requests')).requests) } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar.') } }, [])
  useEffect(() => { void load() }, [load])
  const changeStatus = async (id: string, status: RequestStatus) => { try { await patch(`/requests/${id}/status`, { status }); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao atualizar.') } }
  const visible = filter === 'ALL' ? rows : rows.filter((row) => row.status === filter)
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}><Box><Typography variant="h4">Solicitações</Typography><Typography color="text.secondary">Acompanhe, confirme ou rejeite ausências.</Typography></Box><Button variant="contained" startIcon={<AddRounded />} onClick={() => setDrawer(true)}>Nova solicitação</Button></Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Paper variant="outlined">
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end' }}><FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>Status</InputLabel><Select label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}><MenuItem value="ALL">Todos os status</MenuItem><MenuItem value="REQUESTED">Solicitadas</MenuItem><MenuItem value="CONFIRMED">Confirmadas</MenuItem><MenuItem value="REJECTED">Rejeitadas</MenuItem><MenuItem value="CANCELLED">Canceladas</MenuItem></Select></FormControl></Box>
      <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Colaborador</TableCell><TableCell>Tipo</TableCell><TableCell>Período</TableCell><TableCell align="center">Dias úteis</TableCell><TableCell align="center">Dias corridos</TableCell><TableCell>Status</TableCell>{user.role !== 'EMPLOYEE' && <TableCell align="right">Decisão</TableCell>}</TableRow></TableHead><TableBody>
        {visible.map((row) => <TableRow key={row.id} hover><TableCell><Typography variant="body2" fontWeight={700}>{row.user_name}</Typography><Typography variant="caption" color="text.secondary">{row.team_name}</Typography></TableCell><TableCell>{absenceLabels[row.type]}</TableCell><TableCell>{formatDate(row.start_date)} — {formatDate(row.end_date)}</TableCell><TableCell align="center">{row.business_days}</TableCell><TableCell align="center">{row.calendar_days}</TableCell><TableCell><StatusChip status={row.status} /></TableCell>{user.role !== 'EMPLOYEE' && <TableCell align="right">{row.status === 'REQUESTED' && <Stack direction="row" justifyContent="flex-end" spacing={1}><Button size="small" color="error" onClick={() => void changeStatus(row.id, 'REJECTED')}>Rejeitar</Button><Button size="small" variant="contained" color="success" onClick={() => void changeStatus(row.id, 'CONFIRMED')}>Confirmar</Button></Stack>}</TableCell>}</TableRow>)}
        {!visible.length && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 8, color: 'text.secondary' }}>Nenhuma solicitação encontrada.</TableCell></TableRow>}
      </TableBody></Table></TableContainer>
    </Paper>
    <RequestDrawer open={drawer} onClose={() => setDrawer(false)} user={user} onSaved={() => void load()} />
  </>
}
