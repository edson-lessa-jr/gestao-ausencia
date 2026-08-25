export type BalanceUser = {
  balance_start_date: string
  opening_vacation_balance: number
  monthly_accrual: number
}

export type BalanceRequest = { end_date: string; debit_days: number; status: string }

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

export function countBusinessDays(start: string, end: string, holidays: Set<string>) {
  let count = 0
  for (let cursor = parseDate(start); cursor <= parseDate(end); cursor = addDays(cursor, 1)) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6 && !holidays.has(isoDate(cursor))) count += 1
  }
  return count
}

export function vacationBalance(user: BalanceUser, asOf: string, requests: BalanceRequest[], includeRequested = false) {
  const accrued = monthsBetween(user.balance_start_date, asOf) * Number(user.monthly_accrual)
  const deducted = requests
    .filter((request) => request.end_date <= asOf && (request.status === 'CONFIRMED' || (includeRequested && request.status === 'REQUESTED')))
    .reduce((sum, request) => sum + Number(request.debit_days), 0)
  return Number(user.opening_vacation_balance) + accrued - deducted
}
