import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  FormControlLabel, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Switch, TextField,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import { api, formatDate, patch as update, post } from '../api'
import type { Role, User } from '../types'
import { parseVacationCsv, type VacationCsvRow } from '../vacationCsv'

interface Team { id: string; name: string; members: number }
interface ImportItem extends VacationCsvRow { action: 'CREATE' | 'EXISTING' | 'SKIP' | 'REVIEW' | 'ERROR'; message: string }
interface ImportPreview {
  team: { id: string; name: string }
  users: ImportItem[]
  requests: ImportItem[]
  summary: { users_to_create: number; users_existing: number; requests_to_create: number; requests_skipped: number; review_or_error: number }
}
type UserForm = Omit<User, 'id' | 'team_name'> & { password: string }
const initial: UserForm = {
  name: '', email: '', communication_email: null, password: '', role: 'EMPLOYEE', team_id: '', active: 1,
  hire_date: '', balance_start_date: '', opening_vacation_balance: 0, monthly_accrual: 2.5, vacation_debit_factor: 1,
}

export default function TeamPage({ user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]); const [teams, setTeams] = useState<Team[]>([])
  const [editingId, setEditingId] = useState<string | null>(null); const [open, setOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false); const [teamName, setTeamName] = useState('')
  const [importOpen, setImportOpen] = useState(false); const [importTeam, setImportTeam] = useState(user.role === 'SUPERVISOR' ? user.team_id || '' : '')
  const [importRows, setImportRows] = useState<VacationCsvRow[]>([]); const [preview, setPreview] = useState<ImportPreview | null>(null); const [importing, setImporting] = useState(false)
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
  const openImport = () => { setImportTeam(user.role === 'SUPERVISOR' ? user.team_id || '' : ''); setImportRows([]); setPreview(null); setImportOpen(true); setError('') }
  const previewCsv = async (file: File) => {
    setError(''); setPreview(null); setImporting(true)
    try {
      const rows = parseVacationCsv(await file.text())
      setImportRows(rows)
      setPreview(await post<ImportPreview>('/users/vacation-import/preview', { team_id: importTeam, rows }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível analisar o CSV.') }
    finally { setImporting(false) }
  }
  const confirmImport = async () => {
    setError(''); setImporting(true)
    try {
      const result = await post<{ users_created: number; requests_created: number; requests_skipped: number; review_or_error: number }>('/users/vacation-import', { team_id: importTeam, rows: importRows })
      setImportOpen(false); setPreview(null); setImportRows([])
      setSuccess(`${result.users_created} colaborador(es) e ${result.requests_created} solicitação(ões) importados. ${result.requests_skipped} registro(s) ignorados.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a importação.') }
    finally { setImporting(false) }
  }
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}><Box><Typography variant="h4">Equipe</Typography><Typography color="text.secondary">Colaboradores, vínculos e regras individuais de férias.</Typography></Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>{user.role === 'ADMIN' && <Button variant="outlined" onClick={() => setTeamOpen(true)}>Nova equipe</Button>}{['ADMIN', 'SUPERVISOR'].includes(user.role) && <Button variant="outlined" startIcon={<UploadFileOutlined />} onClick={openImport}>Importar CSV</Button>}<Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>Novo colaborador</Button></Stack></Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}{success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
    <Grid container spacing={2}>{users.map((member) => <Grid size={{ xs: 12, md: 6, xl: 4 }} key={member.id}><Paper variant="outlined" sx={{ p: 2.5, opacity: member.active ? 1 : .68 }}><Stack direction="row" spacing={2} alignItems="center"><Avatar sx={{ bgcolor: member.active ? 'primary.main' : 'text.disabled' }}>{member.name[0]}</Avatar><Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={750} noWrap>{member.name}</Typography>{!member.active && <Chip size="small" label="Inativo" />}</Stack><Typography variant="body2" color="text.secondary" noWrap>Registro: {member.email}</Typography><Typography variant="caption" color="text.secondary" noWrap display="block">Comunicação: {member.communication_email || 'não informado'}</Typography></Box><Tooltip title="Editar colaborador"><IconButton onClick={() => openEdit(member)}><EditOutlined /></IconButton></Tooltip></Stack><Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}><Box><Typography variant="caption" color="text.secondary">Equipe</Typography><Typography variant="body2" fontWeight={650}>{member.team_name}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Perfil</Typography><Typography variant="body2" fontWeight={650}>{member.role === 'ADMIN' ? 'Administrador' : member.role === 'SUPERVISOR' ? 'Supervisor' : 'Colaborador'}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Acréscimo / mês</Typography><Typography variant="body2" fontWeight={650}>{member.monthly_accrual} dias</Typography></Box><Box><Typography variant="caption" color="text.secondary">Desconto / dia</Typography><Typography variant="body2" fontWeight={650}>{member.vacation_debit_factor}</Typography></Box></Box></Paper></Grid>)}</Grid>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md"><DialogTitle>{editingId ? 'Editar colaborador' : 'Novo colaborador'}</DialogTitle><DialogContent><Grid container spacing={2} mt={.5}>
      <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth required label="E-mail de registro e acesso" type="email" helperText="Normalmente, o endereço @undp.org usado no Quantum." value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Grid>
      <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="E-mail de comunicação" type="email" helperText="Endereço que receberá notificações, normalmente @cnj.jus.br." value={form.communication_email || ''} onChange={(e) => setForm({ ...form, communication_email: e.target.value || null })} /></Grid>
      <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label={editingId ? 'Nova senha (opcional)' : 'Senha temporária'} type="password" helperText={editingId ? 'Deixe vazio para manter a senha atual.' : 'Mínimo de 10 caracteres.'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Grid>
      <Grid size={{ xs: 12, sm: 3 }}><FormControl fullWidth><InputLabel>Perfil</InputLabel><Select disabled={user.role !== 'ADMIN'} label="Perfil" value={form.role} onChange={(e) => { const role = e.target.value as Role; setForm({ ...form, role, team_id: role === 'ADMIN' ? null : form.team_id }) }}><MenuItem value="EMPLOYEE">Colaborador</MenuItem><MenuItem value="SUPERVISOR">Supervisor</MenuItem><MenuItem value="ADMIN">Administrador</MenuItem></Select></FormControl></Grid>
      <Grid size={{ xs: 12, sm: 3 }}><FormControl fullWidth><InputLabel>Equipe</InputLabel><Select disabled={user.role === 'SUPERVISOR' || form.role === 'ADMIN'} label="Equipe" value={form.team_id || ''} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl></Grid>
      <Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth label="Data de admissão" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth label="Data-base do saldo" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.balance_start_date} onChange={(e) => setForm({ ...form, balance_start_date: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth label="Saldo inicial (dias)" type="number" helperText="Aceita até duas casas decimais." slotProps={{ htmlInput: { step: .01, min: 0 } }} value={form.opening_vacation_balance} onChange={(e) => setForm({ ...form, opening_vacation_balance: Number(e.target.value) })} /></Grid>
      <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Acréscimo mensal" type="number" slotProps={{ htmlInput: { step: .1 } }} value={form.monthly_accrual} onChange={(e) => setForm({ ...form, monthly_accrual: Number(e.target.value) })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Fator de desconto por dia útil" type="number" slotProps={{ htmlInput: { step: .1 } }} value={form.vacation_debit_factor} onChange={(e) => setForm({ ...form, vacation_debit_factor: Number(e.target.value) })} /></Grid>
      {editingId && <Grid size={{ xs: 12 }}><FormControlLabel control={<Switch checked={Boolean(form.active)} onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })} />} label={form.active ? 'Usuário ativo' : 'Usuário inativo — não poderá acessar o sistema'} /></Grid>}
    </Grid></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="contained" onClick={saveUser} disabled={!form.name || !form.email || (!editingId && !form.password) || (form.role !== 'ADMIN' && !form.team_id)}>{editingId ? 'Salvar alterações' : 'Criar colaborador'}</Button></DialogActions></Dialog>
    <Dialog open={teamOpen} onClose={() => setTeamOpen(false)} fullWidth maxWidth="xs"><DialogTitle>Nova equipe</DialogTitle><DialogContent><TextField fullWidth label="Nome da equipe" sx={{ mt: 1 }} value={teamName} onChange={(e) => setTeamName(e.target.value)} /></DialogContent><DialogActions><Button onClick={() => setTeamOpen(false)}>Cancelar</Button><Button variant="contained" disabled={!teamName.trim()} onClick={createTeam}>Criar</Button></DialogActions></Dialog>
    <Dialog open={importOpen} onClose={() => !importing && setImportOpen(false)} fullWidth maxWidth="lg">
      <DialogTitle>Importar colaboradores e férias</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={.5}>
          <Alert severity="info">O arquivo é analisado antes da importação. Períodos encerrados são ignorados e, nas sobreposições do próprio CSV, somente o registro enviado mais recentemente é mantido. Observações não são importadas.</Alert>
          {user.role === 'ADMIN' ? <FormControl fullWidth><InputLabel>Equipe de destino</InputLabel><Select label="Equipe de destino" value={importTeam} onChange={(e) => { setImportTeam(e.target.value); setPreview(null); setImportRows([]) }}>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl> : <TextField fullWidth label="Equipe de destino" value={user.team_name || ''} disabled />}
          <Box><Button component="label" variant="outlined" startIcon={importing ? <CircularProgress size={18} /> : <UploadFileOutlined />} disabled={!importTeam || importing}>Selecionar CSV<input hidden type="file" accept=".csv,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) void previewCsv(file); e.target.value = '' }} /></Button></Box>
          <Typography variant="body2" color="text.secondary">A coluna Email ou E-mail de registro deve conter o endereço usado no Quantum, normalmente @undp.org. E-mail de comunicação é opcional e pode conter o endereço @cnj.jus.br. Nome, datas, dias úteis e saldo também são obrigatórios. Id e Hora de início são recomendadas.</Typography>
          {preview && <>
            <Alert severity={preview.summary.review_or_error ? 'warning' : 'success'}>Prévia da equipe <strong>{preview.team.name}</strong>. Novos colaboradores receberão a senha inicial <strong>1234567890</strong>.</Alert>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, md: 2.4 }}><Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="h6">{preview.summary.users_to_create}</Typography><Typography variant="caption">Novos colaboradores</Typography></Paper></Grid>
              <Grid size={{ xs: 6, md: 2.4 }}><Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="h6">{preview.summary.users_existing}</Typography><Typography variant="caption">Já cadastrados</Typography></Paper></Grid>
              <Grid size={{ xs: 6, md: 2.4 }}><Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="h6">{preview.summary.requests_to_create}</Typography><Typography variant="caption">Férias a importar</Typography></Paper></Grid>
              <Grid size={{ xs: 6, md: 2.4 }}><Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="h6">{preview.summary.requests_skipped}</Typography><Typography variant="caption">Ignoradas</Typography></Paper></Grid>
              <Grid size={{ xs: 6, md: 2.4 }}><Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="h6">{preview.summary.review_or_error}</Typography><Typography variant="caption">Com inconsistência</Typography></Paper></Grid>
            </Grid>
            <Paper variant="outlined" sx={{ overflowX: 'auto', maxHeight: 420 }}><Table stickyHeader size="small"><TableHead><TableRow><TableCell>Linha</TableCell><TableCell>Colaborador</TableCell><TableCell>Período</TableCell><TableCell>Dias úteis</TableCell><TableCell>Resultado</TableCell><TableCell>Detalhe</TableCell></TableRow></TableHead><TableBody>{preview.requests.slice(0, 200).map((item) => <TableRow key={`${item.line}-${item.email}`}><TableCell>{item.line}</TableCell><TableCell><Typography variant="body2" fontWeight={650}>{item.name}</Typography><Typography variant="caption" color="text.secondary" display="block">Registro: {item.email}</Typography>{item.communication_email && <Typography variant="caption" color="text.secondary" display="block">Comunicação: {item.communication_email}</Typography>}</TableCell><TableCell>{formatDate(item.start_date)} a {formatDate(item.end_date)}</TableCell><TableCell>{item.business_days}</TableCell><TableCell><Chip size="small" label={item.action === 'CREATE' ? 'Importar' : item.action === 'SKIP' ? 'Ignorar' : item.action === 'REVIEW' ? 'Revisar' : 'Erro'} color={item.action === 'CREATE' ? 'success' : item.action === 'SKIP' ? 'default' : 'warning'} /></TableCell><TableCell>{item.message}</TableCell></TableRow>)}</TableBody></Table></Paper>
            {preview.requests.length > 200 && <Typography variant="caption" color="text.secondary">Exibindo as primeiras 200 de {preview.requests.length} linhas.</Typography>}
          </>}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={() => setImportOpen(false)} disabled={importing}>Cancelar</Button><Button variant="contained" onClick={confirmImport} disabled={!preview || importing || (preview.summary.users_to_create === 0 && preview.summary.requests_to_create === 0)}>{importing ? 'Importando…' : 'Importar registros válidos'}</Button></DialogActions>
    </Dialog>
  </>
}
