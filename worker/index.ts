import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { addDays, calendarDays, countBusinessDays, isoDate, vacationBalance, weekRange } from './domain'
import { supersededOverlaps } from './import-rules'

// Deployed through Cloudflare Workers Builds from the main branch.

type Bindings = { DB: D1Database; ASSETS: Fetcher; RESEND_API_KEY?: string; EMAIL_FROM?: string }
type Role = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE'
type User = {
  id: string; name: string; email: string; communication_email: string | null; role: Role; team_id: string | null; team_name?: string | null
  hire_date: string; balance_start_date: string; opening_vacation_balance: number
  monthly_accrual: number; vacation_debit_factor: number; active: number
}

type VacationImportRow = {
  line: number
  external_id?: string
  submitted_at?: string
  email: string
  communication_email?: string
  name: string
  start_date: string
  end_date: string
  business_days: number
  opening_balance: number
}

type VacationImportItem = VacationImportRow & {
  action: 'CREATE' | 'EXISTING' | 'SKIP' | 'REVIEW' | 'ERROR'
  message: string
  user_id?: string
  matched_by?: 'EMAIL' | 'NAME'
}

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>()
const jsonError = (message: string, status = 400) => ({ message, status })
const today = () => isoDate(new Date())
const encoder = new TextEncoder()

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const hasAtMostTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7
const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value
}
const cleanEmail = (value: string) => value.trim().replace('\\@', '@').toLowerCase()
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const normalizedName = (value: string) => value.trim().toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
const displayNameFromEmail = (email: string) => email.split('@')[0].split(/[._-]+/).filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ')
const submittedAtKey = (value?: string) => {
  const match = value?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  return match ? `${match[3]}${match[2]}${match[1]}${match[4]}${match[5]}` : ''
}

async function emailConflict(db: D1Database, registrationEmail: string, communicationEmail?: string | null, excludedId = '') {
  if (!validEmail(registrationEmail)) return 'Informe um e-mail de registro válido.'
  if (communicationEmail && !validEmail(communicationEmail)) return 'Informe um e-mail de comunicação válido.'
  if (communicationEmail && registrationEmail === communicationEmail) return 'Os e-mails de registro e comunicação devem ser diferentes.'
  const existing = await db.prepare(`SELECT id FROM users WHERE id <> ? AND (
    lower(email) = lower(?) OR lower(COALESCE(communication_email, '')) = lower(?)
    OR (? <> '' AND (lower(email) = lower(?) OR lower(COALESCE(communication_email, '')) = lower(?)))
  ) LIMIT 1`).bind(excludedId, registrationEmail, registrationEmail, communicationEmail || '', communicationEmail || '', communicationEmail || '')
    .first<{ id: string }>()
  return existing ? 'Um dos e-mails já pertence a outro usuário.' : null
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100_000 }, key, 256,
  )
  return bytesToHex(new Uint8Array(bits))
}

async function businessDays(db: D1Database, start: string, end: string, teamId: string | null) {
  const holidayRows = await db.prepare(
    `SELECT date, MAX(duration) duration FROM holidays WHERE date BETWEEN ? AND ? AND (team_id IS NULL OR team_id = ?) GROUP BY date`
  ).bind(start, end, teamId).all<{ date: string; duration: number }>()
  return countBusinessDays(start, end, new Map(holidayRows.results.map((row) => [row.date, Number(row.duration)])))
}

const statusLabels: Record<string, string> = {
  REQUESTED: 'Solicitada', APPROVED: 'Aprovada', QUANTUM_REGISTERED: 'Registrada no Quantum',
  QUANTUM_APPROVED: 'Aprovada no Quantum', REJECTED: 'Rejeitada', CANCELLED: 'Cancelada',
}
const absenceLabels: Record<string, string> = {
  VACATION: 'Férias', JUSTIFIED: 'Ausência justificada', UNJUSTIFIED: 'Ausência não justificada',
  PATERNITY: 'Licença-paternidade', MATERNITY: 'Licença-maternidade', ADMINISTRATIVE: 'Folga administrativa',
}
const formatDateBr = (value: string) => value.split('-').reverse().join('/')

async function sendEmail(
  db: D1Database,
  env: Bindings,
  input: { recipient: string; subject: string; body: string; requestId?: string; communicationId?: string },
) {
  const id = crypto.randomUUID()
  await db.prepare(`INSERT INTO email_notifications
    (id, request_id, communication_id, recipient, subject, body) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.requestId || null, input.communicationId || null, input.recipient, input.subject, input.body).run()
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    await db.prepare(`UPDATE email_notifications SET status = 'SKIPPED', error = ? WHERE id = ?`)
      .bind('RESEND_API_KEY ou EMAIL_FROM não configurado.', id).run()
    return { id, status: 'SKIPPED' as const }
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.recipient], subject: input.subject, text: input.body }),
    })
    const result = await response.json<{ id?: string; message?: string }>()
    if (!response.ok) throw new Error(result.message || `Falha HTTP ${response.status}`)
    await db.prepare(`UPDATE email_notifications SET status = 'SENT', attempts = 1, provider_id = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(result.id || null, id).run()
    return { id, status: 'SENT' as const }
  } catch (error) {
    await db.prepare(`UPDATE email_notifications SET status = 'FAILED', attempts = 1, error = ? WHERE id = ?`)
      .bind(error instanceof Error ? error.message : 'Falha desconhecida.', id).run()
    return { id, status: 'FAILED' as const }
  }
}

async function notifyRequestStatus(db: D1Database, env: Bindings, requestId: string, actorName: string, note?: string) {
  const request = await db.prepare(`SELECT r.*, u.name user_name, COALESCE(NULLIF(u.communication_email, ''), u.email) recipient_email FROM absence_requests r
    JOIN users u ON u.id = r.user_id WHERE r.id = ?`).bind(requestId).first<{
      id: string; type: string; start_date: string; end_date: string; status: string; user_name: string; recipient_email: string
    }>()
  if (!request) return { status: 'SKIPPED' as const }
  const body = `Olá, ${request.user_name}.\n\nSua solicitação de ${absenceLabels[request.type]}, referente ao período de ${formatDateBr(request.start_date)} a ${formatDateBr(request.end_date)}, foi atualizada.\n\nNovo status: ${statusLabels[request.status]}\nAtualizado por: ${actorName}\nData da atualização: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${note ? `\n\nObservação:\n${note}` : ''}`
  return sendEmail(db, env, { recipient: request.recipient_email, subject: 'Atualização da sua solicitação de ausência', body, requestId })
}

