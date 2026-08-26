export type BalanceUser = {
  balance_start_date: string
  opening_vacation_balance: number
  monthly_accrual: number
}

export type BalanceRequest = { end_date: string; debit_days: number; status: string }

export const ACTIVE_REQUEST_STATUSES = ['REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED', 'QUANTUM_APPROVED'] as const
export const FINAL_REQUEST_STATUSES = ['QUANTUM_APPROVED', 'REJECTED', 'CANCELLED'] as const

export const isoDate = (date: Date) => date.toISOString().slice(0, 10)

export function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

export function parseDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`)
}

export function calendarDays(start: string, end: string) {
  return Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1
}

export function monthsBetween(from: string, to: string) {
  const start = parseDate(from)
  const end = parseDate(to)
  return Math.max(0, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth())
}

export function countBusinessDays(start: string, end: string, holidays: Set<string> | Map<string, number>) {
  let count = 0
  for (let cursor = parseDate(start); cursor <= parseDate(end); cursor = addDays(cursor, 1)) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) {
      const holidayDuration = holidays instanceof Map ? Number(holidays.get(isoDate(cursor)) || 0) : holidays.has(isoDate(cursor)) ? 1 : 0
      count += Math.max(0, 1 - holidayDuration)
    }
  }
  return count
}

export function isProjectedStatus(status: string) {
  return ACTIVE_REQUEST_STATUSES.includes(status as (typeof ACTIVE_REQUEST_STATUSES)[number])
}

export function isConfirmedStatus(status: string) {
  return status === 'QUANTUM_APPROVED'
}

export function vacationBalance(user: BalanceUser, asOf: string, requests: BalanceRequest[], includeRequested = false) {
  const accrued = monthsBetween(user.balance_start_date, asOf) * Number(user.monthly_accrual)
  const deducted = requests
    .filter((request) => request.end_date <= asOf && (isConfirmedStatus(request.status) || (includeRequested && isProjectedStatus(request.status))))
    .reduce((sum, request) => sum + Number(request.debit_days), 0)
  return Number(user.opening_vacation_balance) + accrued - deducted
}

export function weekRange(reference: string) {
  const date = parseDate(reference)
  const day = date.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const currentStart = isoDate(addDays(date, mondayOffset))
  return {
    currentStart,
    currentEnd: isoDate(addDays(parseDate(currentStart), 6)),
    nextStart: isoDate(addDays(parseDate(currentStart), 7)),
    nextEnd: isoDate(addDays(parseDate(currentStart), 13)),
  }
}
