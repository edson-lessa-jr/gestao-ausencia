import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton,
  FormControlLabel, InputLabel, MenuItem, Paper, Select, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import { api, formatDate, patch as update, post, remove } from '../api'
import type { User } from '../types'

interface Holiday { id: string; date: string; name: string; team_id: string | null; team_name?: string; duration: number; generates_admin_credit: number }
interface Team { id: string; name: string }
const emptyForm = { date: '', name: '', team_id: '', duration: 1, generates_admin_credit: true }
const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const csvDate = (value: string) => {
  const clean = value.trim()
  const match = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : clean
}

export default function HolidaysPage({ user }: { user: User }) {
  const [rows, setRows] = useState<Holiday[]>([]); const [teams, setTeams] = useState<Team[]>([])
  const [open, setOpen] = useState(false); const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null); const [error, setError] = useState(''); const [success, setSuccess] = useState('')
  const [form, setForm] = useState(emptyForm)
  const load = useCallback(async () => { try { const [h, t] = await Promise.all([api<{ holidays: Holiday[] }>('/holidays'), api<{ teams: Team[] }>('/teams')]); setRows(h.holidays); setTeams(t.teams) } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar.') } }, [])
  useEffect(() => { void load() }, [load])
  const openCreate = () => { setEditingId(null); setForm(emptyForm); setOpen(true) }
  const openEdit = (holiday: Holiday) => { setEditingId(holiday.id); setForm({ date: holiday.date, name: holiday.name, team_id: holiday.team_id || '', duration: Number(holiday.duration), generates_admin_credit: Boolean(holiday.generates_admin_credit) }); setOpen(true) }
  const save = async () => { try { const body = { ...form, team_id: form.team_id || null }; if (editingId) await update(`/holidays/${editingId}`, body); else await post('/holidays', body); setOpen(false); setSuccess(editingId ? 'Feriado atualizado.' : 'Feriado adicionado.'); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao salvar.') } }
  const deleteHoliday = async () => { if (!deleteTarget) return; try { await remove(`/holidays/${deleteTarget.id}`); setDeleteTarget(null); setSuccess('Feriado excluído.'); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao excluir.') } }
  const importCsv = async (file: File) => {
    setError(''); setSuccess('')
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '').trim()
      const lines = text.split(/\r?\n/).filter(Boolean); if (lines.length < 2) throw new Error('O CSV deve conter cabeçalho e pelo menos uma linha.')
      const delimiter = (lines[0].match(/;/g)?.length || 0) >= (lines[0].match(/,/g)?.length || 0) ? ';' : ','
      const headers = lines[0].split(delimiter).map(normalize)
      const dateIndex = headers.findIndex((header) => ['data', 'date'].includes(header)); const nameIndex = headers.findIndex((header) => ['nome', 'name', 'descricao', 'feriado'].includes(header)); const teamIndex = headers.findIndex((header) => ['equipe', 'team', 'team_id'].includes(header)); const durationIndex = headers.findIndex((header) => ['duracao', 'duration'].includes(header)); const creditIndex = headers.findIndex((header) => ['saldo_administrativo', 'gera_saldo', 'administrative_credit'].includes(header))
      if (dateIndex < 0 || nameIndex < 0) throw new Error('Use as colunas data e nome. A coluna equipe é opcional.')
      const holidays = lines.slice(1).map((line, index) => {
        const columns = line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ''))
        const teamValue = teamIndex >= 0 ? columns[teamIndex] : ''
        const team = teams.find((item) => normalize(item.name) === normalize(teamValue) || item.id === teamValue)
        if (user.role === 'ADMIN' && teamValue && !team) throw new Error(`Equipe não encontrada na linha ${index + 2}: ${teamValue}`)
        const durationValue = durationIndex >= 0 ? columns[durationIndex].replace(',', '.') : '1'
        const creditValue = creditIndex >= 0 ? normalize(columns[creditIndex]) : 'sim'
        return { date: csvDate(columns[dateIndex]), name: columns[nameIndex], team_id: user.role === 'SUPERVISOR' ? user.team_id : team?.id || null, duration: Number(durationValue), generates_admin_credit: !['nao', 'não', '0', 'false'].includes(creditValue) }
      })
      const result = await post<{ imported: number }>('/holidays/import', { holidays })
      setSuccess(`${result.imported} feriado(s) importado(s).`); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível importar o CSV.') }
  }
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}><Box><Typography variant="h4">Feriados</Typography><Typography color="text.secondary">Datas excluídas do cálculo de dias úteis.</Typography></Box><Stack direction="row" spacing={1}><Button component="label" variant="outlined" startIcon={<UploadFileOutlined />}>Importar CSV<input hidden type="file" accept=".csv,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importCsv(file); e.target.value = '' }} /></Button><Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>Adicionar feriado</Button></Stack></Stack>
    <Alert severity="info" sx={{ mb: 2 }}>CSV aceito: <strong>data;nome;equipe;duracao;saldo_administrativo</strong>. Duração: 1 ou 0,5. Saldo administrativo: sim ou não.</Alert>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}{success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
    <Paper variant="outlined"><Table><TableHead><TableRow><TableCell>Data</TableCell><TableCell>Descrição</TableCell><TableCell>Duração</TableCell><TableCell>Saldo administrativo</TableCell><TableCell>Abrangência</TableCell><TableCell align="right">Ações</TableCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{formatDate(row.date)}</TableCell><TableCell>{row.name}</TableCell><TableCell>{Number(row.duration) === .5 ? 'Meio período' : 'Dia inteiro'}</TableCell><TableCell>{row.generates_admin_credit ? 'Gera crédito' : 'Somente cálculo oficial'}</TableCell><TableCell>{row.team_name || 'Todas as equipes'}</TableCell><TableCell align="right"><Tooltip title="Editar"><IconButton onClick={() => openEdit(row)}><EditOutlined /></IconButton></Tooltip><Tooltip title="Excluir"><IconButton color="error" onClick={() => setDeleteTarget(row)}><DeleteOutline /></IconButton></Tooltip></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 8, color: 'text.secondary' }}>Nenhum feriado cadastrado.</TableCell></TableRow>}</TableBody></Table></Paper>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>{editingId ? 'Editar feriado' : 'Novo feriado'}</DialogTitle><DialogContent><Stack spacing={2} mt={1}><TextField label="Data" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /><TextField label="Descrição" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><FormControl><InputLabel>Duração</InputLabel><Select label="Duração" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}><MenuItem value={1}>Dia inteiro</MenuItem><MenuItem value={.5}>Meio período</MenuItem></Select></FormControl><FormControlLabel control={<Switch checked={form.generates_admin_credit} onChange={(e) => setForm({ ...form, generates_admin_credit: e.target.checked })} />} label="Gerar saldo administrativo quando coincidir com ausência aprovada no Quantum" />{user.role === 'ADMIN' && <FormControl><InputLabel>Abrangência</InputLabel><Select label="Abrangência" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}><MenuItem value="">Todas as equipes</MenuItem>{teams.map((team) => <MenuItem value={team.id} key={team.id}>{team.name}</MenuItem>)}</Select></FormControl>}</Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="contained" onClick={save} disabled={!form.date || !form.name}>{editingId ? 'Salvar alterações' : 'Salvar'}</Button></DialogActions></Dialog>
    <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}><DialogTitle>Excluir feriado?</DialogTitle><DialogContent><Typography>O feriado <strong>{deleteTarget?.name}</strong> deixará de ser considerado nos cálculos de dias úteis.</Typography></DialogContent><DialogActions><Button onClick={() => setDeleteTarget(null)}>Cancelar</Button><Button color="error" variant="contained" onClick={deleteHoliday}>Excluir</Button></DialogActions></Dialog>
  </>
}