async function applyFinalBalanceEntries(db: D1Database, requestId: string, actorId: string) {
  const request = await db.prepare(`SELECT r.*, u.team_id FROM absence_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(requestId).first<{ id: string; user_id: string; team_id: string | null; type: string; start_date: string; end_date: string; administrative_days: number }>()
  if (!request) return
  const holidays = await db.prepare(`SELECT * FROM holidays WHERE date BETWEEN ? AND ? AND generates_admin_credit = 1
    AND (team_id IS NULL OR team_id = ?) ORDER BY date, duration DESC`)
    .bind(request.start_date, request.end_date, request.team_id).all<{ id: string; date: string; duration: number }>()
  const holidayByDate = new Map<string, { id: string; duration: number }>()
  for (const holiday of holidays.results) if (!holidayByDate.has(holiday.date)) holidayByDate.set(holiday.date, holiday)
  const statements: D1PreparedStatement[] = []
  for (const holiday of holidayByDate.values()) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO administrative_balance_entries
      (id, user_id, holiday_id, request_id, amount, entry_type, note, created_by)
      VALUES (?, ?, ?, ?, ?, 'AUTOMATIC_ABSENCE', ?, ?)`)
      .bind(crypto.randomUUID(), request.user_id, holiday.id, request.id, Number(holiday.duration), 'Crédito automático por ausência em feriado.', actorId))
  }
  if (request.type === 'ADMINISTRATIVE' && Number(request.administrative_days) > 0) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO administrative_balance_entries
      (id, user_id, request_id, amount, entry_type, note, created_by)
      VALUES (?, ?, ?, ?, 'USAGE', ?, ?)`)
      .bind(crypto.randomUUID(), request.user_id, request.id, -Number(request.administrative_days), 'Utilização de saldo administrativo.', actorId))
  }
  if (statements.length) await db.batch(statements)
}

type WeeklyRequest = {
  id: string; user_name: string; type: string; start_date: string; end_date: string;
  business_days: number; calendar_days: number; administrative_days: number; status: string
}

function weeklyRequestBlock(request: WeeklyRequest, includeStatus = false) {
  const duration = ['PATERNITY', 'MATERNITY'].includes(request.type)
    ? `${request.calendar_days} dias corridos`
    : request.type === 'ADMINISTRATIVE'
      ? `${request.administrative_days.toLocaleString('pt-BR')} dia(s)`
      : `${request.business_days.toLocaleString('pt-BR')} dias úteis`
  return `• ${request.user_name}\n  Ausência: ${absenceLabels[request.type]}\n  Período: ${formatDateBr(request.start_date)} a ${formatDateBr(request.end_date)}\n  Duração: ${duration}${includeStatus ? `\n  Status: ${statusLabels[request.status]}` : ''}`
}

function buildWeeklyBody(reference: string, requests: WeeklyRequest[]) {
  const range = weekRange(reference)
  const approved = requests.filter((request) => request.status === 'QUANTUM_APPROVED')
  const current = approved.filter((request) => request.start_date <= range.currentEnd && request.end_date >= range.currentStart)
  const next = approved.filter((request) => request.start_date <= range.nextEnd && request.end_date >= range.nextStart)
  const pending = requests.filter((request) => request.status !== 'QUANTUM_APPROVED')
  const section = (items: WeeklyRequest[], empty: string) => items.length ? items.map((item) => weeklyRequestBlock(item)).join('\n\n') : empty
  const pendingSection = pending.length ? pending.map((item) => weeklyRequestBlock(item, true)).join('\n\n') : 'Não há solicitações pendentes para o período.'
  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return {
    ...range,
    body: `COMUNICADO SEMANAL DE AUSÊNCIAS\n\nPeríodo considerado: ${formatDateBr(range.currentStart)} a ${formatDateBr(range.nextEnd)}\n\nSEMANA ATUAL — ${formatDateBr(range.currentStart)} a ${formatDateBr(range.currentEnd)}\n\n${section(current, 'Não há ausências com aprovação concluída no Quantum para esta semana.')}\n\nPRÓXIMA SEMANA — ${formatDateBr(range.nextStart)} a ${formatDateBr(range.nextEnd)}\n\n${section(next, 'Não há ausências com aprovação concluída no Quantum para esta semana.')}\n\nSOLICITAÇÕES PENDENTES\n\n${pendingSection}\n\nMensagem gerada em ${generatedAt}.`,
  }
}

const weeklySubject = '[PSE] COMUNICADO SEMANAL DE AUSÊNCIAS'

async function sendWeeklyEmailOnce(db: D1Database, env: Bindings, communicationId: string, recipient: string, body: string) {
  const alreadySent = await db.prepare(`SELECT id FROM email_notifications
    WHERE communication_id = ? AND recipient = ? COLLATE NOCASE AND subject = ? AND body = ? AND status = 'SENT' LIMIT 1`)
    .bind(communicationId, recipient, weeklySubject, body).first()
  if (alreadySent) return { status: 'ALREADY_SENT' as const }
  return sendEmail(db, env, { recipient, subject: weeklySubject, body, communicationId })
}

async function publishScheduledWeeklyCommunications(env: Bindings, scheduledAt: Date) {
  const reference = isoDate(scheduledAt)
  const generatedRange = weekRange(reference)
  const fallbackAdmin = await env.DB.prepare(`SELECT id FROM users WHERE role = 'ADMIN' AND active = 1
    ORDER BY created_at LIMIT 1`).first<{ id: string }>()
  if (!fallbackAdmin) throw new Error('Não existe administrador ativo para registrar a publicação automática.')

  const teams = await env.DB.prepare('SELECT id FROM teams ORDER BY name').all<{ id: string }>()
  for (const team of teams.results) {
    const supervisors = await env.DB.prepare(`SELECT id, COALESCE(NULLIF(communication_email, ''), email) email FROM users
      WHERE role = 'SUPERVISOR' AND active = 1 AND team_id = ? ORDER BY name`)
      .bind(team.id).all<{ id: string; email: string }>()
    const actorId = supervisors.results[0]?.id || fallbackAdmin.id
    const requests = await env.DB.prepare(`SELECT r.*, u.name user_name FROM absence_requests r
      JOIN users u ON u.id = r.user_id
      WHERE r.start_date <= ? AND r.end_date >= ? AND r.status NOT IN ('REJECTED', 'CANCELLED')
        AND r.type = 'VACATION' AND u.team_id = ?
      ORDER BY r.start_date, u.name`)
      .bind(generatedRange.nextEnd, generatedRange.currentStart, team.id).all<WeeklyRequest>()
    const generated = buildWeeklyBody(reference, requests.results)
    const existing = await env.DB.prepare(`SELECT id, draft_body, published_body, published_at
      FROM weekly_communications WHERE period_start = ? AND team_id = ?`)
      .bind(generated.currentStart, team.id).first<{
        id: string; draft_body: string; published_body: string | null; published_at: string | null
      }>()
    const communicationId = existing?.id || crypto.randomUUID()
    const publishedBody = generated.body

    if (!existing) {
      await env.DB.prepare(`INSERT INTO weekly_communications
        (id, team_id, period_start, period_end, subject, draft_body, published_body, created_by, published_by, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(communicationId, team.id, generated.currentStart, generated.nextEnd, weeklySubject,
          publishedBody, publishedBody, actorId, actorId).run()
    } else {
      await env.DB.prepare(`UPDATE weekly_communications SET draft_body = ?, published_body = ?, published_by = ?,
        published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(publishedBody, publishedBody, actorId, communicationId).run()
    }

    const results = await Promise.all(supervisors.results.map((supervisor) =>
      sendWeeklyEmailOnce(env.DB, env, communicationId, supervisor.email, publishedBody)))
    await audit(env.DB, actorId, 'AUTO_PUBLISH', 'WEEKLY_COMMUNICATION', communicationId, {
      recipients: supervisors.results.length,
      sent: results.filter((result) => result.status === 'SENT').length,
      alreadySent: results.filter((result) => result.status === 'ALREADY_SENT').length,
    })
  }
}

async function audit(db: D1Database, actorId: string | null, action: string, entityType: string, entityId?: string, payload?: unknown) {
  await db.prepare(`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actorId, action, entityType, entityId ?? null, payload ? JSON.stringify(payload) : null).run()
}

