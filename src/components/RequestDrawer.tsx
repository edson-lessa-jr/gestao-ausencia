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
  const [form, setForm] = useState({ user_id: user.id, type: 'VACATION' as AbsenceType, start_date: '', end_date: '', reason: '', status: 'REQUESTED' })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && user.role !== 'EMPLOYEE') void api<{ users: User[] }>('/users').then((r) => { setUsers(r.users); if (r.users.length) setForm((f) => ({ ...f, user_id: f.user_id === user.id ? r.users[0].id : f.user_id })) }) }, [open, user.id, user.role])
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
        <FormControl fullWidth><InputLabel>Tipo de ausência</InputLabel><Select label="Tipo de ausência" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AbsenceType })}>{Object.entries(absenceLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField fullWidth label="Data de início" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /><TextField fullWidth label="Data de término" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Stack>
        {user.role !== 'EMPLOYEE' && <FormControl fullWidth><InputLabel>Status inicial</InputLabel><Select label="Status inicial" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><MenuItem value="REQUESTED">Solicitada</MenuItem><MenuItem value="CONFIRMED">Confirmada</MenuItem></Select></FormControl>}
        <TextField label="Observação" multiline minRows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        {estimated && <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Período calculado</Typography><Typography fontWeight={750}>{form.type === 'PATERNITY' || form.type === 'MATERNITY' ? `${estimated.calendar} dias corridos` : `${estimated.business} dias úteis`}</Typography></Box>
          {form.type === 'VACATION' && <><Divider /><Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Desconto estimado no saldo</Typography><Typography fontWeight={750}>{estimated.debit.toLocaleString('pt-BR')} dias</Typography><Typography variant="caption" color="text.secondary">Fator individual: {selected.vacation_debit_factor}</Typography></Box></>}
        </Box>}
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 'auto', pt: 3 }}><Button fullWidth variant="outlined" onClick={onClose}>Cancelar</Button><Button fullWidth variant="contained" onClick={save} disabled={busy || !form.start_date || !form.end_date}>{busy ? 'Salvando…' : 'Enviar solicitação'}</Button></Stack>
    </Box>
  </Drawer>
}
