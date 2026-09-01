export interface VacationCsvRow {
  line: number
  external_id?: string
  submitted_at?: string
  email: string
  name: string
  start_date: string
  end_date: string
  business_days: number
  opening_balance: number
}

const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')

function parseRecords(content: string, delimiter: string) {
  const records: string[][] = []; let record: string[] = []; let current = ''; let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (character === '"' && quoted && content[index + 1] === '"') { current += '"'; index += 1 }
    else if (character === '"') quoted = !quoted
    else if (character === delimiter && !quoted) { record.push(current.trim()); current = '' }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      record.push(current.trim()); current = ''
      if (record.some((value) => value)) records.push(record)
      record = []
    } else current += character
  }
  record.push(current.trim())
  if (record.some((value) => value)) records.push(record)
  return records
}

const toIsoDate = (value: string) => {
  const clean = value.trim()
  const match = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : clean
}

const toNumber = (value: string) => Number(value.trim().replace(/\s/g, '').replace(',', '.'))

export function parseVacationCsv(content: string): VacationCsvRow[] {
  const clean = content.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0]
  const delimiter = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ';' : ','
  const records = parseRecords(clean, delimiter)
  if (records.length < 2) throw new Error('O CSV deve conter cabeçalho e pelo menos uma linha.')
  const headers = records[0].map(normalize)
  const find = (...names: string[]) => headers.findIndex((header) => names.includes(header))
  const indexes = {
    id: find('id'), submitted: find('hora de inicio', 'data de envio', 'enviado em'),
    email: find('email', 'e-mail'), name: find('nome'), start: find('data de inicio', 'inicio'),
    end: find('data final', 'data de termino', 'fim'), days: find('numero de dias uteis', 'dias uteis'),
    balance: find('saldo de ferias atual no ultimo payslip', 'saldo de ferias', 'saldo atual'),
  }
  const required = [indexes.email, indexes.name, indexes.start, indexes.end, indexes.days, indexes.balance]
  if (required.some((index) => index < 0)) {
    throw new Error('O CSV deve conter Email, Nome, Data de Início, Data Final, Número de dias úteis e Saldo de férias atual no último PaySlip.')
  }
  return records.slice(1).map((columns, index) => {
    return {
      line: index + 2,
      external_id: indexes.id >= 0 ? columns[indexes.id]?.trim() : undefined,
      submitted_at: indexes.submitted >= 0 ? columns[indexes.submitted]?.trim() : undefined,
      email: columns[indexes.email]?.trim().replace('\\@', '@') || '',
      name: columns[indexes.name]?.trim() || '',
      start_date: toIsoDate(columns[indexes.start] || ''),
      end_date: toIsoDate(columns[indexes.end] || ''),
      business_days: toNumber(columns[indexes.days] || ''),
      opening_balance: toNumber(columns[indexes.balance] || ''),
    }
  })
}