async function analyzeVacationImport(db: D1Database, actor: User, teamId: string, sourceRows: VacationImportRow[]) {
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) throw new Error('Acesso restrito.')
  if (actor.role === 'SUPERVISOR' && actor.team_id !== teamId) throw new Error('O supervisor somente pode importar para a própria equipe.')
  const team = await db.prepare('SELECT id, name FROM teams WHERE id = ? AND active = 1').bind(teamId)
    .first<{ id: string; name: string }>()
  if (!team) throw new Error('Equipe não encontrada ou inativa.')
  if (!Array.isArray(sourceRows) || sourceRows.length === 0 || sourceRows.length > 500) {
    throw new Error('O CSV deve conter entre 1 e 500 registros.')
  }

  const rows: VacationImportItem[] = sourceRows.map((source, index) => {
    const email = cleanEmail(String(source.email || ''))
    const communicationEmail = cleanEmail(String(source.communication_email || '')) || undefined
    const suppliedName = String(source.name || '').trim()
    const name = !suppliedName || suppliedName.includes('@') ? displayNameFromEmail(email) : suppliedName
    return {
      line: Number(source.line || index + 2), external_id: String(source.external_id || '').trim() || undefined,
      submitted_at: String(source.submitted_at || '').trim() || undefined, email,
      communication_email: communicationEmail, name,
      start_date: String(source.start_date || '').trim(), end_date: String(source.end_date || '').trim(),
      business_days: typeof source.business_days === 'number' ? source.business_days : Number.NaN,
      opening_balance: typeof source.opening_balance === 'number' ? source.opening_balance : Number.NaN,
      action: 'CREATE', message: 'Pronto para importar.',
    }
  })

  const latestByEmail = new Map<string, VacationImportItem>()
  for (const row of rows) {
    const current = latestByEmail.get(row.email)
    const rowKey = submittedAtKey(row.submitted_at) || String(row.line).padStart(8, '0')
    const currentKey = current && (submittedAtKey(current.submitted_at) || String(current.line).padStart(8, '0'))
    if (!current || rowKey >= currentKey!) latestByEmail.set(row.email, row)
  }

  const allUsers = await db.prepare('SELECT id, name, email, communication_email, team_id FROM users')
    .all<Pick<User, 'id' | 'name' | 'email' | 'communication_email' | 'team_id'>>()
  const userByAnyEmail = new Map<string, typeof allUsers.results[number]>()
  for (const existing of allUsers.results) {
    userByAnyEmail.set(existing.email.toLowerCase(), existing)
    if (existing.communication_email) userByAnyEmail.set(existing.communication_email.toLowerCase(), existing)
  }
  const teamUsersByName = new Map<string, typeof allUsers.results>()
  for (const existing of allUsers.results.filter((item) => item.team_id === teamId)) {
    const key = normalizedName(existing.name)
    teamUsersByName.set(key, [...(teamUsersByName.get(key) || []), existing])
  }
  const users = [...latestByEmail.values()].map((row): VacationImportItem => {
    if (!row.email || !validEmail(row.email)) return { ...row, action: 'ERROR', message: 'E-mail de registro inválido.' }
    if (row.communication_email && !validEmail(row.communication_email)) return { ...row, action: 'ERROR', message: 'E-mail de comunicação inválido.' }
    if (row.communication_email === row.email) return { ...row, action: 'ERROR', message: 'Os e-mails de registro e comunicação devem ser diferentes.' }
    if (!row.name) return { ...row, action: 'ERROR', message: 'Nome não identificado.' }
    if (!Number.isFinite(row.opening_balance) || row.opening_balance < 0 || !hasAtMostTwoDecimals(row.opening_balance)) {
      return { ...row, action: 'ERROR', message: 'O saldo deve ser positivo e possuir no máximo duas casas decimais.' }
    }
    const directRegistration = userByAnyEmail.get(row.email)
    const directCommunication = row.communication_email ? userByAnyEmail.get(row.communication_email) : undefined
    if (directRegistration && directCommunication && directRegistration.id !== directCommunication.id) {
      return { ...row, action: 'ERROR', message: 'Os e-mails informados pertencem a usuários diferentes.' }
    }
    let existing = directRegistration || directCommunication
    let matchedBy: 'EMAIL' | 'NAME' = 'EMAIL'
    if (!existing) {
      const nameMatches = teamUsersByName.get(normalizedName(row.name)) || []
      if (nameMatches.length > 1) return { ...row, action: 'ERROR', message: 'Há mais de um colaborador com este nome na equipe; informe os dois e-mails no CSV.' }
      existing = nameMatches[0]
      matchedBy = 'NAME'
    }
    if (existing && existing.team_id !== teamId) return { ...row, action: 'ERROR', message: 'O e-mail já pertence a outra equipe.' }
    if (existing) {
      const registrationOwner = userByAnyEmail.get(row.email)
      const communicationOwner = row.communication_email ? userByAnyEmail.get(row.communication_email) : undefined
      if ((registrationOwner && registrationOwner.id !== existing.id) || (communicationOwner && communicationOwner.id !== existing.id)) {
        return { ...row, action: 'ERROR', message: 'Um dos e-mails já pertence a outro usuário.' }
      }
      const inferredCommunication = !row.communication_email && matchedBy === 'NAME' && existing.email.endsWith('@cnj.jus.br')
        ? existing.email : row.communication_email || existing.communication_email || undefined
      return {
        ...row, communication_email: inferredCommunication, user_id: existing.id, matched_by: matchedBy,
        action: 'EXISTING',
        message: matchedBy === 'NAME'
          ? 'Colaborador associado pelo nome; o e-mail de registro será atualizado.'
          : 'Colaborador já cadastrado; e-mails ausentes serão complementados.',
      }
    }
    return { ...row, opening_balance: round2(row.opening_balance), action: 'CREATE', message: 'Novo colaborador.' }
  })
  const desiredEmailOwner = new Map<string, VacationImportItem>()
  for (const item of users.filter((candidate) => candidate.action !== 'ERROR')) {
    for (const candidateEmail of [item.email, item.communication_email].filter(Boolean) as string[]) {
      const prior = desiredEmailOwner.get(candidateEmail)
      if (prior && prior.email !== item.email) {
        item.action = 'ERROR'; item.message = 'O mesmo e-mail foi informado para mais de um colaborador no CSV.'
        prior.action = 'ERROR'; prior.message = item.message
      } else desiredEmailOwner.set(candidateEmail, item)
    }
  }
  const userResultByEmail = new Map(users.map((row) => [row.email, row]))

  for (const row of rows) {
    if (!isIsoDate(row.start_date) || !isIsoDate(row.end_date)) {
      row.action = 'ERROR'; row.message = 'Data inicial ou final inválida.'; continue
    }
    if (row.end_date < today()) {
      row.action = 'SKIP'; row.message = 'Período já encerrado.'; continue
    }
    if (row.end_date < row.start_date) {
      row.action = 'ERROR'; row.message = 'A data final é anterior à data inicial.'; continue
    }
    if (!Number.isFinite(row.business_days) || row.business_days <= 0 || !hasAtMostTwoDecimals(row.business_days)) {
      row.action = 'ERROR'; row.message = 'A quantidade de dias úteis deve ser positiva e possuir no máximo duas casas decimais.'; continue
    }
    if (row.business_days > calendarDays(row.start_date, row.end_date)) {
      row.action = 'ERROR'; row.message = 'A quantidade de dias úteis é maior que o período informado.'; continue
    }
    const userResult = userResultByEmail.get(row.email)
    if (!userResult || userResult.action === 'ERROR') {
      row.action = 'ERROR'; row.message = userResult?.message || 'Colaborador inválido.'
    } else row.user_id = userResult.user_id
  }

  const superseded = supersededOverlaps(rows.filter((item) => item.action === 'CREATE'))
  for (const row of rows) {
    const newerLine = superseded.get(row.line)
    if (newerLine) { row.action = 'SKIP'; row.message = `Substituído pelo registro mais recente da linha ${newerLine}.` }
  }

  const existingRequests = await db.prepare(`SELECT r.id, r.user_id, r.start_date, r.end_date, u.email
    FROM absence_requests r JOIN users u ON u.id = r.user_id
    WHERE r.type = 'VACATION' AND r.status NOT IN ('REJECTED', 'CANCELLED') AND u.team_id = ?`)
    .bind(teamId).all<{ id: string; user_id: string; start_date: string; end_date: string; email: string }>()
  for (const row of rows.filter((item) => item.action === 'CREATE')) {
    const matches = existingRequests.results.filter((item) => (row.user_id ? item.user_id === row.user_id : item.email.toLowerCase() === row.email)
      && row.start_date <= item.end_date && row.end_date >= item.start_date)
    if (matches.some((item) => item.start_date === row.start_date && item.end_date === row.end_date)) {
      row.action = 'SKIP'; row.message = 'Solicitação já cadastrada.'
    } else if (matches.length) {
      row.action = 'REVIEW'; row.message = 'O período sobrepõe uma solicitação já existente no sistema.'
    }
  }

  return {
    team,
    users,
    requests: rows,
    summary: {
      users_to_create: users.filter((item) => item.action === 'CREATE').length,
      users_existing: users.filter((item) => item.action === 'EXISTING').length,
      requests_to_create: rows.filter((item) => item.action === 'CREATE').length,
      requests_skipped: rows.filter((item) => item.action === 'SKIP').length,
      review_or_error: [...users, ...rows].filter((item) => ['REVIEW', 'ERROR'].includes(item.action)).length,
    },
  }
}

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  await next()
})

app.get('/api/status', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>()
  return c.json({ needsSetup: Number(row?.count ?? 0) === 0 })
})

