CREATE TABLE IF NOT EXISTS licenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  license_key VARCHAR(64) NOT NULL,
  plan VARCHAR(32) NOT NULL DEFAULT 'trial',
  status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  expires_at DATETIME NULL,
  installation_id VARCHAR(64) NULL,
  activated_at DATETIME NULL,
  last_seen DATETIME NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_license_key (license_key),
  KEY idx_installation (installation_id),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS license_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  license_key VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  installation_id VARCHAR(64) NOT NULL DEFAULT '',
  version VARCHAR(32) NOT NULL DEFAULT '',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  detail VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_license_events (license_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_code BIGINT UNSIGNED NOT NULL,
  plan VARCHAR(32) NOT NULL,
  amount INT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL DEFAULT '',
  account_id BIGINT UNSIGNED NULL,
  status ENUM('pending', 'paid', 'cancelled') NOT NULL DEFAULT 'pending',
  license_key VARCHAR(64) NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'payos',
  raw_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_code (order_code),
  KEY idx_order_status (status, created_at),
  KEY idx_orders_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NULL,
  phone VARCHAR(32) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_email (email),
  UNIQUE KEY uq_accounts_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trial_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trial_claim_account (account_id),
  KEY idx_trial_claims_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bucket VARCHAR(180) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_auth_events_bucket (bucket, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
