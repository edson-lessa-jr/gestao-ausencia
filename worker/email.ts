export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function textToHtml(value: string) {
  const content = escapeHtml(value).replace(/\r?\n/g, '<br>')
  return `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #202124;">${content}</div>`
}

export function powerAutomatePayload(to: string, subject: string, body: string) {
  return { to, subject, html: textToHtml(body) }
}