app.post('/api/setup', async (c) => {
  const existing = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>()
  if (Number(existing?.count ?? 0) > 0) return c.json(jsonError('A configuração inicial já foi realizada.', 409), 409)
  const body = await c.req.json<{ name: string; email: string; communication_email?: string; password: string; teamName?: string }>()
  if (!body.name || !body.email || !body.password || body.password.length < 10) {
    return c.json(jsonError('Informe nome, e-mail e uma senha com pelo menos 10 caracteres.'), 400)
  }
  const registrationEmail = cleanEmail(body.email)
  const communicationEmail = cleanEmail(body.communication_email || '') || null
  const conflict = await emailConflict(c.env.DB, registrationEmail, communicationEmail)
  if (conflict) return c.json(jsonError(conflict), 400)
  const teamId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const salt = crypto.randomUUID()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').bind(teamId, body.teamName?.trim() || 'Equipe principal'),
    c.env.DB.prepare(`INSERT INTO users
      (id, name, email, communication_email, password_hash, password_salt, role, team_id, hire_date, balance_start_date)
      VALUES (?, ?, ?, ?, ?, ?, 'ADMIN', ?, ?, ?)`)
      .bind(userId, body.name.trim(), registrationEmail, communicationEmail, await passwordHash(body.password, salt), salt, teamId, today(), today()),
  ])
  await audit(c.env.DB, userId, 'SETUP', 'SYSTEM')
  return c.json({ ok: true }, 201)
})

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>()
  const row = await c.env.DB.prepare(`SELECT * FROM users
    WHERE (email = ? COLLATE NOCASE OR communication_email = ? COLLATE NOCASE) AND active = 1`)
    .bind(body.email?.trim(), body.email?.trim()).first<User & { password_hash: string; password_salt: string }>()
  if (!row || await passwordHash(body.password ?? '', row.password_salt) !== row.password_hash) {
    return c.json(jsonError('E-mail ou senha inválidos.', 401), 401)
  }
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
  const expiresAt = addDays(new Date(), 7).toISOString()
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), row.id, expiresAt).run()
  setCookie(c, 'absence_session', token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 604800 })
  await audit(c.env.DB, row.id, 'LOGIN', 'SESSION')
  return c.json({ ok: true })
})

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, 'absence_session')
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  deleteCookie(c, 'absence_session', { path: '/' })
  return c.json({ ok: true })
})

app.use('/api/*', async (c, next) => {
  const token = getCookie(c, 'absence_session')
  if (!token) return c.json(jsonError('Autenticação necessária.', 401), 401)
  const user = await c.env.DB.prepare(`SELECT u.*, t.name AS team_name FROM sessions s
    JOIN users u ON u.id = s.user_id LEFT JOIN teams t ON t.id = u.team_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.active = 1`)
    .bind(await sha256(token)).first<User>()
  if (!user) return c.json(jsonError('Sessão expirada.', 401), 401)
  c.set('user', user)
  await next()
})

app.get('/api/me', (c) => c.json({ user: c.get('user') }))

app.get('/api/teams', async (c) => {
  const teams = await c.env.DB.prepare(`SELECT t.*, COUNT(u.id) AS members FROM teams t LEFT JOIN users u ON u.team_id = t.id AND u.active = 1 GROUP BY t.id ORDER BY t.name`).all()
  return c.json({ teams: teams.results })
})

app.post('/api/teams', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'ADMIN') return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ name: string }>()
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').bind(id, body.name.trim()).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'TEAM', id, body)
  return c.json({ id }, 201)
})

app.get('/api/users', async (c) => {
  const actor = c.get('user')
  const condition = actor.role === 'EMPLOYEE' ? 'WHERE u.id = ?' : actor.role === 'SUPERVISOR' ? 'WHERE u.team_id = ?' : ''
  const query = c.env.DB.prepare(`SELECT u.id, u.name, u.email, u.communication_email, u.role, u.team_id, t.name team_name, u.active,
    u.hire_date, u.balance_start_date, u.opening_vacation_balance, u.monthly_accrual, u.vacation_debit_factor
    FROM users u LEFT JOIN teams t ON t.id = u.team_id ${condition} ORDER BY u.name`)
  const rows = actor.role === 'ADMIN' ? await query.all<User>() : await query.bind(actor.role === 'EMPLOYEE' ? actor.id : actor.team_id).all<User>()
  return c.json({ users: rows.results })
})

app.post('/api/users', async (c) => {
  const actor = c.get('user')
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<Partial<User> & { password: string }>()
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id
  const role = actor.role === 'SUPERVISOR' ? 'EMPLOYEE' : body.role
  if (!body.name || !body.email || !body.password || !teamId || !role) return c.json(jsonError('Preencha os campos obrigatórios.'), 400)
  if (body.password.length < 10) return c.json(jsonError('A senha temporária deve ter pelo menos 10 caracteres.'), 400)
  const openingBalance = Number(body.opening_vacation_balance ?? 0)
  if (!Number.isFinite(openingBalance) || openingBalance < 0 || !hasAtMostTwoDecimals(openingBalance)) {
    return c.json(jsonError('O saldo inicial deve ser positivo e possuir no máximo duas casas decimais.'), 400)
  }
  const registrationEmail = cleanEmail(body.email)
  const communicationEmail = cleanEmail(body.communication_email || '') || null
  const conflict = await emailConflict(c.env.DB, registrationEmail, communicationEmail)
  if (conflict) return c.json(jsonError(conflict), 409)
  const id = crypto.randomUUID(); const salt = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO users
    (id, name, email, communication_email, password_hash, password_salt, role, team_id, hire_date, balance_start_date, opening_vacation_balance, monthly_accrual, vacation_debit_factor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, body.name.trim(), registrationEmail, communicationEmail, await passwordHash(body.password, salt), salt, role, teamId,
      body.hire_date || today(), body.balance_start_date || today(), round2(openingBalance), Number(body.monthly_accrual || 2.5), Number(body.vacation_debit_factor || 1)).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'USER', id, { ...body, password: undefined })
  return c.json({ id }, 201)
})

