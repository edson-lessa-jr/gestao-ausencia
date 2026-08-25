import { describe, expect, it } from 'vitest'
import { calendarDays, countBusinessDays, monthsBetween, vacationBalance } from './domain'

describe('regras de contagem', () => {
  it('conta dias corridos de forma inclusiva', () => expect(calendarDays('2026-08-01', '2026-08-30')).toBe(30))
  it('desconsidera fins de semana e feriados nos dias úteis', () => {
    expect(countBusinessDays('2026-08-24', '2026-08-28', new Set(['2026-08-25']))).toBe(4)
  })
  it('conta mudanças de mês desde a data-base', () => expect(monthsBetween('2026-01-15', '2026-08-25')).toBe(7))
})

describe('projeção de férias', () => {
  const user = { balance_start_date: '2026-01-15', opening_vacation_balance: 10, monthly_accrual: 2.5 }
  const requests = [
    { end_date: '2026-04-10', debit_days: 5, status: 'CONFIRMED' },
    { end_date: '2026-09-10', debit_days: 4, status: 'REQUESTED' },
  ]
  it('mantém o acúmulo mensal e desconta apenas férias confirmadas no saldo atual', () => {
    expect(vacationBalance(user, '2026-08-25', requests)).toBe(22.5)
  })
  it('inclui solicitações futuras quando pedido pela projeção', () => {
    expect(vacationBalance(user, '2026-12-31', requests, true)).toBe(28.5)
  })
})
