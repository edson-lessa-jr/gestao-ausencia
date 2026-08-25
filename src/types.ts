export type Role = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE'
export type RequestStatus = 'REQUESTED' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED'
export type AbsenceType = 'VACATION' | 'JUSTIFIED' | 'UNJUSTIFIED' | 'PATERNITY' | 'MATERNITY'

export interface User {
  id: string
  name: string
  email: string
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
  status: RequestStatus
  reason?: string
  team_name?: string
}

export const absenceLabels: Record<AbsenceType, string> = {
  VACATION: 'Férias', JUSTIFIED: 'Ausência justificada', UNJUSTIFIED: 'Ausência não justificada',
  PATERNITY: 'Licença-paternidade', MATERNITY: 'Licença-maternidade',
}

export const statusLabels: Record<RequestStatus, string> = {
  REQUESTED: 'Solicitada', CONFIRMED: 'Confirmada', REJECTED: 'Rejeitada', CANCELLED: 'Cancelada',
}