app.patch('/api/users/:id', async (c) => {
  const actor = c.get('user')
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) return c.json(jsonError('Acesso restrito.', 403), 403)
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first<User>()
  if (!target) return c.json(jsonError('Colaborador não encontrado.', 404), 404)
  if (actor.role === 'SUPERVISOR' && (target.team_id !== actor.team_id || target.role === 'ADMIN')) {
    return c.json(jsonError('O supervisor somente pode alterar colaboradores da própria equipe.', 403), 403)
  }
  const body = await c.req.json<Partial<User> & { password?: string }>()
  if (body.role && !['ADMIN', 'SUPERVISOR', 'EMPLOYEE'].includes(body.role)) return c.json(jsonError('Perfil inválido.'), 400)
  const role = actor.role === 'ADMIN' && body.role ? body.role : target.role
  const teamId = actor.role === 'SUPERVISOR' ? target.team_id : body.team_id
  if (!body.name || !body.email || !teamId || !body.hire_date || !body.balance_start_date) {
    return c.json(jsonError('Preencha os campos obrigatórios.'), 400)
  }
  const openingBalance = Number(body.opening_vacation_balance ?? 0)
  if (!Number.isFinite(openingBalance) || openingBalance < 0 || !hasAtMostTwoDecimals(openingBalance)) {
    return c.json(jsonError('O saldo inicial deve ser positivo e possuir no máximo duas casas decimais.'), 400)
  }
  const registrationEmail = cleanEmail(body.email)
  const communicationEmail = cleanEmail(body.communication_email || '') || null
  const conflict = await emailConflict(c.env.DB, registrationEmail, communicationEmail, target.id)
  if (conflict) return c.json(jsonError(conflict), 409)
  if (target.id === actor.id && !body.active) return c.json(jsonError('Você não pode inativar a própria conta.'), 409)
  if (target.role === 'ADMIN' && !body.active) {
    const admins = await c.env.DB.prepare(`SELECT COUNT(*) count FROM users WHERE role = 'ADMIN' AND active = 1 AND id <> ?`)
      .bind(target.id).first<{ count: number }>()
    if (Number(admins?.count ?? 0) === 0) return c.json(jsonError('O sistema deve manter pelo menos um administrador ativo.'), 409)
  }
  const statements = [c.env.DB.prepare(`UPDATE users SET name = ?, email = ?, communication_email = ?, role = ?, team_id = ?, active = ?,
    hire_date = ?, balance_start_date = ?, opening_vacation_balance = ?, monthly_accrual = ?, vacation_debit_factor = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      body.name.trim(), registrationEmail, communicationEmail, role, teamId, body.active ? 1 : 0,
      body.hire_date, body.balance_start_date, round2(openingBalance),
      Number(body.monthly_accrual ?? 2.5), Number(body.vacation_debit_factor ?? 1), target.id,
    )]
  if (body.password) {
    if (body.password.length < 10) return c.json(jsonError('A nova senha deve ter pelo menos 10 caracteres.'), 400)
    const salt = crypto.randomUUID()
    statements.push(c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .bind(await passwordHash(body.password, salt), salt, target.id))
  }
  await c.env.DB.batch(statements)
  if (!body.active) await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run()
  await audit(c.env.DB, actor.id, 'UPDATE', 'USER', target.id, { ...body, password: body.password ? '[ALTERADA]' : undefined })
  return c.json({ ok: true })
})

app.post('/api/users/vacation-import/preview', async (c) => {
  const actor = c.get('user')
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ team_id?: string; rows: VacationImportRow[] }>()
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id
  if (!teamId) return c.json(jsonError('Selecione a equipe que receberá a importação.'), 400)
  try {
    return c.json(await analyzeVacationImport(c.env.DB, actor, teamId, body.rows))
  } catch (error) {
    return c.json(jsonError(error instanceof Error ? error.message : 'Não foi possível analisar o CSV.'), 400)
  }
})

app.post('/api/users/vacation-import', async (c) => {
  const actor = c.get('user')
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ team_id?: string; rows: VacationImportRow[] }>()
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id
  if (!teamId) return c.json(jsonError('Selecione a equipe que receberá a importação.'), 400)
  try {
    const preview = await analyzeVacationImport(c.env.DB, actor, teamId, body.rows)
    const usersToCreate = preview.users.filter((item) => item.action === 'CREATE')
    const usersToUpdate = preview.users.filter((item) => item.action === 'EXISTING' && item.user_id)
    const defaultPassword = '1234567890'
    const userStatements: D1PreparedStatement[] = []
    for (const item of usersToUpdate) {
      userStatements.push(c.env.DB.prepare(`UPDATE users SET email = ?, communication_email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`).bind(item.email, item.communication_email || null, item.user_id))
    }
    for (const item of usersToCreate) {
      const id = crypto.randomUUID(); const salt = crypto.randomUUID()
      userStatements.push(c.env.DB.prepare(`INSERT INTO users
        (id, name, email, communication_email, password_hash, password_salt, role, team_id, hire_date, balance_start_date,
          opening_vacation_balance, monthly_accrual, vacation_debit_factor)
        VALUES (?, ?, ?, ?, ?, ?, 'EMPLOYEE', ?, ?, ?, ?, 2.5, 1)`)
        .bind(id, item.name.trim(), item.email, item.communication_email || null, await passwordHash(defaultPassword, salt), salt, teamId,
          today(), today(), round2(item.opening_balance)))
    }
    for (let index = 0; index < userStatements.length; index += 50) await c.env.DB.batch(userStatements.slice(index, index + 50))

    const teamUsers = await c.env.DB.prepare(`SELECT id, email, vacation_debit_factor FROM users WHERE team_id = ?`)
      .bind(teamId).all<{ id: string; email: string; vacation_debit_factor: number }>()
    const userByEmail = new Map(teamUsers.results.map((user) => [user.email.toLowerCase(), user]))
    const requestsToCreate = preview.requests.filter((item) => item.action === 'CREATE')
    const requestStatements: D1PreparedStatement[] = []
    for (const item of requestsToCreate) {
      const target = userByEmail.get(item.email)
      if (!target) continue
      const requestId = crypto.randomUUID()
      const days = round2(item.business_days)
      requestStatements.push(c.env.DB.prepare(`INSERT INTO absence_requests
        (id, user_id, created_by, type, start_date, end_date, business_days, calendar_days,
          debit_days, administrative_days, status, reason)
        VALUES (?, ?, ?, 'VACATION', ?, ?, ?, ?, ?, 0, 'REQUESTED', NULL)`)
        .bind(requestId, target.id, actor.id, item.start_date, item.end_date, days,
          calendarDays(item.start_date, item.end_date), round2(days * Number(target.vacation_debit_factor))))
      requestStatements.push(c.env.DB.prepare(`INSERT INTO request_status_history
        (id, request_id, actor_id, previous_status, new_status, note)
        VALUES (?, ?, ?, NULL, 'REQUESTED', 'Solicitação importada de CSV.')`)
        .bind(crypto.randomUUID(), requestId, actor.id))
    }
    for (let index = 0; index < requestStatements.length; index += 50) await c.env.DB.batch(requestStatements.slice(index, index + 50))
    await audit(c.env.DB, actor.id, 'IMPORT', 'VACATION_CSV', undefined, {
      team_id: teamId, users_created: usersToCreate.length, requests_created: requestsToCreate.length,
      skipped: preview.summary.requests_skipped, review_or_error: preview.summary.review_or_error,
    })
    return c.json({
      users_created: usersToCreate.length,
      users_existing: preview.summary.users_existing,
      requests_created: requestsToCreate.length,
      requests_skipped: preview.summary.requests_skipped,
      review_or_error: preview.summary.review_or_error,
    }, 201)
  } catch (error) {
    return c.json(jsonError(error instanceof Error ? error.message : 'Não foi possível importar o CSV.'), 400)
  }
})

app.get('/api/holidays', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT h.*, t.name team_name FROM holidays h LEFT JOIN teams t ON t.id = h.team_id ORDER BY h.date`).all()
  return c.json({ holidays: rows.results })
})

app.post('/api/holidays', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ date: string; name: string; team_id?: string | null; duration?: number; generates_admin_credit?: boolean }>()
  const duration = Number(body.duration ?? 1)
  if (![0.5, 1].includes(duration)) return c.json(jsonError('A duração deve ser de meio período ou dia inteiro.'), 400)
  const id = crypto.randomUUID()
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id || null
  await c.env.DB.prepare(`INSERT INTO holidays (id, date, name, team_id, duration, generates_admin_credit)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, body.date, body.name.trim(), teamId, duration, body.generates_admin_credit === false ? 0 : 1).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'HOLIDAY', id, body)
  return c.json({ id }, 201)
})

app.patch('/api/holidays/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const current = await c.env.DB.prepare('SELECT * FROM holidays WHERE id = ?').bind(c.req.param('id')).first<{ id: string; team_id: string | null }>()
  if (!current || (actor.role === 'SUPERVISOR' && current.team_id !== actor.team_id)) return c.json(jsonError('Feriado não encontrado.', 404), 404)
  const body = await c.req.json<{ date: string; name: string; team_id?: string | null; duration?: number; generates_admin_credit?: boolean }>()
  const duration = Number(body.duration ?? 1)
  if (![0.5, 1].includes(duration)) return c.json(jsonError('A duração deve ser de meio período ou dia inteiro.'), 400)
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id || null
  await c.env.DB.prepare(`UPDATE holidays SET date = ?, name = ?, team_id = ?, duration = ?, generates_admin_credit = ? WHERE id = ?`)
    .bind(body.date, body.name.trim(), teamId, duration, body.generates_admin_credit === false ? 0 : 1, current.id).run()
  await audit(c.env.DB, actor.id, 'UPDATE', 'HOLIDAY', current.id, body)
  return c.json({ ok: true })
})

app.delete('/api/holidays/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const current = await c.env.DB.prepare('SELECT * FROM holidays WHERE id = ?').bind(c.req.param('id')).first<{ id: string; team_id: string | null }>()
  if (!current || (actor.role === 'SUPERVISOR' && current.team_id !== actor.team_id)) return c.json(jsonError('Feriado não encontrado.', 404), 404)
  await c.env.DB.prepare('DELETE FROM holidays WHERE id = ?').bind(current.id).run()
  await audit(c.env.DB, actor.id, 'DELETE', 'HOLIDAY', current.id)
  return c.json({ ok: true })
})

app.post('/api/holidays/import', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ holidays: Array<{ date: string; name: string; team_id?: string | null; duration?: number; generates_admin_credit?: boolean }> }>()
  if (!Array.isArray(body.holidays) || body.holidays.length === 0 || body.holidays.length > 400) {
    return c.json(jsonError('Envie entre 1 e 400 feriados.'), 400)
  }
  const statements: D1PreparedStatement[] = []
  for (const item of body.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.name?.trim()) return c.json(jsonError('O CSV contém data ou descrição inválida.'), 400)
    const duration = Number(item.duration ?? 1)
    if (![0.5, 1].includes(duration)) return c.json(jsonError('O CSV contém uma duração diferente de 0,5 ou 1.'), 400)
    const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : item.team_id || null
    if (teamId === null) statements.push(c.env.DB.prepare('DELETE FROM holidays WHERE date = ? AND team_id IS NULL').bind(item.date))
    statements.push(c.env.DB.prepare(`INSERT OR REPLACE INTO holidays
      (id, date, name, team_id, duration, generates_admin_credit) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), item.date, item.name.trim(), teamId, duration, item.generates_admin_credit === false ? 0 : 1))
  }
  await c.env.DB.batch(statements)
  await audit(c.env.DB, actor.id, 'IMPORT', 'HOLIDAY', undefined, { count: body.holidays.length })
  return c.json({ imported: body.holidays.length }, 201)
})

