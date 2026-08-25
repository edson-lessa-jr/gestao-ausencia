import { Alert, Box, Grid, Paper, Stack, Typography } from '@mui/material'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import type { User } from '../types'

export default function SettingsPage({ user }: { user: User }) {
  const rules = [
    ['Férias', 'Dias úteis', 'Acréscimo e desconto são definidos individualmente. O acúmulo continua durante as férias.'],
    ['Ausência não justificada', '4 dias/ano', 'Limite reiniciado por ano civil e contagem em dias úteis.'],
    ['Ausência justificada', '15 dias/ano', 'Limite reiniciado por ano civil e contagem em dias úteis.'],
    ['Licença-paternidade', '30 dias', 'Contagem em dias corridos.'],
    ['Licença-maternidade', '150 dias', 'Contagem em dias corridos.'],
  ]
  return <><Box mb={3}><Typography variant="h4">Configurações</Typography><Typography color="text.secondary">Regras aplicadas aos cálculos e dados da conta.</Typography></Box><Alert severity="info" sx={{ mb: 2.5 }}>Os créditos mensais são lançados a cada mudança de mês a partir da data-base do saldo. Ajuste o saldo inicial e a data-base no cadastro do colaborador.</Alert><Grid container spacing={2.5}><Grid size={{ xs: 12, lg: 8 }}><Paper variant="outlined" sx={{ p: 2.5 }}><Typography variant="h6" mb={2}>Regras de ausência</Typography><Stack divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>{rules.map(([name, limit, detail]) => <Box key={name} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '220px 120px 1fr' }, gap: 2, py: 2, alignItems: 'center' }}><Typography fontWeight={700}>{name}</Typography><Typography color="primary.main" fontWeight={700}>{limit}</Typography><Typography variant="body2" color="text.secondary">{detail}</Typography></Box>)}</Stack></Paper></Grid><Grid size={{ xs: 12, lg: 4 }}><Paper variant="outlined" sx={{ p: 2.5 }}><Typography variant="h6" mb={2}>Sua conta</Typography><Stack spacing={1.25}><Typography><strong>{user.name}</strong></Typography><Typography color="text.secondary">{user.email}</Typography><Typography color="text.secondary">Equipe: {user.team_name}</Typography><Typography color="text.secondary">Perfil: {user.role}</Typography><Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'success.main', pt: 1 }}><CheckCircleOutline fontSize="small" /><Typography variant="body2" fontWeight={700}>Conta ativa</Typography></Box></Stack></Paper></Grid></Grid></>
}
