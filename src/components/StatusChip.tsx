import { Chip } from '@mui/material'
import type { RequestStatus } from '../types'
import { statusLabels } from '../types'

const colors: Record<RequestStatus, { bg: string; color: string }> = {
  REQUESTED: { bg: '#fff0e3', color: '#b64e00' }, CONFIRMED: { bg: '#e7f5e7', color: '#24732b' },
  REJECTED: { bg: '#fdeaea', color: '#a4262c' }, CANCELLED: { bg: '#eef1f4', color: '#536271' },
}
export default function StatusChip({ status }: { status: RequestStatus }) {
  return <Chip size="small" label={statusLabels[status]} sx={{ bgcolor: colors[status].bg, color: colors[status].color, fontWeight: 700 }} />
}