app.get('/api/requests', async (c) => {
  const actor = c.get('user')
  const scope = actor.role === 'ADMIN' ? '' : actor.role === 'SUPERVISOR' ? 'AND u.team_id = ?' : 'AND r.user_id = ?'
  const query = c.env.DB.prepare(`SELECT r.*, u.name user_name, u.email, t.name team_name, creator.name created_by_name
    FROM absence_requests r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.id = u.team_id
    JOIN users creator ON creator.id = r.created_by WHERE 1=1 ${scope} ORDER BY r.start_date DESC, r.created_at DESC`)
  const rows = actor.role === 'ADMIN' ? await query.all() : await query.bind(actor.role === 'SUPERVISOR' ? actor.team_id : actor.id).all()
  return c.json({ requests: rows.results })
})

app.post('/api/requests', async (c) => {
  const actor = c.get('user')
  const body = await c.req.json<{ user_id?: string; type: string; start_date: string; end_date: string; reason?: string; administrative_days?: number }>()
  if (!['VACATION', 'JUSTIFIED', 'UNJUSTIFIED', 'PATERNITY', 'MATERNITY', 'ADMINISTRATIVE'].includes(body.type)) {
    return c.json(jsonError('Tipo de ausência inválido.'), 400)
  }
  const userId = actor.role === 'EMPLOYEE' ? actor.id : body.user_id || actor.id
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND active = 1').bind(userId).first<User>()
  if (!target) return c.json(jsonError('Colaborador não encontrado.', 404), 404)
  if (actor.role === 'SUPERVISOR' && target.team_id !== actor.team_id) return c.json(jsonError('Colaborador fora da sua equipe.', 403), 403)
  if (!body.start_date || !body.end_date || body.end_date < body.start_date) return c.json(jsonError('Período inválido.'), 400)
  const calDays = calendarDays(body.start_date, body.end_date)
  const bizDays = await businessDays(c.env.DB, body.start_date, body.end_date, target.team_id)
  const limits: Record<string, number> = { UNJUSTIFIED: 4, JUSTIFIED: 15, PATERNITY: 30, MATERNITY: 150 }
  const counted = ['PATERNITY', 'MATERNITY'].includes(body.type) ? calDays : bizDays
  if (limits[body.type] && counted > limits[body.type]) return c.json(jsonError(`O período excede o limite de ${limits[body.type]} dias.`), 400)
  if (['JUSTIFIED', 'UNJUSTIFIED'].includes(body.type)) {
    const year = body.start_date.slice(0, 4)
    const used = await c.env.DB.prepare(`SELECT COALESCE(SUM(business_days), 0) total FROM absence_requests
      WHERE user_id = ? AND type = ? AND status IN ('REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED', 'QUANTUM_APPROVED') AND substr(start_date, 1, 4) = ?`)
      .bind(userId, body.type, year).first<{ total: number }>()
    if (Number(used?.total ?? 0) + bizDays > limits[body.type]) return c.json(jsonError(`Saldo anual insuficiente. Limite: ${limits[body.type]} dias úteis.`), 400)
  }
  const administrativeDays = body.type === 'ADMINISTRATIVE' ? Number(body.administrative_days ?? bizDays) : 0
  if (body.type === 'ADMINISTRATIVE') {
    if (administrativeDays <= 0 || administrativeDays > bizDays || !Number.isInteger(administrativeDays * 2)) {
      return c.json(jsonError('A utilização administrativa deve respeitar incrementos de meio dia e o período informado.'), 400)
    }
    const ledger = await c.env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) balance FROM administrative_balance_entries WHERE user_id = ?`)
      .bind(userId).first<{ balance: number }>()
    const reserved = await c.env.DB.prepare(`SELECT COALESCE(SUM(administrative_days), 0) total FROM absence_requests
      WHERE user_id = ? AND type = 'ADMINISTRATIVE' AND status IN ('REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED')`)
      .bind(userId).first<{ total: number }>()
    if (administrativeDays > Number(ledger?.balance ?? 0) - Number(reserved?.total ?? 0)) {
      return c.json(jsonError('Saldo administrativo insuficiente para esta solicitação.'), 409)
    }
  }
  const debit = body.type === 'VACATION' ? bizDays * Number(target.vacation_debit_factor) : 0
  const id = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO absence_requests
    (id, user_id, created_by, type, start_date, end_date, business_days, calendar_days, debit_days, administrative_days, status, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?)`)
    .bind(id, userId, actor.id, body.type, body.start_date, body.end_date, bizDays, calDays, debit, administrativeDays, body.reason || null).run()
  await c.env.DB.prepare(`INSERT INTO request_status_history (id, request_id, actor_id, previous_status, new_status, note)
    VALUES (?, ?, ?, NULL, 'REQUESTED', ?)`)
    .bind(crypto.randomUUID(), id, actor.id, body.reason || null).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'ABSENCE_REQUEST', id, body)
  const email = await notifyRequestStatus(c.env.DB, c.env, id, actor.name, body.reason)
  return c.json({ id, business_days: bizDays, calendar_days: calDays, debit_days: debit, administrative_days: administrativeDays, email_status: email.status }, 201)
})

app.patch('/api/requests/:id/status', async (c) => {
  const actor = c.get('user')
  const body = await c.req.json<{ status: string; note?: string }>()
  if (!['APPROVED', 'QUANTUM_REGISTERED', 'QUANTUM_APPROVED', 'REJECTED', 'CANCELLED'].includes(body.status)) {
    return c.json(jsonError('Status inválido.'), 400)
  }
  const request = await c.env.DB.prepare(`SELECT r.*, u.team_id FROM absence_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(c.req.param('id')).first<{ team_id: string; user_id: string; status: string }>()
  if (!request) return c.json(jsonError('Solicitação não encontrada.', 404), 404)
  const isTeamSupervisor = actor.role === 'SUPERVISOR' && request.team_id === actor.team_id
  if (body.status === 'CANCELLED') {
    if (!['REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED'].includes(request.status)) return c.json(jsonError('Esta solicitação não pode mais ser cancelada.'), 409)
    if (request.user_id !== actor.id && !isTeamSupervisor) return c.json(jsonError('Somente o solicitante ou o supervisor da equipe pode cancelar.'), 403)
    if (!body.note?.trim()) return c.json(jsonError('Informe a justificativa do cancelamento.'), 400)
  } else if (body.status === 'APPROVED' || body.status === 'REJECTED') {
    if (request.status !== 'REQUESTED') return c.json(jsonError('Somente solicitações em análise podem ser aprovadas ou rejeitadas.'), 409)
    if (!isTeamSupervisor) return c.json(jsonError('Somente o supervisor da equipe pode aprovar ou rejeitar.'), 403)
  } else if (body.status === 'QUANTUM_REGISTERED') {
    if (request.status !== 'APPROVED') return c.json(jsonError('A solicitação precisa estar aprovada pelo supervisor.'), 409)
    if (request.user_id !== actor.id && !isTeamSupervisor) return c.json(jsonError('Somente o solicitante ou o supervisor pode registrar no Quantum.'), 403)
  } else if (body.status === 'QUANTUM_APPROVED') {
    if (request.status !== 'QUANTUM_REGISTERED') return c.json(jsonError('A solicitação precisa estar registrada no Quantum.'), 409)
    if (!isTeamSupervisor) return c.json(jsonError('Somente o supervisor da equipe pode confirmar a aprovação no Quantum.'), 403)
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE absence_requests SET status = ?, supervisor_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(body.status, body.note || null, c.req.param('id')),
    c.env.DB.prepare(`INSERT INTO request_status_history
      (id, request_id, actor_id, previous_status, new_status, note) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), c.req.param('id'), actor.id, request.status, body.status, body.note || null),
  ])
  if (body.status === 'QUANTUM_APPROVED') await applyFinalBalanceEntries(c.env.DB, c.req.param('id'), actor.id)
  await audit(c.env.DB, actor.id, 'STATUS_CHANGE', 'ABSENCE_REQUEST', c.req.param('id'), body)
  const email = await notifyRequestStatus(c.env.DB, c.env, c.req.param('id'), actor.name, body.note)
  return c.json({ ok: true, email_status: email.status })
})

