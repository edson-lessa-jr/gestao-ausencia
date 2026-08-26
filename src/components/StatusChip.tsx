import { Chip } from '@mui/material'
import type { RequestStatus } from '../types'
import { statusLabels } from '../types'

const colors: Record<RequestStatus, { bg: string; color: string }> = {
  REQUESTED: { bg: '#fff0e3', color: '#b64e00' }, APPROVED: { bg: '#e8f4fb', color: '#075a82' },
  QUANTUM_REGISTERED: { bg: '#eee9fb', color: '#5a3aa6' }, QUANTUM_APPROVED: { bg: '#e7f5e7', color: '#24732b' },
  REJECTED: { bg: '#fdeaea', color: '#a4262c' }, CANCELLED: { bg: '#eef1f4', color: '#536271' },
}
export default function StatusChip({ status }: { status: RequestStatus }) {
  return <Chip size="small" label={statusLabels[status]} sx={{ bgcolor: colors[status].bg, color: colors[status].color, fontWeight: 700 }} />
}
