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

CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
-- Admin list orders by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_quotes_status        ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created       ON quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_email         ON quotes(email);
-- New: client "my quotes" lookup goes through submitted_by first.
CREATE INDEX IF NOT EXISTS idx_quotes_submitted_by  ON quotes(submitted_by);

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
-- Admin list orders by created_at DESC; without this it sorts in-memory.
CREATE INDEX IF NOT EXISTS idx_proposals_created      ON proposals(created_at DESC);

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

-- ── Banking details on proposals ─────────────────────
-- Optional JSONB blob ({bank_name, account_holder, account_number,
-- account_type, branch_code, reference}) — when present it is rendered
-- as a "Payment Details" block on the quote PDF.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS banking_details JSONB;

-- ── Invoices (Invoice Builder) ───────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              SERIAL PRIMARY KEY,
  invoice_number  VARCHAR(30)   NOT NULL UNIQUE,
  proposal_id     INT           REFERENCES proposals(id) ON DELETE SET NULL,
  client_name     VARCHAR(200)  NOT NULL,
  client_email    VARCHAR(255)  NOT NULL,
  client_company  VARCHAR(200),
  title           VARCHAR(300)  NOT NULL,
  due_date        DATE,
  status          VARCHAR(20)   NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  items           JSONB         NOT NULL DEFAULT '[]',
  notes           TEXT,
  banking_details JSONB,
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by      INT           REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_client_email ON invoices(client_email);
CREATE INDEX IF NOT EXISTS idx_invoices_status       ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created      ON invoices(created_at DESC);

DO $$ BEGIN
  CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Atomic invoice-number sequence — same rationale as proposal_number_seq.
-- Format: VTOS-INV-YYYY-NNN, globally sequential.
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;

DO $$
DECLARE
  max_num int;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(invoice_number FROM 'VTOS-INV-\d{4}-(\d+)')::int), 0)
    INTO max_num
    FROM invoices;
  IF max_num > 0 THEN
    PERFORM setval('invoice_number_seq', max_num, true);
  ELSE
    PERFORM setval('invoice_number_seq', 1, false);
  END IF;
END $$;

-- ── App settings (key/value) ─────────────────────────
-- Currently holds the admin's default banking details under key 'banking'.
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(50)  PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Soft-delete for users ────────────────────────────
-- Hard-deleting a user used to cascade-delete their courier_bookings.
-- We mark as deleted instead; history (quotes/proposals/courier) is preserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index — only living users participate in lookups.
CREATE INDEX IF NOT EXISTS idx_users_alive ON users(id) WHERE deleted_at IS NULL;

-- ═════════════════════════════════════════════════════
-- SERVICE DIVISIONS
-- The business runs three divisions: 'web' (websites, apps,
-- e-commerce), 'led' (LED screen installation, callouts, module
-- repairs) and 'it' (PC repair, IT support). Every revenue-bearing
-- record carries a category so the admin panel can filter and
-- report per division. Existing rows default to 'web'.
-- ═════════════════════════════════════════════════════

ALTER TABLE quotes          ADD COLUMN IF NOT EXISTS category VARCHAR(10) NOT NULL DEFAULT 'web';
ALTER TABLE proposals       ADD COLUMN IF NOT EXISTS category VARCHAR(10) NOT NULL DEFAULT 'web';
ALTER TABLE invoices        ADD COLUMN IF NOT EXISTS category VARCHAR(10) NOT NULL DEFAULT 'web';
ALTER TABLE portfolio_items ADD COLUMN IF NOT EXISTS category VARCHAR(10) NOT NULL DEFAULT 'web';

CREATE INDEX IF NOT EXISTS idx_quotes_category    ON quotes(category);
CREATE INDEX IF NOT EXISTS idx_proposals_category ON proposals(category);
CREATE INDEX IF NOT EXISTS idx_invoices_category  ON invoices(category);

