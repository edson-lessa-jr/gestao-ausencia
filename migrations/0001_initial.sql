PRAGMA foreign_keys = ON;

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SUPERVISOR', 'EMPLOYEE')),
  team_id TEXT REFERENCES teams(id),
  active INTEGER NOT NULL DEFAULT 1,
  hire_date TEXT NOT NULL,
  balance_start_date TEXT NOT NULL,
  opening_vacation_balance REAL NOT NULL DEFAULT 0,
  monthly_accrual REAL NOT NULL DEFAULT 2.5,
  vacation_debit_factor REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, team_id)
);

CREATE TABLE absence_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('VACATION', 'JUSTIFIED', 'UNJUSTIFIED', 'PATERNITY', 'MATERNITY')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  business_days INTEGER NOT NULL,
  calendar_days INTEGER NOT NULL,
  debit_days REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  reason TEXT,
  supervisor_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_team ON users(team_id);
CREATE INDEX idx_absence_user_dates ON absence_requests(user_id, start_date, end_date);
CREATE INDEX idx_absence_status ON absence_requests(status);
CREATE INDEX idx_holidays_date ON holidays(date);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
