export const calendarSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS calendar_feeds (
    id TEXT PRIMARY KEY,
    write_token_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Shiftdeck',
    location TEXT NOT NULL DEFAULT '',
    location_lat REAL,
    location_lon REAL,
    notes TEXT NOT NULL DEFAULT '',
    reminder1 TEXT NOT NULL DEFAULT '',
    reminder2 TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_events (
    calendar_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    base_title TEXT NOT NULL,
    signature TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'confirmed',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (calendar_id, event_key),
    FOREIGN KEY (calendar_id) REFERENCES calendar_feeds(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS calendar_events_date_idx
    ON calendar_events (calendar_id, date)`,
  `CREATE TABLE IF NOT EXISTS calendar_feed_creations (
    client_hash TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (client_hash, day)
  )`,
] as const;

export const referenceSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS reference_vault (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reference_access_requests (
    id TEXT PRIMARY KEY,
    request_token_hash TEXT NOT NULL,
    client_hash TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    issued_token TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS reference_access_requests_status_idx
    ON reference_access_requests (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS reference_access_requests_client_idx
    ON reference_access_requests (client_hash, created_at)`,
  `CREATE TABLE IF NOT EXISTS reference_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    device_name TEXT NOT NULL,
    is_owner INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS reference_sessions_token_idx
    ON reference_sessions (token_hash)`,
  `CREATE TABLE IF NOT EXISTS reference_owner_attempts (
    client_hash TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (client_hash, day)
  )`,
] as const;
