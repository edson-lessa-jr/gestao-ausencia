import { useState } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { post } from '../api'

export default function LoginPage({ needsSetup, onAuthenticated }: { needsSetup: boolean; onAuthenticated: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', teamName: 'Equipe principal', email: '', communication_email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: event.target.value })
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (needsSetup) await post('/setup', form)
      await post('/auth/login', { email: form.email, password: form.password })
      await onAuthenticated()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro inesperado.') } finally { setBusy(false) }
  }

  return <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '42% 58%' }, bgcolor: 'white' }}>
    <Box sx={{ display: { xs: 'none', md: 'flex' }, bgcolor: '#eaf6fa', p: 8, flexDirection: 'column', justifyContent: 'space-between', borderRight: '1px solid', borderColor: 'divider' }}>
      <Box component="img" src="/logo.png" alt="Símbolo do sistema" sx={{ width: 92, height: 92, objectFit: 'contain' }} />
      <Box sx={{ maxWidth: 480 }}>
        <Typography variant="h3" sx={{ fontWeight: 780, color: 'primary.main', letterSpacing: '-0.04em', mb: 2 }}>Ausências organizadas. Planejamento possível.</Typography>
        <Typography color="text.secondary" fontSize={18}>Acompanhe saldos, solicitações e disponibilidade das equipes em um só lugar.</Typography>
      </Box>
      <Typography color="text.secondary" variant="body2">Acesso protegido e individual</Typography>
    </Box>
    <Box sx={{ display: 'grid', placeItems: 'center', p: 3 }}>
      <Paper component="form" onSubmit={submit} elevation={0} sx={{ width: '100%', maxWidth: 440, p: { xs: 2, sm: 4 } }}>
        <Box component="img" src="/logo.png" alt="Símbolo" sx={{ display: { md: 'none' }, width: 64, mb: 3 }} />
        <Typography variant="h4" mb={1}>{needsSetup ? 'Configuração inicial' : 'Entrar'}</Typography>
        <Typography color="text.secondary" mb={4}>{needsSetup ? 'Crie o primeiro administrador do sistema.' : 'Use suas credenciais para continuar.'}</Typography>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          {needsSetup && <><TextField label="Nome do administrador" required value={form.name} onChange={set('name')} />
            <TextField label="Nome da primeira equipe" required value={form.teamName} onChange={set('teamName')} /></>}
          <TextField label={needsSetup ? 'E-mail de registro e acesso' : 'E-mail'} type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
          {needsSetup && <TextField label="E-mail de comunicação (opcional)" type="email" value={form.communication_email} onChange={set('communication_email')} />}
          <TextField label="Senha" type="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} required helperText={needsSetup ? 'Mínimo de 10 caracteres.' : undefined} value={form.password} onChange={set('password')} />
          <Button type="submit" variant="contained" size="large" disabled={busy}>{busy ? 'Aguarde…' : needsSetup ? 'Criar ambiente' : 'Entrar'}</Button>
        </Stack>
      </Paper>
    </Box>
  </Box>
}