app.get('/api/requests/:id/history', async (c) => {
  const actor = c.get('user')
  const request = await c.env.DB.prepare(`SELECT r.user_id, u.team_id FROM absence_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(c.req.param('id')).first<{ user_id: string; team_id: string | null }>()
  if (!request) return c.json(jsonError('Solicitação não encontrada.', 404), 404)
  if (actor.role === 'EMPLOYEE' && request.user_id !== actor.id) return c.json(jsonError('Acesso restrito.', 403), 403)
  if (actor.role === 'SUPERVISOR' && request.team_id !== actor.team_id) return c.json(jsonError('Acesso restrito.', 403), 403)
  const history = await c.env.DB.prepare(`SELECT h.*, u.name actor_name FROM request_status_history h
    LEFT JOIN users u ON u.id = h.actor_id WHERE h.request_id = ? ORDER BY h.created_at`)
    .bind(c.req.param('id')).all()
  return c.json({ history: history.results })
})

app.get('/api/administrative-balances', async (c) => {
  const actor = c.get('user')
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : c.req.query('teamId') || null
  const userId = actor.role === 'EMPLOYEE' ? actor.id : c.req.query('userId') || null
  let where = 'WHERE 1=1'; const binds: Array<string> = []
  if (userId) { where += ' AND u.id = ?'; binds.push(userId) }
  if (teamId) { where += ' AND u.team_id = ?'; binds.push(teamId) }
  const balancesQuery = c.env.DB.prepare(`SELECT u.id user_id, u.name user_name, u.team_id, t.name team_name,
    COALESCE((SELECT SUM(e.amount) FROM administrative_balance_entries e WHERE e.user_id = u.id), 0) balance,
    COALESCE((SELECT SUM(r.administrative_days) FROM absence_requests r WHERE r.user_id = u.id AND r.type = 'ADMINISTRATIVE'
      AND r.status IN ('REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED')), 0) reserved
    FROM users u LEFT JOIN teams t ON t.id = u.team_id ${where} ORDER BY t.name, u.name`)
  const balances = binds.length ? await balancesQuery.bind(...binds).all() : await balancesQuery.all()
  const allowedIds = balances.results.map((row) => String((row as { user_id: string }).user_id))
  let entries: unknown[] = []
  if (allowedIds.length) {
    const placeholders = allowedIds.map(() => '?').join(',')
    const result = await c.env.DB.prepare(`SELECT e.*, u.name user_name, h.name holiday_name, h.date holiday_date,
      creator.name created_by_name FROM administrative_balance_entries e JOIN users u ON u.id = e.user_id
      LEFT JOIN holidays h ON h.id = e.holiday_id LEFT JOIN users creator ON creator.id = e.created_by
      WHERE e.user_id IN (${placeholders}) ORDER BY e.created_at DESC LIMIT 300`).bind(...allowedIds).all()
    entries = result.results
  }
  return c.json({ balances: balances.results, entries })
})

app.post('/api/administrative-balances/credits', async (c) => {
  const actor = c.get('user')
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ user_id: string; holiday_id: string; amount: number; note: string }>()
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(body.user_id).first<User>()
  if (!target || (actor.role === 'SUPERVISOR' && target.team_id !== actor.team_id)) return c.json(jsonError('Colaborador não encontrado na equipe.'), 404)
  const holiday = await c.env.DB.prepare('SELECT * FROM holidays WHERE id = ?').bind(body.holiday_id)
    .first<{ id: string; team_id: string | null; duration: number }>()
  if (!holiday || (holiday.team_id && holiday.team_id !== target.team_id)) return c.json(jsonError('Feriado incompatível com a equipe.'), 400)
  const amount = Number(body.amount)
  if (![0.5, 1].includes(amount) || !body.note?.trim()) return c.json(jsonError('Informe a quantidade e a justificativa.'), 400)
  const duplicate = await c.env.DB.prepare(`SELECT id FROM administrative_balance_entries
    WHERE user_id = ? AND holiday_id = ? AND amount > 0 LIMIT 1`).bind(target.id, holiday.id).first()
  if (duplicate) return c.json(jsonError('Este colaborador já possui crédito para o feriado informado.'), 409)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO administrative_balance_entries
    (id, user_id, holiday_id, amount, entry_type, note, created_by) VALUES (?, ?, ?, ?, 'MANUAL_WORK', ?, ?)`)
    .bind(id, target.id, holiday.id, amount, body.note.trim(), actor.id).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'ADMINISTRATIVE_CREDIT', id, body)
  return c.json({ id }, 201)
})

function weeklyScope(c: any) {
  const actor = c.get('user') as User
  if (actor.role === 'EMPLOYEE') return { error: c.json(jsonError('Acesso restrito.', 403), 403) }
  const requestedTeamId = c.req.query('teamId') || null
  return { actor, teamId: actor.role === 'SUPERVISOR' ? actor.team_id : requestedTeamId }
}

app.get('/api/communications/weekly', async (c) => {
  const scope = weeklyScope(c); if ('error' in scope) return scope.error
  const reference = c.req.query('reference') || today()
  const range = weekRange(reference)
  const teamClause = scope.teamId ? 'AND u.team_id = ?' : ''
  const query = c.env.DB.prepare(`SELECT r.*, u.name user_name FROM absence_requests r JOIN users u ON u.id = r.user_id
    WHERE r.start_date <= ? AND r.end_date >= ? AND r.status NOT IN ('REJECTED', 'CANCELLED') ${teamClause}
    ORDER BY r.start_date, u.name`)
  const rows = scope.teamId
    ? await query.bind(range.nextEnd, range.currentStart, scope.teamId).all<WeeklyRequest>()
    : await query.bind(range.nextEnd, range.currentStart).all<WeeklyRequest>()
  const generated = buildWeeklyBody(reference, rows.results)
  const savedQuery = scope.teamId
    ? c.env.DB.prepare(`SELECT * FROM weekly_communications WHERE period_start = ? AND team_id = ?`).bind(generated.currentStart, scope.teamId)
    : c.env.DB.prepare(`SELECT * FROM weekly_communications WHERE period_start = ? AND team_id IS NULL`).bind(generated.currentStart)
  const communication = await savedQuery.first()
  return c.json({
    subject: '[PSE] COMUNICADO SEMANAL DE AUSÊNCIAS', body: (communication as { draft_body?: string } | null)?.draft_body || generated.body,
    period_start: generated.currentStart, period_end: generated.nextEnd, communication,
  })
})

