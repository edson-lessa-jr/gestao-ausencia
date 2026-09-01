export type Role = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE'
export type RequestStatus = 'REQUESTED' | 'APPROVED' | 'QUANTUM_REGISTERED' | 'QUANTUM_APPROVED' | 'REJECTED' | 'CANCELLED'
export type AbsenceType = 'VACATION' | 'JUSTIFIED' | 'UNJUSTIFIED' | 'PATERNITY' | 'MATERNITY' | 'ADMINISTRATIVE'

export interface User {
  id: string
  name: string
  email: string
  communication_email: string | null
  role: Role
  team_id: string | null
  team_name?: string | null
  hire_date: string
  balance_start_date: string
  opening_vacation_balance: number
  monthly_accrual: number
  vacation_debit_factor: number
  active: number
}

export interface AbsenceRequest {
  id: string
  user_id: string
  user_name: string
  type: AbsenceType
  start_date: string
  end_date: string
  business_days: number
  calendar_days: number
  debit_days: number
  administrative_days: number
  status: RequestStatus
  reason?: string
  team_name?: string
}

export const absenceLabels: Record<AbsenceType, string> = {
  VACATION: 'Férias', JUSTIFIED: 'Ausência justificada', UNJUSTIFIED: 'Ausência não justificada',
  PATERNITY: 'Licença-paternidade', MATERNITY: 'Licença-maternidade', ADMINISTRATIVE: 'Folga administrativa',
}

export const statusLabels: Record<RequestStatus, string> = {
  REQUESTED: 'Solicitada', APPROVED: 'Aprovada', QUANTUM_REGISTERED: 'Registrada no Quantum',
  QUANTUM_APPROVED: 'Aprovada no Quantum', REJECTED: 'Rejeitada', CANCELLED: 'Cancelada',
}
