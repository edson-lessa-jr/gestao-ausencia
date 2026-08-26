import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import { api, formatDate, patch } from '../api'
import type { AbsenceRequest, RequestStatus, User } from '../types'
import { absenceLabels, statusLabels } from '../types'
import StatusChip from '../components/StatusChip'
import RequestDrawer from '../components/RequestDrawer'

export default function RequestsPage({ user }: { user: User }) {
  const [rows, setRows] = useState<AbsenceRequest[]>([]); const [filter, setFilter] = useState('ALL'); const [error, setError] = useState(''); const [drawer, setDrawer] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null); const [cancelNote, setCancelNote] = useState('')
  const load = useCallback(async () => { try { setRows((await api<{ requests: AbsenceRequest[] }>('/requests')).requests) } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar.') } }, [])
  useEffect(() => { void load() }, [load])
  const changeStatus = async (id: string, status: RequestStatus, note?: string) => { try { await patch(`/requests/${id}/status`, { status, note }); setCancelId(null); setCancelNote(''); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao atualizar.') } }
  const visible = filter === 'ALL' ? rows : rows.filter((row) => row.status === filter)
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}><Box><Typography variant="h4">Solicitações</Typography><Typography color="text.secondary">Acompanhe a aprovação interna, o registro e a aprovação final no Quantum.</Typography></Box><Button variant="contained" startIcon={<AddRounded />} onClick={() => setDrawer(true)}>Nova solicitação</Button></Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Paper variant="outlined">
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end' }}><FormControl size="small" sx={{ minWidth: 220 }}><InputLabel>Status</InputLabel><Select label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}><MenuItem value="ALL">Todos os status</MenuItem>{Object.entries(statusLabels).map(([value, label]) => <MenuItem value={value} key={value}>{label}</MenuItem>)}</Select></FormControl></Box>
      <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Colaborador</TableCell><TableCell>Tipo</TableCell><TableCell>Período</TableCell><TableCell align="center">Dias úteis</TableCell><TableCell align="center">Dias corridos</TableCell><TableCell>Status</TableCell><TableCell align="right">Ações</TableCell></TableRow></TableHead><TableBody>
        {visible.map((row) => { const canCancel = ['REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED'].includes(row.status) && (row.user_id === user.id || user.role === 'SUPERVISOR'); return <TableRow key={row.id} hover><TableCell><Typography variant="body2" fontWeight={700}>{row.user_name}</Typography><Typography variant="caption" color="text.secondary">{row.team_name}</Typography></TableCell><TableCell>{absenceLabels[row.type]}</TableCell><TableCell>{formatDate(row.start_date)} — {formatDate(row.end_date)}</TableCell><TableCell align="center">{row.business_days}</TableCell><TableCell align="center">{row.calendar_days}</TableCell><TableCell><StatusChip status={row.status} /></TableCell><TableCell align="right"><Stack direction="row" justifyContent="flex-end" spacing={1} flexWrap="wrap" useFlexGap>{canCancel && <Button size="small" color="warning" onClick={() => setCancelId(row.id)}>Cancelar</Button>}{user.role === 'SUPERVISOR' && row.status === 'REQUESTED' && <><Button size="small" color="error" onClick={() => void changeStatus(row.id, 'REJECTED')}>Rejeitar</Button><Button size="small" variant="contained" onClick={() => void changeStatus(row.id, 'APPROVED')}>Aprovar</Button></>}{row.status === 'APPROVED' && (row.user_id === user.id || user.role === 'SUPERVISOR') && <Button size="small" variant="contained" color="secondary" onClick={() => void changeStatus(row.id, 'QUANTUM_REGISTERED')}>Registrar no Quantum</Button>}{user.role === 'SUPERVISOR' && row.status === 'QUANTUM_REGISTERED' && <Button size="small" variant="contained" color="success" onClick={() => void changeStatus(row.id, 'QUANTUM_APPROVED')}>Aprovar no Quantum</Button>}</Stack></TableCell></TableRow> })}
        {!visible.length && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 8, color: 'text.secondary' }}>Nenhuma solicitação encontrada.</TableCell></TableRow>}
      </TableBody></Table></TableContainer>
    </Paper>
    <RequestDrawer open={drawer} onClose={() => setDrawer(false)} user={user} onSaved={() => void load()} />
    <Dialog open={Boolean(cancelId)} onClose={() => setCancelId(null)} fullWidth maxWidth="sm"><DialogTitle>Cancelar solicitação</DialogTitle><DialogContent><TextField autoFocus fullWidth multiline minRows={3} sx={{ mt: 1 }} label="Justificativa do cancelamento" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} /></DialogContent><DialogActions><Button onClick={() => setCancelId(null)}>Voltar</Button><Button color="warning" variant="contained" disabled={!cancelNote.trim()} onClick={() => cancelId && void changeStatus(cancelId, 'CANCELLED', cancelNote)}>Confirmar cancelamento</Button></DialogActions></Dialog>
  </>
}