app.post('/api/communications/weekly', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ body: string; period_start: string; period_end: string; team_id?: string | null }>()
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id || null
  if (!body.body?.trim() || !body.period_start || !body.period_end) return c.json(jsonError('O texto e o período são obrigatórios.'), 400)
  const existingQuery = teamId
    ? c.env.DB.prepare(`SELECT id FROM weekly_communications WHERE period_start = ? AND team_id = ?`).bind(body.period_start, teamId)
    : c.env.DB.prepare(`SELECT id FROM weekly_communications WHERE period_start = ? AND team_id IS NULL`).bind(body.period_start)
  const existing = await existingQuery.first<{ id: string }>()
  const id = existing?.id || crypto.randomUUID()
  if (existing) {
    await c.env.DB.prepare(`UPDATE weekly_communications SET draft_body = ?, period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(body.body.trim(), body.period_end, id).run()
  } else {
    await c.env.DB.prepare(`INSERT INTO weekly_communications
      (id, team_id, period_start, period_end, draft_body, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, teamId, body.period_start, body.period_end, body.body.trim(), actor.id).run()
  }
  await audit(c.env.DB, actor.id, 'SAVE_DRAFT', 'WEEKLY_COMMUNICATION', id)
  return c.json({ id })
})

app.post('/api/communications/weekly/:id/publish', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const communication = await c.env.DB.prepare('SELECT * FROM weekly_communications WHERE id = ?').bind(c.req.param('id'))
    .first<{ id: string; team_id: string | null; subject: string; draft_body: string }>()
  if (!communication || (actor.role === 'SUPERVISOR' && communication.team_id !== actor.team_id)) return c.json(jsonError('Comunicado não encontrado.', 404), 404)
  const input = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }))
  const publishedBody = input.body?.trim() || communication.draft_body
  await c.env.DB.prepare(`UPDATE weekly_communications SET draft_body = ?, published_body = ?, published_by = ?,
    published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(publishedBody, publishedBody, actor.id, communication.id).run()
  const supervisorQuery = communication.team_id
    ? c.env.DB.prepare(`SELECT COALESCE(NULLIF(communication_email, ''), email) email FROM users WHERE role = 'SUPERVISOR' AND active = 1 AND team_id = ?`).bind(communication.team_id)
    : c.env.DB.prepare(`SELECT COALESCE(NULLIF(communication_email, ''), email) email FROM users WHERE role = 'SUPERVISOR' AND active = 1`)
  const supervisors = await supervisorQuery.all<{ email: string }>()
  const results = await Promise.all(supervisors.results.map((supervisor) => sendEmail(c.env.DB, c.env, {
    recipient: supervisor.email, subject: '[PSE] COMUNICADO SEMANAL DE AUSÊNCIAS', body: publishedBody, communicationId: communication.id,
  })))
  await audit(c.env.DB, actor.id, 'PUBLISH', 'WEEKLY_COMMUNICATION', communication.id, { recipients: supervisors.results.length })
  return c.json({ ok: true, recipients: supervisors.results.length, sent: results.filter((result) => result.status === 'SENT').length, published_body: publishedBody })
})

app.get('/api/calendar', async (c) => {
  const actor = c.get('user')
  const year = Number(c.req.query('year') || new Date().getUTCFullYear())
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return c.json(jsonError('Ano inválido.'), 400)
  const requestedTeamId = c.req.query('teamId') || null
  const userQuery = actor.role === 'EMPLOYEE'
    ? c.env.DB.prepare(`SELECT u.*, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ? ORDER BY u.name`).bind(actor.id)
    : actor.role === 'SUPERVISOR'
      ? c.env.DB.prepare(`SELECT u.*, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.team_id = ? ORDER BY u.active DESC, u.name`).bind(actor.team_id)
      : requestedTeamId
        ? c.env.DB.prepare(`SELECT u.*, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.team_id = ? ORDER BY u.active DESC, u.name`).bind(requestedTeamId)
        : c.env.DB.prepare(`SELECT u.*, t.name team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY t.name, u.active DESC, u.name`)
  const users = await userQuery.all<User>()
  const allRequests = await c.env.DB.prepare(`SELECT r.*, u.team_id, u.name user_name FROM absence_requests r
    JOIN users u ON u.id = r.user_id WHERE r.status IN ('REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED', 'QUANTUM_APPROVED') ORDER BY r.start_date`).all<{
      id: string; user_id: string; user_name: string; team_id: string | null; type: string; start_date: string; end_date: string;
      business_days: number; calendar_days: number; debit_days: number; status: string
    }>()
  const allowedIds = new Set(users.results.map((user) => user.id))
  const scopedRequests = allRequests.results.filter((request) => allowedIds.has(request.user_id))
  const calendar = users.results.map((user) => {
    const userRequests = scopedRequests.filter((request) => request.user_id === user.id)
    const vacations = userRequests.filter((request) => request.type === 'VACATION')
    const months = Array.from({ length: 12 }, (_, monthIndex) => {
      const monthStart = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
      const monthEnd = isoDate(new Date(Date.UTC(year, monthIndex + 1, 0, 12)))
      return {
        month: monthIndex + 1,
        confirmedBalance: Number(vacationBalance(user, monthEnd, vacations).toFixed(2)),
        projectedBalance: Number(vacationBalance(user, monthEnd, vacations, true).toFixed(2)),
        absences: userRequests.filter((request) => request.start_date <= monthEnd && request.end_date >= monthStart),
      }
    })
    return { user: { ...user, password_hash: undefined, password_salt: undefined }, months }
  })
  return c.json({ year, calendar })
})

app.get('/api/dashboard', async (c) => {
  const actor = c.get('user')
  const selectedId = c.req.query('userId') || actor.id
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(selectedId).first<User>()
  if (!target) return c.json(jsonError('Colaborador não encontrado.', 404), 404)
  if (actor.role === 'EMPLOYEE' && target.id !== actor.id) return c.json(jsonError('Acesso restrito.', 403), 403)
  if (actor.role === 'SUPERVISOR' && target.team_id !== actor.team_id) return c.json(jsonError('Acesso restrito.', 403), 403)
  const rows = await c.env.DB.prepare(`SELECT end_date, debit_days, status, type, start_date, business_days, calendar_days
    FROM absence_requests WHERE user_id = ? AND status IN ('REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED', 'QUANTUM_APPROVED')`).bind(target.id).all<{
      end_date: string; debit_days: number; status: string; type: string; start_date: string; business_days: number; calendar_days: number
    }>()
  const requests = rows.results.filter((r) => r.type === 'VACATION')
  const current = vacationBalance(target, today(), requests)
  const now = new Date()
  const endYear = `${now.getUTCFullYear()}-12-31`
  const projection = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index + 1, 0, 12))
    const asOf = isoDate(date)
    return {
      month: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', ''),
      asOf,
      confirmed: Number(vacationBalance(target, asOf, requests).toFixed(2)),
      projected: Number(vacationBalance(target, asOf, requests, true).toFixed(2)),
    }
  })
  const year = String(now.getUTCFullYear())
  const quota = (type: string, limit: number) => {
    const used = rows.results.filter((r) => r.type === type && r.start_date.startsWith(year)).reduce((s, r) => s + r.business_days, 0)
    return { used, available: Math.max(0, limit - used), limit }
  }
  const administrativeLedger = await c.env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) balance FROM administrative_balance_entries WHERE user_id = ?`)
    .bind(target.id).first<{ balance: number }>()
  const administrativeReserved = await c.env.DB.prepare(`SELECT COALESCE(SUM(administrative_days), 0) total FROM absence_requests
    WHERE user_id = ? AND type = 'ADMINISTRATIVE' AND status IN ('REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED')`)
    .bind(target.id).first<{ total: number }>()
  return c.json({
    currentBalance: Number(current.toFixed(2)),
    projectedYearEnd: Number(vacationBalance(target, endYear, requests, true).toFixed(2)),
    pendingCount: rows.results.filter((r) => r.status !== 'QUANTUM_APPROVED').length,
    administrativeBalance: Number(Number(administrativeLedger?.balance ?? 0).toFixed(2)),
    projectedAdministrativeBalance: Number((Number(administrativeLedger?.balance ?? 0) - Number(administrativeReserved?.total ?? 0)).toFixed(2)),
    projection,
    quotas: { justified: quota('JUSTIFIED', 15), unjustified: quota('UNJUSTIFIED', 4) },
  })
})

app.notFound((c) => c.json(jsonError('Recurso não encontrado.', 404), 404))

app.onError((error, c) => {
  console.error('Unhandled application error', error)
  return c.json(jsonError('Erro interno ao processar a operação.', 500), 500)
})

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(publishScheduledWeeklyCommunications(env, new Date(controller.scheduledTime)))
  },
}
