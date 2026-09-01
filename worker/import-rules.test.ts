import { describe, expect, it } from 'vitest'
import { supersededOverlaps } from './import-rules'

describe('sobreposições da importação', () => {
  it('mantém o registro enviado mais recentemente para a mesma pessoa', () => {
    const skipped = supersededOverlaps([
      { line: 10, email: 'pessoa@exemplo.org', start_date: '2026-10-13', end_date: '2026-10-20', submitted_at: '30/07/2026 12:35' },
      { line: 20, email: 'pessoa@exemplo.org', start_date: '2026-10-13', end_date: '2026-10-23', submitted_at: '06/08/2026 10:50' },
    ])
    expect(skipped.get(10)).toBe(20)
    expect(skipped.has(20)).toBe(false)
  })

  it('não considera sobreposição entre colaboradores diferentes', () => {
    const skipped = supersededOverlaps([
      { line: 2, email: 'a@exemplo.org', start_date: '2026-09-08', end_date: '2026-09-11' },
      { line: 3, email: 'b@exemplo.org', start_date: '2026-09-08', end_date: '2026-09-11' },
    ])
    expect(skipped.size).toBe(0)
  })
})
