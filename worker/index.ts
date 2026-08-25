import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { addDays, calendarDays, countBusinessDays, isoDate, vacationBalance } from './domain'

// Deployed through Cloudflare Workers Builds from the main branch.

type Bindings = { DB: D1Database; ASSETS: Fetcher }
type Role = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE'
type User = {
  id: string; name: string; email: string; role: Role; team_id: string | null; team_name?: string | null
  hire_date: string; balance_start_date: string; opening_vacation_balance: number
  monthly_accrual: number; vacation_debit_factor: number; active: number
}

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>()
const jsonError = (message: string, status = 400) => ({ message, status })
const today = () => isoDate(new Date())
const encoder = new TextEncoder()

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
    `SELECT date FROM holidays WHERE date BETWEEN ? AND ? AND (team_id IS NULL OR team_id = ?)`
  ).bind(start, end, teamId).all<{ date: string }>()
  return countBusinessDays(start, end, new Set(holidayRows.results.map((row) => row.date)))
}

async function audit(db: D1Database, actorId: string | null, action: string, entityType: string, entityId?: string, payload?: unknown) {
  await db.prepare(`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actorId, action, entityType, entityId ?? null, payload ? JSON.stringify(payload) : null).run()
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
  const body = await c.req.json<{ name: string; email: string; password: string; teamName?: string }>()
  if (!body.name || !body.email || !body.password || body.password.length < 10) {
    return c.json(jsonError('Informe nome, e-mail e uma senha com pelo menos 10 caracteres.'), 400)
  }
  const teamId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const salt = crypto.randomUUID()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').bind(teamId, body.teamName?.trim() || 'Equipe principal'),
    c.env.DB.prepare(`INSERT INTO users
      (id, name, email, password_hash, password_salt, role, team_id, hire_date, balance_start_date)
      VALUES (?, ?, ?, ?, ?, 'ADMIN', ?, ?, ?)`)
      .bind(userId, body.name.trim(), body.email.trim().toLowerCase(), await passwordHash(body.password, salt), salt, teamId, today(), today()),
  ])
  await audit(c.env.DB, userId, 'SETUP', 'SYSTEM')
  return c.json({ ok: true }, 201)
})

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>()
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND active = 1')
    .bind(body.email?.trim()).first<User & { password_hash: string; password_salt: string }>()
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
  const condition = actor.role === 'EMPLOYEE' ? 'WHERE u.id = ?' : ''
  const query = c.env.DB.prepare(`SELECT u.id, u.name, u.email, u.role, u.team_id, t.name team_name, u.active,
    u.hire_date, u.balance_start_date, u.opening_vacation_balance, u.monthly_accrual, u.vacation_debit_factor
    FROM users u LEFT JOIN teams t ON t.id = u.team_id ${condition} ORDER BY u.name`)
  const rows = actor.role === 'EMPLOYEE' ? await query.bind(actor.id).all<User>() : await query.all<User>()
  return c.json({ users: rows.results })
})

app.post('/api/users', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'ADMIN') return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<Partial<User> & { password: string }>()
  if (!body.name || !body.email || !body.password || !body.team_id || !body.role) return c.json(jsonError('Preencha os campos obrigatórios.'), 400)
  const id = crypto.randomUUID(); const salt = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO users
    (id, name, email, password_hash, password_salt, role, team_id, hire_date, balance_start_date, opening_vacation_balance, monthly_accrual, vacation_debit_factor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, body.name.trim(), body.email.trim().toLowerCase(), await passwordHash(body.password, salt), salt, body.role, body.team_id,
      body.hire_date || today(), body.balance_start_date || today(), Number(body.opening_vacation_balance || 0), Number(body.monthly_accrual || 2.5), Number(body.vacation_debit_factor || 1)).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'USER', id, { ...body, password: undefined })
  return c.json({ id }, 201)
})

app.patch('/api/users/:id', async (c) => {
  const actor = c.get('user')
  if (!['ADMIN', 'SUPERVISOR'].includes(actor.role)) return c.json(jsonError('Acesso restrito.', 403), 403)
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first<User>()
  if (!target) return c.json(jsonError('Colaborador não encontrado.', 404), 404)
  const body = await c.req.json<Partial<User> & { password?: string }>()
  if (body.role && !['ADMIN', 'SUPERVISOR', 'EMPLOYEE'].includes(body.role)) return c.json(jsonError('Perfil inválido.'), 400)
  const role = actor.role === 'ADMIN' && body.role ? body.role : target.role
  if (!body.name || !body.email || !body.team_id || !body.hire_date || !body.balance_start_date) {
    return c.json(jsonError('Preencha os campos obrigatórios.'), 400)
  }
  if (target.id === actor.id && !body.active) return c.json(jsonError('Você não pode inativar a própria conta.'), 409)
  if (target.role === 'ADMIN' && !body.active) {
    const admins = await c.env.DB.prepare(`SELECT COUNT(*) count FROM users WHERE role = 'ADMIN' AND active = 1 AND id <> ?`)
      .bind(target.id).first<{ count: number }>()
    if (Number(admins?.count ?? 0) === 0) return c.json(jsonError('O sistema deve manter pelo menos um administrador ativo.'), 409)
  }
  const statements = [c.env.DB.prepare(`UPDATE users SET name = ?, email = ?, role = ?, team_id = ?, active = ?,
    hire_date = ?, balance_start_date = ?, opening_vacation_balance = ?, monthly_accrual = ?, vacation_debit_factor = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
      body.name.trim(), body.email.trim().toLowerCase(), role, body.team_id, body.active ? 1 : 0,
      body.hire_date, body.balance_start_date, Number(body.opening_vacation_balance ?? 0),
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

app.get('/api/holidays', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT h.*, t.name team_name FROM holidays h LEFT JOIN teams t ON t.id = h.team_id ORDER BY h.date`).all()
  return c.json({ holidays: rows.results })
})

app.post('/api/holidays', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const body = await c.req.json<{ date: string; name: string; team_id?: string | null }>()
  const id = crypto.randomUUID()
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id || null
  await c.env.DB.prepare('INSERT INTO holidays (id, date, name, team_id) VALUES (?, ?, ?, ?)').bind(id, body.date, body.name.trim(), teamId).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'HOLIDAY', id, body)
  return c.json({ id }, 201)
})

app.patch('/api/holidays/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role === 'EMPLOYEE') return c.json(jsonError('Acesso restrito.', 403), 403)
  const current = await c.env.DB.prepare('SELECT * FROM holidays WHERE id = ?').bind(c.req.param('id')).first<{ id: string; team_id: string | null }>()
  if (!current || (actor.role === 'SUPERVISOR' && current.team_id !== actor.team_id)) return c.json(jsonError('Feriado não encontrado.', 404), 404)
  const body = await c.req.json<{ date: string; name: string; team_id?: string | null }>()
  const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : body.team_id || null
  await c.env.DB.prepare('UPDATE holidays SET date = ?, name = ?, team_id = ? WHERE id = ?')
    .bind(body.date, body.name.trim(), teamId, current.id).run()
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
  const body = await c.req.json<{ holidays: Array<{ date: string; name: string; team_id?: string | null }> }>()
  if (!Array.isArray(body.holidays) || body.holidays.length === 0 || body.holidays.length > 400) {
    return c.json(jsonError('Envie entre 1 e 400 feriados.'), 400)
  }
  const statements: D1PreparedStatement[] = []
  for (const item of body.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.name?.trim()) return c.json(jsonError('O CSV contém data ou descrição inválida.'), 400)
    const teamId = actor.role === 'SUPERVISOR' ? actor.team_id : item.team_id || null
    if (teamId === null) statements.push(c.env.DB.prepare('DELETE FROM holidays WHERE date = ? AND team_id IS NULL').bind(item.date))
    statements.push(c.env.DB.prepare('INSERT OR REPLACE INTO holidays (id, date, name, team_id) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), item.date, item.name.trim(), teamId))
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
  const body = await c.req.json<{ user_id?: string; type: string; start_date: string; end_date: string; reason?: string }>()
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
      WHERE user_id = ? AND type = ? AND status IN ('REQUESTED', 'CONFIRMED') AND substr(start_date, 1, 4) = ?`)
      .bind(userId, body.type, year).first<{ total: number }>()
    if (Number(used?.total ?? 0) + bizDays > limits[body.type]) return c.json(jsonError(`Saldo anual insuficiente. Limite: ${limits[body.type]} dias úteis.`), 400)
  }
  const debit = body.type === 'VACATION' ? bizDays * Number(target.vacation_debit_factor) : 0
  const id = crypto.randomUUID()
  await c.env.DB.prepare(`INSERT INTO absence_requests
    (id, user_id, created_by, type, start_date, end_date, business_days, calendar_days, debit_days, status, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, actor.id, body.type, body.start_date, body.end_date, bizDays, calDays, debit, 'REQUESTED', body.reason || null).run()
  await audit(c.env.DB, actor.id, 'CREATE', 'ABSENCE_REQUEST', id, body)
  return c.json({ id, business_days: bizDays, calendar_days: calDays, debit_days: debit }, 201)
})

app.patch('/api/requests/:id/status', async (c) => {
  const actor = c.get('user')
  const body = await c.req.json<{ status: string; note?: string }>()
  if (!['CONFIRMED', 'REJECTED', 'CANCELLED'].includes(body.status)) return c.json(jsonError('Status inválido.'), 400)
  const request = await c.env.DB.prepare(`SELECT r.*, u.team_id FROM absence_requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(c.req.param('id')).first<{ team_id: string; user_id: string; status: string }>()
  if (!request) return c.json(jsonError('Solicitação não encontrada.', 404), 404)
  if (request.status !== 'REQUESTED') return c.json(jsonError('Somente solicitações pendentes podem ser alteradas.'), 409)
  if (body.status === 'CANCELLED') {
    if (request.user_id !== actor.id) return c.json(jsonError('Somente o solicitante pode cancelar esta solicitação.', 403), 403)
  } else if (actor.role !== 'SUPERVISOR' || request.team_id !== actor.team_id) {
    return c.json(jsonError('Somente o supervisor da equipe pode aprovar ou rejeitar.', 403), 403)
  }
  await c.env.DB.prepare('UPDATE absence_requests SET status = ?, supervisor_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(body.status, body.note || null, c.req.param('id')).run()
  await audit(c.env.DB, actor.id, 'STATUS_CHANGE', 'ABSENCE_REQUEST', c.req.param('id'), body)
  return c.json({ ok: true })
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
    JOIN users u ON u.id = r.user_id WHERE r.status IN ('REQUESTED', 'CONFIRMED') ORDER BY r.start_date`).all<{
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
    FROM absence_requests WHERE user_id = ? AND status IN ('REQUESTED', 'CONFIRMED')`).bind(target.id).all<{
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
  return c.json({
    currentBalance: Number(current.toFixed(2)),
    projectedYearEnd: Number(vacationBalance(target, endYear, requests, true).toFixed(2)),
    pendingCount: rows.results.filter((r) => r.status === 'REQUESTED').length,
    projection,
    quotas: { justified: quota('JUSTIFIED', 15), unjustified: quota('UNJUSTIFIED', 4) },
  })
})

app.notFound((c) => c.json(jsonError('Recurso não encontrado.', 404), 404))

app.onError((error, c) => {
  console.error('Unhandled application error', error)
  return c.json(jsonError('Erro interno ao processar a operação.', 500), 500)
})

export default app
