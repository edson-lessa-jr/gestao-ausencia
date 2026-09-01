ALTER TABLE users ADD COLUMN communication_email TEXT COLLATE NOCASE;

CREATE UNIQUE INDEX idx_users_communication_email
ON users(communication_email)
WHERE communication_email IS NOT NULL AND communication_email <> '';

CREATE TRIGGER users_email_conflict_insert
BEFORE INSERT ON users
WHEN
  (NEW.communication_email IS NOT NULL AND NEW.communication_email <> '' AND lower(NEW.email) = lower(NEW.communication_email))
  OR EXISTS (
    SELECT 1 FROM users
    WHERE lower(email) = lower(NEW.email)
       OR (communication_email IS NOT NULL AND lower(communication_email) = lower(NEW.email))
       OR (NEW.communication_email IS NOT NULL AND NEW.communication_email <> '' AND lower(email) = lower(NEW.communication_email))
       OR (NEW.communication_email IS NOT NULL AND NEW.communication_email <> '' AND communication_email IS NOT NULL AND lower(communication_email) = lower(NEW.communication_email))
  )
BEGIN
  SELECT RAISE(ABORT, 'E-mail já utilizado por outro usuário ou repetido nos dois campos.');
END;

CREATE TRIGGER users_email_conflict_update
BEFORE UPDATE OF email, communication_email ON users
WHEN
  (NEW.communication_email IS NOT NULL AND NEW.communication_email <> '' AND lower(NEW.email) = lower(NEW.communication_email))
  OR EXISTS (
    SELECT 1 FROM users
    WHERE id <> NEW.id AND (
      lower(email) = lower(NEW.email)
      OR (communication_email IS NOT NULL AND lower(communication_email) = lower(NEW.email))
      OR (NEW.communication_email IS NOT NULL AND NEW.communication_email <> '' AND lower(email) = lower(NEW.communication_email))
      OR (NEW.communication_email IS NOT NULL AND NEW.communication_email <> '' AND communication_email IS NOT NULL AND lower(communication_email) = lower(NEW.communication_email))
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'E-mail já utilizado por outro usuário ou repetido nos dois campos.');
END;
