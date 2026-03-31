-- =====================================================
-- VTOS — Vector Online Solutions | Database Schema
-- Run once against your Neon.tech database
-- =====================================================

-- ── Users ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(30),
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Quote Leads ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(200) NOT NULL,
  company          VARCHAR(200),
  email            VARCHAR(255) NOT NULL,
  phone            VARCHAR(30),
  service          VARCHAR(200) NOT NULL,
  budget           VARCHAR(100),
  description      TEXT         NOT NULL,
  wants_consult    BOOLEAN      NOT NULL DEFAULT false,
  status           VARCHAR(30)  NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'contacted', 'in_progress', 'converted', 'closed')),
  admin_notes      TEXT,
  submitted_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_status    ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created   ON quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_email     ON quotes(email);

-- ── Courier Bookings ─────────────────────────────────
CREATE TABLE IF NOT EXISTS courier_bookings (
  id                  SERIAL PRIMARY KEY,
  user_id             INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What is being sent
  item_description    TEXT         NOT NULL,
  item_type           VARCHAR(100) NOT NULL,   -- e.g. "Laptop", "Desktop PC", "GPU"
  issue_description   TEXT         NOT NULL,   -- reason / fault description
  -- Courier info
  courier_company     VARCHAR(150),
  tracking_number     VARCHAR(150),
  estimated_arrival   DATE,
  -- Status workflow
  status              VARCHAR(40)  NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending',       -- just submitted
                        'awaiting_pickup',
                        'in_transit',
                        'received',
                        'diagnosing',
                        'awaiting_approval',
                        'repairing',
                        'ready_to_return',
                        'returned',
                        'closed'
                      )),
  admin_notes         TEXT,
  -- Return courier info
  return_tracking     VARCHAR(150),
  return_courier      VARCHAR(150),
  -- Timestamps
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courier_user_id  ON courier_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_courier_status   ON courier_bookings(status);
CREATE INDEX IF NOT EXISTS idx_courier_created  ON courier_bookings(created_at DESC);

-- ── Portfolio Items ──────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_items (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(200) NOT NULL,
  tag             VARCHAR(50)  NOT NULL CHECK (tag IN ('website', 'webapp', 'ecommerce', 'other')),
  description     TEXT         NOT NULL,
  screenshot_url  VARCHAR(500),  -- URL to screenshot image
  project_url     VARCHAR(500),  -- Live link to the project
  is_visible      BOOLEAN      NOT NULL DEFAULT true,
  display_order   INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_visible ON portfolio_items(is_visible);
CREATE INDEX IF NOT EXISTS idx_portfolio_order   ON portfolio_items(display_order);

-- ── Auto-update updated_at trigger ──────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_quotes_updated_at
    BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_courier_updated_at
    BEFORE UPDATE ON courier_bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_portfolio_updated_at
    BEFORE UPDATE ON portfolio_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