-- Portfolio tag list gains 'led'. The original CHECK is column-generated
-- (portfolio_items_tag_check), so it must be dropped and recreated rather
-- than extended in place.
DO $$ BEGIN
  ALTER TABLE portfolio_items DROP CONSTRAINT IF EXISTS portfolio_items_tag_check;
  ALTER TABLE portfolio_items ADD  CONSTRAINT portfolio_items_tag_check
    CHECK (tag IN ('website', 'webapp', 'ecommerce', 'led', 'other'));
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Service catalogue ────────────────────────────────
-- Single source of truth for packages and add-ons. Replaces the pricing
-- that was hardcoded in three places (public app.js QUOTE_PACKAGES,
-- index.html radio buttons, admin SERVICE_TEMPLATES). Adding a service
-- or changing a price is now a row edit, not a deploy.
CREATE TABLE IF NOT EXISTS service_catalog (
  id             SERIAL PRIMARY KEY,
  category       VARCHAR(10)   NOT NULL CHECK (category IN ('web', 'led', 'it')),
  kind           VARCHAR(10)   NOT NULL CHECK (kind IN ('package', 'addon')),
  key            VARCHAR(60)   NOT NULL UNIQUE,
  name           VARCHAR(200)  NOT NULL,
  description    TEXT,
  base_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit           VARCHAR(20)   NOT NULL DEFAULT 'project'
                 CHECK (unit IN ('project','hour','module','sqm','month','callout','item')),
  template_items JSONB,        -- line-item bundle for the Quote/Invoice Builder
  note           VARCHAR(200),
  sort_order     INT           NOT NULL DEFAULT 0,
  is_active      BOOLEAN       NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_category ON service_catalog(category, kind, sort_order);

DO $$ BEGIN
  CREATE TRIGGER trg_catalog_updated_at
    BEFORE UPDATE ON service_catalog
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed: ON CONFLICT DO NOTHING so admin price edits are never overwritten
-- by a re-run of this migration.
INSERT INTO service_catalog (category, kind, key, name, base_price, unit, note, sort_order) VALUES
  ('web','package','starter',      'Starter Website',           3000,  'project', NULL, 10),
  ('web','package','professional', 'Professional Website',      6500,  'project', NULL, 20),
  ('web','package','webapp',       'Web Application / Portal',  9999,  'project', NULL, 30),
  ('web','package','ecommerce',    'E-Commerce Store',          13999, 'project', NULL, 40),
  ('web','package','custom',       'Custom / Enterprise',       0,     'project', 'Free consultation — no obligation', 90),
  ('it', 'package','repair',       'PC Repair / Hardware',      350,   'item',    'Diagnostic fee — credited to repair cost', 10),
  ('it', 'package','it-support',   'IT Support (per hour)',     450,   'hour',    NULL, 20),
  ('led','package','led-install',  'LED Screen Installation',   0,     'project', 'Quoted per site survey', 10),
  ('led','package','led-callout',  'LED Callout / On-Site Service', 2000, 'callout', 'Greater Cape Town or within a 30km radius', 20),
  ('led','package','led-repair',   'LED Module Repair',         400,   'module',  'Per module — evaluated before repair', 30),
  ('led','package','led-maintenance','LED Maintenance Plan',    0,     'month',   'Quoted per screen', 40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO service_catalog (category, kind, key, name, base_price, unit, note, sort_order) VALUES
  ('web','addon','logo',        'Logo & Brand Design',                1499, 'project', NULL, 10),
  ('web','addon','domain',      'Domain Registration (1 yr)',         299,  'project', NULL, 20),
  ('web','addon','hosting',     'Hosting Setup',                      499,  'project', NULL, 30),
  ('web','addon','email-host',  'Professional Email (1 yr, 10 accs)', 1200, 'project', NULL, 40),
  ('web','addon','seo',         'SEO Kickstart Package (3 months)',   2499, 'project', NULL, 50),
  ('web','addon','gmb',         'Google My Business Setup',           499,  'project', NULL, 60),
  ('web','addon','whatsapp',    'WhatsApp Chat Widget',               699,  'project', NULL, 70),
  ('web','addon','maintenance', 'Monthly Maintenance Plan',           499,  'month',   '/mo', 80),
  ('web','addon','payment-gw',  'Payment Gateway Integration',        1499, 'project', NULL, 90),
  ('web','addon','extra-pages', 'Extra Pages (per 3)',                799,  'project', NULL, 100),
  ('web','addon','content',     'Content Writing (per page)',         399,  'project', NULL, 110),
  ('web','addon','custom-addon','Custom Add-on (discuss below)',      0,    'project', NULL, 120),
  ('led','addon','led-spares',  'Replacement Modules / Spares',       0,    'item',    'Quoted on assessment', 10),
  ('led','addon','led-afterhours','After-Hours / Weekend Attendance', 0,    'callout', 'Quoted per job', 20),
  ('led','addon','led-travel',  'Travel Beyond 30km Radius',          0,    'project', 'Quoted per km beyond the service area', 30)
ON CONFLICT (key) DO NOTHING;

-- Line-item bundles used by the Quote/Invoice Builder "Quick Templates".
-- Only fills rows that have none, so admin edits are never clobbered.
UPDATE service_catalog SET template_items = v.items FROM (VALUES
  ('starter', '[{"desc":"Website Design & Wireframing (up to 5 pages)","qty":1,"price":1400},
                {"desc":"Responsive Frontend Development","qty":1,"price":1200},
                {"desc":"Contact Form Integration","qty":1,"price":200},
                {"desc":"Basic SEO Setup","qty":1,"price":150},
                {"desc":"Social Media Links & Icons","qty":1,"price":50}]'::jsonb),
  ('professional', '[{"desc":"UI/UX Design & Wireframing (up to 8 pages)","qty":1,"price":2200},
                {"desc":"Responsive Frontend Development","qty":1,"price":2000},
                {"desc":"Blog / News System","qty":1,"price":700},
                {"desc":"Image Gallery","qty":1,"price":400},
                {"desc":"WhatsApp Chat & Social Integration","qty":1,"price":400},
                {"desc":"Advanced SEO Setup & Sitemap","qty":1,"price":500},
                {"desc":"Testing & Launch","qty":1,"price":300}]'::jsonb),
  ('webapp', '[{"desc":"System Architecture & Database Design","qty":1,"price":2000},
                {"desc":"Backend API Development","qty":1,"price":3000},
                {"desc":"User Authentication & Role Management","qty":1,"price":1500},
                {"desc":"Frontend Dashboard / Client Portal","qty":1,"price":2000},
                {"desc":"CRM / Booking / Inventory Module","qty":1,"price":1500},
                {"desc":"Testing, Security Audit & Deployment","qty":1,"price":999}]'::jsonb),
  ('ecommerce', '[{"desc":"Store Design & Branding","qty":1,"price":2500},
                {"desc":"Product Catalogue & Management System","qty":1,"price":2000},
                {"desc":"PayFast / Yoco Payment Gateway Integration","qty":1,"price":2500},
                {"desc":"Shopping Cart & Checkout Flow","qty":1,"price":2000},
                {"desc":"Order Management & Email Notifications","qty":1,"price":2000},
                {"desc":"Customer Accounts & Wishlist","qty":1,"price":1500},
                {"desc":"Testing & Launch","qty":1,"price":999}]'::jsonb),
  ('repair', '[{"desc":"Diagnostic Assessment","qty":1,"price":350},
                {"desc":"Parts & Labour","qty":1,"price":800},
                {"desc":"Data Backup & Recovery","qty":1,"price":500},
                {"desc":"OS Reinstall / Software Setup","qty":1,"price":300},
                {"desc":"Quality Check & Testing","qty":1,"price":200}]'::jsonb),
  ('it-support', '[{"desc":"On-site or Remote Assessment (per hour)","qty":2,"price":450},
                {"desc":"Software Configuration & Updates","qty":1,"price":600},
                {"desc":"Network Setup & Security","qty":1,"price":800},
                {"desc":"Documentation & User Training","qty":1,"price":500}]'::jsonb),
  ('led-install', '[{"desc":"Site Survey & Structural Assessment","qty":1,"price":0},
                {"desc":"Mounting Structure & Rigging","qty":1,"price":0},
                {"desc":"LED Cabinet Assembly & Mounting","qty":1,"price":0},
                {"desc":"Power & Data Cabling","qty":1,"price":0},
                {"desc":"Processor / Controller Configuration","qty":1,"price":0},
                {"desc":"Commissioning, Calibration & Testing","qty":1,"price":0},
                {"desc":"Handover & Operator Training","qty":1,"price":0}]'::jsonb),
  ('led-callout', '[{"desc":"LED Callout Fee (Greater Cape Town / 30km radius)","qty":1,"price":2000},
                {"desc":"On-Site Fault Diagnosis","qty":1,"price":0},
                {"desc":"Parts & Replacement Modules","qty":1,"price":0}]'::jsonb),
  ('led-repair', '[{"desc":"Module Evaluation & Fault Report","qty":1,"price":0},
                {"desc":"LED Module Repair (per module)","qty":1,"price":400},
                {"desc":"Testing & Quality Check","qty":1,"price":0},
                {"desc":"Dispatch & Return Delivery","qty":1,"price":0}]'::jsonb),
  ('led-maintenance', '[{"desc":"Scheduled Preventative Inspection","qty":1,"price":0},
                {"desc":"Brightness & Colour Calibration","qty":1,"price":0},
                {"desc":"Cleaning & Seal Check","qty":1,"price":0},
                {"desc":"Condition Report","qty":1,"price":0}]'::jsonb)
) AS v(k, items)
WHERE service_catalog.key = v.k AND service_catalog.template_items IS NULL;

-- ── LED screen register ──────────────────────────────
-- Asset register of installed screens. Callouts and repairs link back to
-- a screen so its full service history is visible in one place.
CREATE TABLE IF NOT EXISTS led_screens (
  id             SERIAL PRIMARY KEY,
  client_id      INT           REFERENCES users(id) ON DELETE SET NULL,
  client_name    VARCHAR(200)  NOT NULL,
  site_name      VARCHAR(200),
  site_address   TEXT,
  screen_label   VARCHAR(200)  NOT NULL,   -- "Main facade", "Court-side ribbon"
  pixel_pitch    NUMERIC(5,2),             -- 3.91, 10.00
  width_m        NUMERIC(6,2),
  height_m       NUMERIC(6,2),
  module_count   INT,
  cabinet_type   VARCHAR(120),
  module_type    VARCHAR(120),
  receiving_card VARCHAR(120),
  processor      VARCHAR(120),
  environment    VARCHAR(15)   NOT NULL DEFAULT 'indoor'
                 CHECK (environment IN ('indoor', 'outdoor', 'semi_outdoor')),
  installed_on   DATE,
  warranty_until DATE,
  notes          TEXT,
  is_active      BOOLEAN       NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_led_screens_client ON led_screens(client_id);
CREATE INDEX IF NOT EXISTS idx_led_screens_active ON led_screens(is_active);

DO $$ BEGIN
  CREATE TRIGGER trg_led_screens_updated_at
    BEFORE UPDATE ON led_screens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── LED jobs ─────────────────────────────────────────
-- Installations, callouts, module repairs and maintenance visits.
-- client_id is nullable on purpose: most callouts arrive by phone from
-- people who have no portal account, so contact details are free text.
-- Status pipeline follows the repair process:
--   evaluate → report back → repair → dispatch
-- with scheduling/parts states shared by installs and callouts.
CREATE TABLE IF NOT EXISTS led_jobs (
  id                SERIAL PRIMARY KEY,
  job_number        VARCHAR(30)  NOT NULL UNIQUE,
  job_type          VARCHAR(20)  NOT NULL
                    CHECK (job_type IN ('installation', 'callout', 'repair', 'maintenance')),
  priority          VARCHAR(15)  NOT NULL DEFAULT 'standard'
                    CHECK (priority IN ('standard', 'urgent', 'emergency')),
  status            VARCHAR(20)  NOT NULL DEFAULT 'logged'
                    CHECK (status IN (
                      'logged',          -- captured (phone-in or web)
                      'scheduled',       -- date set
                      'evaluating',      -- on-site diagnosis / bench evaluation
                      'reported',        -- findings reported back, awaiting client approval
                      'awaiting_parts',
                      'in_progress',     -- installing / repairing / on site
                      'dispatched',      -- modules returned to client
                      'completed',
                      'invoiced',
                      'cancelled'
                    )),
  -- Client / contact (phone-in jobs have no account)
  client_id         INT          REFERENCES users(id) ON DELETE SET NULL,
  contact_name      VARCHAR(200) NOT NULL,
  contact_phone     VARCHAR(30),
  contact_email     VARCHAR(255),
  company           VARCHAR(200),
  -- Where
  screen_id         INT          REFERENCES led_screens(id) ON DELETE SET NULL,
  site_address      TEXT,
  site_notes        TEXT,                 -- access, working height, power
  within_service_area BOOLEAN    NOT NULL DEFAULT true,
  -- When / who
  scheduled_for     TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  technician        VARCHAR(200),
  -- Work
  fault_description TEXT,
  evaluation_notes  TEXT,                 -- findings from the evaluate step
  work_performed    TEXT,
  parts_used        JSONB,
  modules_in        INT,
  modules_repaired  INT,
  modules_scrapped  INT,
  labour_hours      NUMERIC(6,2),
  travel_km         NUMERIC(7,2),
  -- Billing links
  quote_id          INT          REFERENCES proposals(id) ON DELETE SET NULL,
  invoice_id        INT          REFERENCES invoices(id)  ON DELETE SET NULL,
  admin_notes       TEXT,
  created_by        INT          REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_led_jobs_status    ON led_jobs(status);
CREATE INDEX IF NOT EXISTS idx_led_jobs_type      ON led_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_led_jobs_created   ON led_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_led_jobs_screen    ON led_jobs(screen_id);
CREATE INDEX IF NOT EXISTS idx_led_jobs_client    ON led_jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_led_jobs_scheduled ON led_jobs(scheduled_for);

DO $$ BEGIN
  CREATE TRIGGER trg_led_jobs_updated_at
    BEFORE UPDATE ON led_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Atomic job-number sequence — same pattern as proposals/invoices.
-- Format: VTOS-LED-YYYY-NNN, globally sequential.
CREATE SEQUENCE IF NOT EXISTS led_job_number_seq;

DO $$
DECLARE
  max_num int;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(job_number FROM 'VTOS-LED-\d{4}-(\d+)')::int), 0)
    INTO max_num
    FROM led_jobs;
  IF max_num > 0 THEN
    PERFORM setval('led_job_number_seq', max_num, true);
  ELSE
    PERFORM setval('led_job_number_seq', 1, false);
  END IF;
END $$;

-- ── LED rate card ────────────────────────────────────
-- Lives in app_settings so rates are editable from the admin panel
-- without a deploy. Seeded once; admin edits persist.
INSERT INTO app_settings (key, value) VALUES (
  'led_rates',
  '{"callout_fee": 2000,
    "module_repair_price": 400,
    "service_area": "Greater Cape Town — or within a 30km radius",
    "service_radius_km": 30,
    "hourly_rate": null,
    "travel_per_km": null,
    "after_hours_multiplier": null}'::jsonb
) ON CONFLICT (key) DO NOTHING;
