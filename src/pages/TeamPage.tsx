import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  FormControlLabel, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Switch, TextField,
  Tooltip, Typography,
} from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import { api, patch as update, post } from '../api'
import type { Role, User } from '../types'

interface Team { id: string; name: string; members: number }
type UserForm = Omit<User, 'id' | 'team_name'> & { password: string }
const initial: UserForm = {
  name: '', email: '', password: '', role: 'EMPLOYEE', team_id: '', active: 1,
  hire_date: '', balance_start_date: '', opening_vacation_balance: 0, monthly_accrual: 2.5, vacation_debit_factor: 1,
}

export default function TeamPage({ user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]); const [teams, setTeams] = useState<Team[]>([])
  const [editingId, setEditingId] = useState<string | null>(null); const [open, setOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false); const [teamName, setTeamName] = useState('')
  const [form, setForm] = useState<UserForm>(initial); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const load = useCallback(async () => { try { const [u, t] = await Promise.all([api<{ users: User[] }>('/users'), api<{ teams: Team[] }>('/teams')]); setUsers(u.users); setTeams(t.teams) } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar.') } }, [])
  useEffect(() => { void load() }, [load])
  const openCreate = () => { setEditingId(null); setForm({ ...initial, team_id: user.role === 'SUPERVISOR' ? user.team_id : '', role: 'EMPLOYEE' }); setOpen(true) }
  const openEdit = (member: User) => { setEditingId(member.id); setForm({ ...member, password: '' }); setOpen(true) }
  const saveUser = async () => {
    setError(''); setSuccess('')
    try {
      const wasEditing = Boolean(editingId)
      if (editingId) await update(`/users/${editingId}`, form); else await post('/users', form)
      setOpen(false); setForm(initial); setEditingId(null); setSuccess(wasEditing ? 'Colaborador atualizado.' : 'Colaborador criado.'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao salvar.') }
  }
  const createTeam = async () => { try { await post('/teams', { name: teamName }); setTeamOpen(false); setTeamName(''); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao salvar.') } }
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}><Box><Typography variant="h4">Equipe</Typography><Typography color="text.secondary">Colaboradores, vínculos e regras individuais de férias.</Typography></Box><Stack direction="row" spacing={1}>{user.role === 'ADMIN' && <Button variant="outlined" onClick={() => setTeamOpen(true)}>Nova equipe</Button>}<Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>Novo colaborador</Button></Stack></Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}{success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
    <Grid container spacing={2}>{users.map((member) => <Grid size={{ xs: 12, md: 6, xl: 4 }} key={member.id}><Paper variant="outlined" sx={{ p: 2.5, opacity: member.active ? 1 : .68 }}><Stack direction="row" spacing={2} alignItems="center"><Avatar sx={{ bgcolor: member.active ? 'primary.main' : 'text.disabled' }}>{member.name[0]}</Avatar><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={750} noWrap>{member.name}</Typography>{!member.active && <Chip size="small" label="Inativo" />}</Stack><Typography variant="body2" color="text.secondary" noWrap>{member.email}</Typography></Box><Tooltip title="Editar colaborador"><IconButton onClick={() => openEdit(member)}><EditOutlined /></IconButton></Tooltip></Stack><Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}><Box><Typography variant="caption" color="text.secondary">Equipe</Typography><Typography variant="body2" fontWeight={650}>{member.team_name}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Perfil</Typography><Typography variant="body2" fontWeight={650}>{member.role === 'ADMIN' ? 'Administrador' : member.role === 'SUPERVISOR' ? 'Supervisor' : 'Colaborador'}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Acréscimo / mês</Typography><Typography variant="body2" fontWeight={650}>{member.monthly_accrual} dias</Typography></Box><Box><Typography variant="caption" color="text.secondary">Desconto / dia</Typography><Typography variant="body2" fontWeight={650}>{member.vacation_debit_factor}</Typography></Box></Box></Paper></Grid>)}</Grid>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md"><DialogTitle>{editingId ? 'Editar colaborador' : 'Novo colaborador'}</DialogTitle><DialogContent><Grid container spacing={2} mt={.5}>
      <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="E-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Grid>
      <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label={editingId ? 'Nova senha (opcional)' : 'Senha temporária'} type="password" helperText={editingId ? 'Deixe vazio para manter a senha atual.' : 'Mínimo de 10 caracteres.'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Grid>
      <Grid size={{ xs: 12, sm: 3 }}><FormControl fullWidth><InputLabel>Perfil</InputLabel><Select disabled={user.role !== 'ADMIN'} label="Perfil" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}><MenuItem value="EMPLOYEE">Colaborador</MenuItem><MenuItem value="SUPERVISOR">Supervisor</MenuItem><MenuItem value="ADMIN">Administrador</MenuItem></Select></FormControl></Grid>
      <Grid size={{ xs: 12, sm: 3 }}><FormControl fullWidth><InputLabel>Equipe</InputLabel><Select disabled={user.role === 'SUPERVISOR'} label="Equipe" value={form.team_id || ''} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl></Grid>
      <Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth label="Data de admissão" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth label="Data-base do saldo" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.balance_start_date} onChange={(e) => setForm({ ...form, balance_start_date: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth label="Saldo inicial (dias)" type="number" value={form.opening_vacation_balance} onChange={(e) => setForm({ ...form, opening_vacation_balance: Number(e.target.value) })} /></Grid>
      <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Acréscimo mensal" type="number" slotProps={{ htmlInput: { step: .1 } }} value={form.monthly_accrual} onChange={(e) => setForm({ ...form, monthly_accrual: Number(e.target.value) })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Fator de desconto por dia útil" type="number" slotProps={{ htmlInput: { step: .1 } }} value={form.vacation_debit_factor} onChange={(e) => setForm({ ...form, vacation_debit_factor: Number(e.target.value) })} /></Grid>
      {editingId && <Grid size={{ xs: 12 }}><FormControlLabel control={<Switch checked={Boolean(form.active)} onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })} />} label={form.active ? 'Usuário ativo' : 'Usuário inativo — não poderá acessar o sistema'} /></Grid>}
    </Grid></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="contained" onClick={saveUser} disabled={!form.name || !form.email || (!editingId && !form.password) || !form.team_id}>{editingId ? 'Salvar alterações' : 'Criar colaborador'}</Button></DialogActions></Dialog>
    <Dialog open={teamOpen} onClose={() => setTeamOpen(false)} fullWidth maxWidth="xs"><DialogTitle>Nova equipe</DialogTitle><DialogContent><TextField fullWidth label="Nome da equipe" sx={{ mt: 1 }} value={teamName} onChange={(e) => setTeamName(e.target.value)} /></DialogContent><DialogActions><Button onClick={() => setTeamOpen(false)}>Cancelar</Button><Button variant="contained" disabled={!teamName.trim()} onClick={createTeam}>Criar</Button></DialogActions></Dialog>
  </>
}
