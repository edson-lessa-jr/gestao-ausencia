import { describe, expect, it } from 'vitest'
import { parseVacationCsv } from '../src/vacationCsv'

describe('importação de férias por CSV', () => {
  it('reconhece o cabeçalho do formulário e números com vírgula', () => {
    const csv = `Id;Hora de início;Email;Nome;Data de Início;Data Final;Número de dias úteis;Saldo de férias atual no último PaySlip;Observações:
1;31/08/2026 09:00;pessoa\\@undp.org;Pessoa Teste;08/09/2026;11/09/2026;3,5;15,45;Texto ignorado`
    expect(parseVacationCsv(csv)).toEqual([{
      line: 2,
      external_id: '1',
      submitted_at: '31/08/2026 09:00',
      email: 'pessoa@undp.org',
      name: 'Pessoa Teste',
      start_date: '2026-09-08',
      end_date: '2026-09-11',
      business_days: 3.5,
      opening_balance: 15.45,
    }])
  })

  it('aceita campos entre aspas sem importar observações', () => {
    const csv = `Email;Nome;Data de Início;Data Final;Número de dias úteis;Saldo de férias atual no último PaySlip;Observações:
teste@exemplo.org;"Nome; Composto";01/10/2026;02/10/2026;2;10;"Observação;
em duas linhas e ignorada"`
    const [row] = parseVacationCsv(csv)
    expect(row.name).toBe('Nome; Composto')
    expect(row).not.toHaveProperty('notes')
  })
})
