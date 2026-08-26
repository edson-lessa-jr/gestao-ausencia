import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel,
  MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import { api, formatDate, post } from '../api'
import type { User } from '../types'

interface Team { id: string; name: string }
interface Holiday { id: string; date: string; name: string; duration: number; generates_admin_credit: number; team_id: string | null }
interface Balance { user_id: string; user_name: string; team_id: string | null; team_name: string; balance: number; reserved: number }
interface Entry { id: string; user_name: string; holiday_name?: string; holiday_date?: string; amount: number; entry_type: string; note?: string; created_by_name?: string; created_at: string }

const entryLabels: Record<string, string> = {
  AUTOMATIC_ABSENCE: 'Crédito automático por ausência', MANUAL_WORK: 'Crédito por trabalho no feriado',
  USAGE: 'Utilização', REVERSAL: 'Estorno', ADJUSTMENT: 'Ajuste',
}

export default function AdministrativeBalancePage({ user }: { user: User }) {
  const [balances, setBalances] = useState<Balance[]>([]); const [entries, setEntries] = useState<Entry[]>([])
  const [users, setUsers] = useState<User[]>([]); const [holidays, setHolidays] = useState<Holiday[]>([]); const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState(''); const [open, setOpen] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const [form, setForm] = useState({ user_id: '', holiday_id: '', amount: 1, note: '' })
  const load = useCallback(async () => {
    try {
      const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
      const result = await api<{ balances: Balance[]; entries: Entry[] }>(`/administrative-balances${query}`)
      setBalances(result.balances); setEntries(result.entries)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar os saldos.') }
  }, [teamId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (user.role === 'EMPLOYEE') return
    void Promise.all([api<{ users: User[] }>('/users'), api<{ holidays: Holiday[] }>('/holidays'), api<{ teams: Team[] }>('/teams')])
      .then(([u, h, t]) => { setUsers(u.users.filter((item) => item.active)); setHolidays(h.holidays.filter((item) => item.generates_admin_credit)); setTeams(t.teams) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar opções.'))
  }, [user.role])
  const availableUsers = useMemo(() => teamId ? users.filter((item) => item.team_id === teamId) : users, [teamId, users])
  const saveCredit = async () => {
    try { await post('/administrative-balances/credits', form); setOpen(false); setForm({ user_id: '', holiday_id: '', amount: 1, note: '' }); setSuccess('Crédito administrativo registrado.'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro ao registrar o crédito.') }
  }
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}>
      <Box><Typography variant="h4">Saldo administrativo</Typography><Typography color="text.secondary">Créditos de feriados separados do saldo oficial de férias.</Typography></Box>
      {user.role !== 'EMPLOYEE' && <Button variant="contained" startIcon={<AddRounded />} onClick={() => setOpen(true)}>Crédito eventual</Button>}
    </Stack>
    <Alert severity="info" sx={{ mb: 2 }}>Créditos automáticos são gerados quando uma ausência chega a “Aprovada no Quantum” e coincide com um feriado configurado. O supervisor também pode registrar trabalho eventual no feriado.</Alert>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}{success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
    {user.role === 'ADMIN' && <FormControl size="small" sx={{ minWidth: 220, mb: 2 }}><InputLabel>Equipe</InputLabel><Select label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}><MenuItem value="">Todas as equipes</MenuItem>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl>}
    <Paper variant="outlined" sx={{ mb: 2.5 }}><Table><TableHead><TableRow><TableCell>Colaborador</TableCell><TableCell>Equipe</TableCell><TableCell align="right">Disponível</TableCell><TableCell align="right">Reservado</TableCell><TableCell align="right">Projetado</TableCell></TableRow></TableHead><TableBody>{balances.map((balance) => <TableRow key={balance.user_id}><TableCell><Typography fontWeight={700}>{balance.user_name}</Typography></TableCell><TableCell>{balance.team_name}</TableCell><TableCell align="right">{Number(balance.balance).toLocaleString('pt-BR')} d</TableCell><TableCell align="right">{Number(balance.reserved).toLocaleString('pt-BR')} d</TableCell><TableCell align="right"><Typography fontWeight={750} color="primary.main">{(Number(balance.balance) - Number(balance.reserved)).toLocaleString('pt-BR')} d</Typography></TableCell></TableRow>)}{!balances.length && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>Nenhum saldo encontrado.</TableCell></TableRow>}</TableBody></Table></Paper>
    <Typography variant="h6" mb={1.5}>Extrato</Typography>
    <Paper variant="outlined"><Table size="small"><TableHead><TableRow><TableCell>Data</TableCell><TableCell>Colaborador</TableCell><TableCell>Origem</TableCell><TableCell>Referência</TableCell><TableCell>Responsável</TableCell><TableCell align="right">Movimento</TableCell></TableRow></TableHead><TableBody>{entries.map((entry) => <TableRow key={entry.id}><TableCell>{new Date(`${entry.created_at}Z`).toLocaleString('pt-BR')}</TableCell><TableCell>{entry.user_name}</TableCell><TableCell>{entryLabels[entry.entry_type] || entry.entry_type}</TableCell><TableCell>{entry.holiday_name ? `${entry.holiday_name} · ${formatDate(entry.holiday_date || '')}` : entry.note || '—'}</TableCell><TableCell>{entry.created_by_name || 'Sistema'}</TableCell><TableCell align="right"><Typography fontWeight={750} color={Number(entry.amount) >= 0 ? 'success.main' : 'error.main'}>{Number(entry.amount) > 0 ? '+' : ''}{Number(entry.amount).toLocaleString('pt-BR')} d</Typography></TableCell></TableRow>)}{!entries.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>Nenhum lançamento registrado.</TableCell></TableRow>}</TableBody></Table></Paper>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Registrar crédito eventual</DialogTitle><DialogContent><Stack spacing={2} mt={1}><FormControl><InputLabel>Colaborador</InputLabel><Select label="Colaborador" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>{availableUsers.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</Select></FormControl><FormControl><InputLabel>Feriado trabalhado</InputLabel><Select label="Feriado trabalhado" value={form.holiday_id} onChange={(e) => { const holiday = holidays.find((item) => item.id === e.target.value); setForm({ ...form, holiday_id: e.target.value, amount: Number(holiday?.duration || 1) }) }}>{holidays.map((holiday) => <MenuItem key={holiday.id} value={holiday.id}>{formatDate(holiday.date)} · {holiday.name}</MenuItem>)}</Select></FormControl><FormControl><InputLabel>Quantidade</InputLabel><Select label="Quantidade" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}><MenuItem value={.5}>0,5 dia</MenuItem><MenuItem value={1}>1 dia</MenuItem></Select></FormControl><TextField label="Justificativa" multiline minRows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="contained" disabled={!form.user_id || !form.holiday_id || !form.note.trim()} onClick={saveCredit}>Registrar crédito</Button></DialogActions></Dialog>
  </>
}
