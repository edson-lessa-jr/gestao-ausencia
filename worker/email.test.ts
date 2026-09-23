import { describe, expect, it } from 'vitest'
import { escapeHtml, powerAutomatePayload, textToHtml } from './email'

describe('Power Automate email payload', () => {
  it('matches the HTTP trigger schema', () => {
    const payload = powerAutomatePayload('supervisor@cnj.jus.br', 'Comunicado', 'Linha 1\nLinha 2')

    expect(payload.to).toBe('supervisor@cnj.jus.br')
    expect(payload.subject).toBe('Comunicado')
    expect(payload.html).toContain('Linha 1<br>Linha 2')
  })

  it('escapes user-controlled content before building HTML', () => {
    expect(escapeHtml('<script>alert("x")</script> & teste')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; teste',
    )
    expect(textToHtml("Nome: D'Ávila")).toContain('D&#039;Ávila')
  })
})
