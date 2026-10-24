CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  expires_at TEXT,
  installation_id TEXT,
  activated_at TEXT,
  last_seen TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_license_installation ON licenses(installation_id);
CREATE INDEX IF NOT EXISTS idx_license_expires ON licenses(expires_at);

CREATE TABLE IF NOT EXISTS license_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL,
  action TEXT NOT NULL,
  installation_id TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_license_events ON license_events(license_key, created_at);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  account_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled')),
  license_key TEXT,
  provider TEXT NOT NULL DEFAULT 'payos',
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_email ON accounts(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_phone ON accounts(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS trial_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_trial_claims_ip ON trial_claims(ip, created_at);

CREATE TABLE IF NOT EXISTS transaction_guard (
  value INTEGER NOT NULL CHECK(value = 1)
);

CREATE TABLE IF NOT EXISTS auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_events_bucket ON auth_events(bucket, created_at);
