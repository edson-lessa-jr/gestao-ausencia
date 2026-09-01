import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Divider, Drawer, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import { api, post } from '../api'
import type { AbsenceType, User } from '../types'
import { absenceLabels } from '../types'

export default function RequestDrawer({ open, onClose, user, onSaved }: { open: boolean; onClose: () => void; user: User; onSaved: () => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState({ user_id: user.id, type: 'VACATION' as AbsenceType, start_date: '', end_date: '', reason: '', administrative_days: 1 })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && user.role !== 'EMPLOYEE') void api<{ users: User[] }>('/users').then((r) => {
    const available = r.users.filter((member) => member.active && member.role !== 'ADMIN' && (user.role !== 'SUPERVISOR' || member.team_id === user.team_id))
    setUsers(available)
    setForm((current) => ({ ...current, user_id: available.some((member) => member.id === current.user_id) ? current.user_id : available[0]?.id || '' }))
  }) }, [open, user.role, user.team_id])
  const selected = useMemo(() => users.find((u) => u.id === form.user_id) || user, [users, user, form.user_id])
  const estimated = useMemo(() => {
    if (!form.start_date || !form.end_date || form.end_date < form.start_date) return null
    let business = 0; const cursor = new Date(`${form.start_date}T12:00:00Z`); const end = new Date(`${form.end_date}T12:00:00Z`)
    while (cursor <= end) { if (![0, 6].includes(cursor.getUTCDay())) business++; cursor.setUTCDate(cursor.getUTCDate() + 1) }
    const calendar = Math.floor((end.getTime() - new Date(`${form.start_date}T12:00:00Z`).getTime()) / 86400000) + 1
    return { business, calendar, debit: business * Number(selected.vacation_debit_factor) }
  }, [form.start_date, form.end_date, selected.vacation_debit_factor])
  const save = async () => {
    setBusy(true); setError('')
    try { await post('/requests', form); onSaved(); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao salvar.') } finally { setBusy(false) }
  }
  return <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 470 } } }}>
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="h5">Solicitar ausência</Typography><Typography color="text.secondary" mt={.5} mb={3}>O saldo é recalculado conforme o período informado.</Typography>
      <Stack spacing={2.25}>
        {error && <Alert severity="error">{error}</Alert>}
        <Alert icon={<InfoOutlined />} severity="info">Férias e ausências comuns contam dias úteis, descontando fins de semana e feriados cadastrados.</Alert>
        {user.role !== 'EMPLOYEE' && <FormControl fullWidth><InputLabel>Colaborador</InputLabel><Select label="Colaborador" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>{users.map((u) => <MenuItem key={u.id} value={u.id}>{u.name} · {u.team_name}</MenuItem>)}</Select></FormControl>}
        {user.role !== 'EMPLOYEE' && !users.length && <Alert severity="info">Cadastre uma equipe e seus colaboradores antes de registrar uma ausência.</Alert>}
        <FormControl fullWidth><InputLabel>Tipo de ausência</InputLabel><Select label="Tipo de ausência" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AbsenceType, administrative_days: 1 })}>{Object.entries(absenceLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField fullWidth label="Data de início" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /><TextField fullWidth label="Data de término" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Stack>
        {form.type === 'ADMINISTRATIVE' && estimated && <FormControl fullWidth><InputLabel>Saldo administrativo a utilizar</InputLabel><Select label="Saldo administrativo a utilizar" value={form.administrative_days} onChange={(e) => setForm({ ...form, administrative_days: Number(e.target.value) })}>{Array.from({ length: Math.max(1, estimated.business * 2) }, (_, index) => (index + 1) / 2).map((value) => <MenuItem key={value} value={value}>{value.toLocaleString('pt-BR')} dia(s)</MenuItem>)}</Select></FormControl>}
        <Alert severity="warning">Toda nova ausência será registrada como solicitada e aguardará decisão do supervisor.</Alert>
        <TextField label="Observação" multiline minRows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        {estimated && <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Período calculado</Typography><Typography fontWeight={750}>{form.type === 'PATERNITY' || form.type === 'MATERNITY' ? `${estimated.calendar} dias corridos` : form.type === 'ADMINISTRATIVE' ? `${form.administrative_days.toLocaleString('pt-BR')} dia(s) de saldo administrativo` : `${estimated.business} dias úteis`}</Typography></Box>
          {form.type === 'VACATION' && <><Divider /><Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Desconto estimado no saldo</Typography><Typography fontWeight={750}>{estimated.debit.toLocaleString('pt-BR')} dias</Typography><Typography variant="caption" color="text.secondary">Fator individual: {selected.vacation_debit_factor}</Typography></Box></>}
        </Box>}
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 'auto', pt: 3 }}><Button fullWidth variant="outlined" onClick={onClose}>Cancelar</Button><Button fullWidth variant="contained" onClick={save} disabled={busy || !form.start_date || !form.end_date || (user.role !== 'EMPLOYEE' && !form.user_id)}>{busy ? 'Salvando…' : 'Enviar solicitação'}</Button></Stack>
    </Box>
  </Drawer>
}
