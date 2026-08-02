CREATE TABLE IF NOT EXISTS notification_profiles (
  id TEXT PRIMARY KEY,
  write_token_hash TEXT NOT NULL,
  default_title TEXT NOT NULL DEFAULT 'Work',
  location TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  alerts_json TEXT NOT NULL DEFAULT '[120]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS notification_events (
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
);

CREATE INDEX IF NOT EXISTS notification_events_start_idx
  ON notification_events (profile_id, start_at, status);

CREATE TABLE IF NOT EXISTS push_subscriptions (
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
);

CREATE INDEX IF NOT EXISTS push_subscriptions_profile_idx
  ON push_subscriptions (profile_id);

CREATE TABLE IF NOT EXISTS notification_deliveries (
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
);

CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx
  ON notification_deliveries (status, due_at, next_attempt_at);
