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

-- Password reset tokens
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token      VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_exp  TIMESTAMPTZ;

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

-- Package-driven quoting (safe to run multiple times)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS package_tier VARCHAR(100);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS addons       JSONB;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS estimate     INTEGER;

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

-- ── Proposals (Quote Builder) ─────────────────────────
CREATE TABLE IF NOT EXISTS proposals (
  id              SERIAL PRIMARY KEY,
  quote_number    VARCHAR(30)   NOT NULL UNIQUE,
  lead_id         INT           REFERENCES quotes(id) ON DELETE SET NULL,
  client_name     VARCHAR(200)  NOT NULL,
  client_email    VARCHAR(255)  NOT NULL,
  client_company  VARCHAR(200),
  title           VARCHAR(300)  NOT NULL,
  valid_until     DATE,
  status          VARCHAR(20)   NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  items           JSONB         NOT NULL DEFAULT '[]',
  notes           TEXT,
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by      INT           REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_client_email ON proposals(client_email);
CREATE INDEX IF NOT EXISTS idx_proposals_status       ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_lead_id      ON proposals(lead_id);

DO $$ BEGIN
  CREATE TRIGGER trg_proposals_updated_at
    BEFORE UPDATE ON proposals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Atomic quote-number sequence ─────────────────────
-- Replaces the racy `SELECT COUNT(*)+1` approach in the proposals route.
-- Numbers are globally sequential (do not reset per year) — this is a
-- deliberate choice: continuous numbering is standard for accounting/audit
-- trails, and removes a whole class of race conditions.
-- Format remains VTOS-Q-YYYY-NNN; LPAD pads to 3 but won't truncate past 999.
CREATE SEQUENCE IF NOT EXISTS proposal_number_seq;

-- Backfill: align the sequence with any existing proposals so we never
-- collide with VTOS-Q-2026-001, VTOS-Q-2026-002, ... that were created
-- under the old generator.
DO $$
DECLARE
  max_num int;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(quote_number FROM 'VTOS-Q-\d{4}-(\d+)')::int), 0)
    INTO max_num
    FROM proposals;
  -- setval(seq, val, is_called=true) -> next nextval() returns val+1
  -- setval(seq, 1,   is_called=false) -> next nextval() returns 1
  IF max_num > 0 THEN
    PERFORM setval('proposal_number_seq', max_num, true);
  ELSE
    PERFORM setval('proposal_number_seq', 1, false);
  END IF;
END $$;

-- ── Soft-delete for users ────────────────────────────
-- Hard-deleting a user used to cascade-delete their courier_bookings.
-- We mark as deleted instead; history (quotes/proposals/courier) is preserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index — only living users participate in lookups.
CREATE INDEX IF NOT EXISTS idx_users_alive ON users(id) WHERE deleted_at IS NULL;
