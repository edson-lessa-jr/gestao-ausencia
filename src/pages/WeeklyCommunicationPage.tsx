import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography,
} from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import SendOutlined from '@mui/icons-material/SendOutlined'
import SaveOutlined from '@mui/icons-material/SaveOutlined'
import { api, formatDate, post } from '../api'
import type { User } from '../types'

interface Team { id: string; name: string }
interface Communication { id: string; published_at?: string; published_body?: string }
interface Preview { subject: string; body: string; period_start: string; period_end: string; communication?: Communication | null }

export default function WeeklyCommunicationPage({ user }: { user: User }) {
  const [teams, setTeams] = useState<Team[]>([]); const [teamId, setTeamId] = useState(''); const [preview, setPreview] = useState<Preview | null>(null)
  const [body, setBody] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''; const result = await api<Preview>(`/communications/weekly${query}`); setPreview(result); setBody(result.body) }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro ao gerar o comunicado.') }
  }, [teamId])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (user.role === 'ADMIN') void api<{ teams: Team[] }>('/teams').then((result) => setTeams(result.teams)) }, [user.role])
  const save = async () => {
    if (!preview) return null
    const result = await post<{ id: string }>('/communications/weekly', { body, period_start: preview.period_start, period_end: preview.period_end, team_id: teamId || null })
    setPreview((current) => current ? { ...current, communication: { ...(current.communication || {}), id: result.id } } : current)
    return result.id
  }
  const saveDraft = async () => { setBusy(true); setError(''); try { await save(); setSuccess('Rascunho salvo.') } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao salvar.') } finally { setBusy(false) } }
  const publish = async () => {
    setBusy(true); setError('')
    try {
      const id = await save(); if (!id) return
      const result = await post<{ recipients: number; sent: number }>(`/communications/weekly/${id}/publish`, { body })
      setSuccess(`Comunicado publicado e preservado. E-mails enviados: ${result.sent} de ${result.recipients}.`); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao publicar.') } finally { setBusy(false) }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(body); setSuccess('Texto copiado para publicar no Teams.') } catch { setError('O navegador não permitiu copiar o texto.') } }
  return <>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}><Box><Typography variant="h4">Comunicado semanal</Typography><Typography color="text.secondary">Revise o texto, copie para o Teams e envie o mesmo conteúdo aos supervisores.</Typography></Box>{user.role === 'ADMIN' && <FormControl size="small" sx={{ minWidth: 220 }}><InputLabel>Equipe</InputLabel><Select label="Equipe" value={teamId} onChange={(e) => setTeamId(e.target.value)}><MenuItem value="">Todas as equipes</MenuItem>{teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</Select></FormControl>}</Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}{success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
    {preview && <Alert severity="info" sx={{ mb: 2 }}>Período: <strong>{formatDate(preview.period_start)} a {formatDate(preview.period_end)}</strong>. Somente “Aprovada no Quantum” aparece como ausência confirmada; os demais status válidos aparecem nas pendências.</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Stack spacing={2}><TextField label="Assunto" value={preview?.subject || '[PSE] COMUNICADO SEMANAL DE AUSÊNCIAS'} fullWidth slotProps={{ input: { readOnly: true } }} /><TextField label="Corpo do comunicado" value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={22} fullWidth /><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="flex-end"><Button variant="outlined" startIcon={<ContentCopyOutlined />} onClick={copy}>Copiar para o Teams</Button><Button variant="outlined" startIcon={<SaveOutlined />} disabled={busy || !body.trim()} onClick={saveDraft}>Salvar rascunho</Button><Button variant="contained" startIcon={<SendOutlined />} disabled={busy || !body.trim()} onClick={publish}>Publicar e enviar e-mails</Button></Stack>{preview?.communication?.published_at && <Typography variant="caption" color="text.secondary">Este comunicado já foi publicado. Uma nova publicação preservará a versão atualizada do texto.</Typography>}</Stack></Paper>
  </>
}
