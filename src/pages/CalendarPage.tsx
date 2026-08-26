import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { api, formatDate } from '../api'
import type { AbsenceType, RequestStatus, User } from '../types'
import { absenceLabels, statusLabels } from '../types'

interface Team { id: string; name: string }
interface CalendarAbsence { id: string; type: AbsenceType; start_date: string; end_date: string; status: RequestStatus; business_days: number; calendar_days: number }
interface CalendarMonth { month: number; confirmedBalance: number; projectedBalance: number; absences: CalendarAbsence[] }
interface CalendarMember { user: User; months: CalendarMonth[] }
const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export default function CalendarPage({ user }: { user: User }) {
  const [year, setYear] = useState(new Date().getFullYear()); const [teamId, setTeamId] = useState('')
  const [teams, setTeams] = useState<Team[]>([]); const [calendar, setCalendar] = useState<CalendarMember[]>([]); const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ year: String(year) }); if (teamId) query.set('teamId', teamId)
      const result = await api<{ calendar: CalendarMember[] }>(`/calendar?${query}`); setCalendar(result.calendar)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar o calendário.') }
  }, [teamId, year])
  useEffect(() => { if (user.role === 'ADMIN') void api<{ teams: Team[] }>('/teams').then((result) => setTeams(result.teams)) }, [user.role])
  useEffect(() => { void load() }, [load])
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}>
      <Box><Typography variant="h4">Calendário anual</Typography><Typography color="text.secondary">Saldos mensais e ausências da equipe em todas as etapas válidas do fluxo.</Typography></Box>
      <Stack direction="row" spacing={1.5}><FormControl size="small" sx={{ minWidth: 120 }}><InputLabel>Ano</InputLabel><Select label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 3 + index).map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</Select></FormControl>{user.role === 'ADMIN' && <FormControl size="small" sx={{ minWidth: 190 }}><InputLabel>Equipe</InputLabel><Select label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}><MenuItem value="">Todas as equipes</MenuItem>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl>}</Stack>
    </Stack>
    <Alert severity="info" sx={{ mb: 2 }}>O saldo principal é projetado. O saldo oficial considera somente solicitações aprovadas no Quantum.</Alert>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 'calc(100vh - 245px)' }}><Table stickyHeader size="small" sx={{ minWidth: 2200 }}>
      <TableHead><TableRow><TableCell sx={{ position: 'sticky', left: 0, zIndex: 4, minWidth: 220 }}>Colaborador</TableCell>{months.map((month) => <TableCell key={month} align="center" sx={{ minWidth: 160 }}>{month}</TableCell>)}</TableRow></TableHead>
      <TableBody>{calendar.map((member) => <TableRow key={member.user.id} sx={{ verticalAlign: 'top' }}><TableCell sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}><Typography fontWeight={750}>{member.user.name}</Typography><Typography variant="caption" color="text.secondary">{member.user.team_name}</Typography>{!member.user.active && <Chip size="small" label="Inativo" sx={{ mt: 1 }} />}</TableCell>{member.months.map((month) => <TableCell key={month.month} sx={{ p: 1.25 }}><Typography fontWeight={800} color="primary.main">{month.projectedBalance.toLocaleString('pt-BR')} d</Typography>{month.projectedBalance !== month.confirmedBalance && <Typography variant="caption" color="text.secondary">Oficial: {month.confirmedBalance.toLocaleString('pt-BR')} d</Typography>}<Stack spacing={.75} mt={1}>{month.absences.map((absence) => <Box key={absence.id} sx={{ borderLeft: '3px solid', borderColor: absence.status === 'QUANTUM_APPROVED' ? 'success.main' : 'warning.main', pl: .75 }}><Typography variant="caption" fontWeight={700} display="block">{absenceLabels[absence.type]}</Typography><Typography variant="caption" color="text.secondary" display="block">{formatDate(absence.start_date).slice(0, 5)}–{formatDate(absence.end_date).slice(0, 5)}</Typography><Typography variant="caption" color={absence.status === 'QUANTUM_APPROVED' ? 'success.main' : 'warning.main'}>{statusLabels[absence.status]}</Typography></Box>)}</Stack></TableCell>)}</TableRow>)}{!calendar.length && <TableRow><TableCell colSpan={13} align="center" sx={{ py: 8, color: 'text.secondary' }}>Nenhum colaborador encontrado.</TableCell></TableRow>}</TableBody>
    </Table></TableContainer>
  </>
}
