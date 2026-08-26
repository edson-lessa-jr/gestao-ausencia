PRAGMA foreign_keys = OFF;

ALTER TABLE holidays ADD COLUMN duration REAL NOT NULL DEFAULT 1 CHECK (duration IN (0.5, 1));
ALTER TABLE holidays ADD COLUMN generates_admin_credit INTEGER NOT NULL DEFAULT 1 CHECK (generates_admin_credit IN (0, 1));

CREATE TABLE absence_requests_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('VACATION', 'JUSTIFIED', 'UNJUSTIFIED', 'PATERNITY', 'MATERNITY', 'ADMINISTRATIVE')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  business_days REAL NOT NULL,
  calendar_days INTEGER NOT NULL,
  debit_days REAL NOT NULL DEFAULT 0,
  administrative_days REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'QUANTUM_REGISTERED', 'QUANTUM_APPROVED', 'REJECTED', 'CANCELLED')),
  reason TEXT,
  supervisor_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO absence_requests_new (
  id, user_id, created_by, type, start_date, end_date, business_days, calendar_days,
  debit_days, administrative_days, status, reason, supervisor_note, created_at, updated_at
)
SELECT id, user_id, created_by, type, start_date, end_date, business_days, calendar_days,
  debit_days, 0,
  CASE status WHEN 'CONFIRMED' THEN 'APPROVED' ELSE status END,
  reason, supervisor_note, created_at, updated_at
FROM absence_requests;

DROP TABLE absence_requests;
ALTER TABLE absence_requests_new RENAME TO absence_requests;

CREATE TABLE request_status_history (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES absence_requests(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO request_status_history (id, request_id, actor_id, previous_status, new_status, note, created_at)
SELECT lower(hex(randomblob(16))), id, created_by, NULL, status, 'Histórico inicial criado pela migração', created_at
FROM absence_requests;

CREATE TABLE administrative_balance_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  holiday_id TEXT REFERENCES holidays(id) ON DELETE SET NULL,
  request_id TEXT REFERENCES absence_requests(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('AUTOMATIC_ABSENCE', 'MANUAL_WORK', 'USAGE', 'REVERSAL', 'ADJUSTMENT')),
  note TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, holiday_id, request_id, entry_type)
);

CREATE TABLE email_notifications (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES absence_requests(id) ON DELETE SET NULL,
  communication_id TEXT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE TABLE weekly_communications (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '[PSE] COMUNICADO SEMANAL DE AUSÊNCIAS',
  draft_body TEXT NOT NULL,
  published_body TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  published_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE UNIQUE INDEX idx_weekly_period_team ON weekly_communications(period_start, ifnull(team_id, 'ALL'));
CREATE INDEX idx_absence_user_dates ON absence_requests(user_id, start_date, end_date);
CREATE INDEX idx_absence_status ON absence_requests(status);
CREATE INDEX idx_status_history_request ON request_status_history(request_id, created_at);
CREATE INDEX idx_admin_balance_user ON administrative_balance_entries(user_id, created_at);
CREATE INDEX idx_email_status ON email_notifications(status, created_at);

PRAGMA foreign_keys = ON;
