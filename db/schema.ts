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

export const notificationSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS calendar_feed_creations (
    client_hash TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (client_hash, day)
  )`,
  `CREATE TABLE IF NOT EXISTS notification_profiles (
    id TEXT PRIMARY KEY,
    write_token_hash TEXT NOT NULL,
    default_title TEXT NOT NULL DEFAULT 'Work',
    location TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    alerts_json TEXT NOT NULL DEFAULT '[120]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notification_events (
    profile_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    start_at TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Work',
    status TEXT NOT NULL DEFAULT 'confirmed',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, event_key),
    FOREIGN KEY (profile_id) REFERENCES notification_profiles(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS notification_events_start_idx
    ON notification_events (profile_id, start_at, status)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    expiration_time INTEGER,
    device_name TEXT NOT NULL DEFAULT 'Shiftdeck device',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES notification_profiles(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS push_subscriptions_profile_idx
    ON push_subscriptions (profile_id)`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    profile_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    alert_minutes INTEGER NOT NULL,
    subscription_id TEXT NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    claimed_at TEXT,
    sent_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, event_key, alert_minutes, subscription_id),
    FOREIGN KEY (profile_id, event_key)
      REFERENCES notification_events(profile_id, event_key) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx
    ON notification_deliveries (status, due_at, next_attempt_at)`,
] as const;
