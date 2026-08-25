import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import AddRounded from '@mui/icons-material/AddRounded'
import { api, formatDate, post } from '../api'
import type { User } from '../types'

interface Holiday { id: string; date: string; name: string; team_id: string | null; team_name?: string }
interface Team { id: string; name: string }
export default function HolidaysPage({ user }: { user: User }) {
  const [rows, setRows] = useState<Holiday[]>([]); const [teams, setTeams] = useState<Team[]>([]); const [open, setOpen] = useState(false); const [error, setError] = useState('')
  const [form, setForm] = useState({ date: '', name: '', team_id: '' })
  const load = useCallback(async () => { try { const [h, t] = await Promise.all([api<{ holidays: Holiday[] }>('/holidays'), api<{ teams: Team[] }>('/teams')]); setRows(h.holidays); setTeams(t.teams) } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar.') } }, [])
  useEffect(() => { void load() }, [load])
  const save = async () => { try { await post('/holidays', { ...form, team_id: form.team_id || null }); setOpen(false); setForm({ date: '', name: '', team_id: '' }); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao salvar.') } }
  return <><Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}><Box><Typography variant="h4">Feriados</Typography><Typography color="text.secondary">Datas excluídas do cálculo de dias úteis.</Typography></Box><Button variant="contained" startIcon={<AddRounded />} onClick={() => setOpen(true)}>Adicionar feriado</Button></Stack>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<Paper variant="outlined"><Table><TableHead><TableRow><TableCell>Data</TableCell><TableCell>Descrição</TableCell><TableCell>Abrangência</TableCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{formatDate(row.date)}</TableCell><TableCell>{row.name}</TableCell><TableCell>{row.team_name || 'Todas as equipes'}</TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={3} align="center" sx={{ py: 8, color: 'text.secondary' }}>Nenhum feriado cadastrado.</TableCell></TableRow>}</TableBody></Table></Paper>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Novo feriado</DialogTitle><DialogContent><Stack spacing={2} mt={1}><TextField label="Data" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /><TextField label="Descrição" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />{user.role === 'ADMIN' && <FormControl><InputLabel>Abrangência</InputLabel><Select label="Abrangência" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}><MenuItem value="">Todas as equipes</MenuItem>{teams.map((team) => <MenuItem value={team.id} key={team.id}>{team.name}</MenuItem>)}</Select></FormControl>}</Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="contained" onClick={save} disabled={!form.date || !form.name}>Salvar</Button></DialogActions></Dialog>
  </>
}
