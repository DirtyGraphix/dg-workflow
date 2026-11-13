-- Phase 1 foundation: people, orders, machines, timeline, checklist, time off, closures.
-- Times are ISO 8601 strings in UTC. Prices are never stored in these tables.

CREATE TABLE people (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- admin: TY. lead: team lead (Cierra). billing: assigns orders and handles billing (Nikki).
  -- designer, production, kits, listings: everyone else.
  role          TEXT NOT NULL CHECK (role IN ('admin','lead','billing','designer','production','kits','listings')),
  takes_orders  INTEGER NOT NULL DEFAULT 0, -- 1 if they appear in the assignment list
  password_hash TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  person_id   INTEGER NOT NULL REFERENCES people(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX sessions_person ON sessions(person_id);

CREATE TABLE orders (
  id                INTEGER PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source IN ('shopify','manual')),
  shopify_order_id  TEXT UNIQUE,
  order_number      TEXT NOT NULL,          -- "#4820", or the other system's number for manual jobs
  source_system     TEXT,                   -- manual jobs: where the order came from
  ordered_at        TEXT NOT NULL,
  received_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  customer_name     TEXT,
  company           TEXT,
  customer_email    TEXT,
  customer_phone    TEXT,
  ship_to           TEXT,
  ship_method       TEXT,
  order_note        TEXT,
  uploads_json      TEXT NOT NULL DEFAULT '[]',   -- [{name, url}] from checkout
  payment_status    TEXT NOT NULL DEFAULT 'unknown', -- paid, partially_paid, pending, refunded, unknown (never an amount)
  is_rush           INTEGER NOT NULL DEFAULT 0,
  is_dealer         INTEGER NOT NULL DEFAULT 0,
  is_custom         INTEGER NOT NULL DEFAULT 0,
  custom_reason     TEXT,                   -- why it was marked custom (tag, product name, or a person's note)
  stage             TEXT NOT NULL DEFAULT 'unassigned' CHECK (stage IN (
                      'unassigned','needs_first_proof','proof_sent','revision_requested',
                      'approved','handed_off','ship_only','cancelled')),
                      -- ship_only: nothing on the order needs design (application kits, apparel), so it goes straight to production
  stage_since       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  assigned_to       INTEGER REFERENCES people(id),
  assigned_at       TEXT,
  in_approve_pro    INTEGER NOT NULL DEFAULT 0, -- proofed in Approve Pro before launch: left out of design stats
  checklist_signed_by INTEGER REFERENCES people(id),
  checklist_signed_at TEXT,
  production_note   TEXT,
  -- Print file deadline pauses: business minutes added to every machine's deadline, plus any open pause.
  print_file_extra_minutes INTEGER NOT NULL DEFAULT 0,
  print_file_paused_at TEXT,
  print_file_paused_by INTEGER REFERENCES people(id),
  print_file_pause_reason TEXT
);
CREATE INDEX orders_stage ON orders(stage);
CREATE INDEX orders_assignee ON orders(assigned_to, stage);

CREATE TABLE machines (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  shopify_line_id  TEXT,
  position         INTEGER NOT NULL DEFAULT 0,
  kind             TEXT NOT NULL DEFAULT 'kit' CHECK (kind IN ('kit','sheetz','design','matching')),
  -- matching: e.g. a Matching Wrapped Yeti. Printed at the end of the run using the approved machine design; never proofed.
  needs_proof      INTEGER NOT NULL DEFAULT 1, -- every design job gets customer proofs today; 0 would skip straight to print file
  machine          TEXT NOT NULL,        -- "John Deere 325G"
  kit              TEXT,                 -- "Full wrap kit"
  finish           TEXT CHECK (finish IN ('GL','MT','GG','CG','PR','CM','CP')),
  selections_json  TEXT NOT NULL DEFAULT '[]', -- customizer selections [{name, value}], no prices
  quarter_length_in REAL,                -- entered by design at 1/4 scale
  length_reason    TEXT,                 -- answer to the "are you sure" length check
  approved_at      TEXT,
  approval_method  TEXT,                 -- proof_page, approve_pro, phone, in_person, text, email, other, matches_machine
  handed_off_at    TEXT,
  handed_off_by    INTEGER REFERENCES people(id)
);
CREATE INDEX machines_order ON machines(order_id);
CREATE INDEX machines_model ON machines(machine, kit);

-- Things on the order that skip design and just ship: application kits, apparel, ADHESOFF.
CREATE TABLE order_items (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  shopify_line_id  TEXT,
  title            TEXT NOT NULL,
  variant          TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  attached_to      INTEGER REFERENCES machines(id) -- e.g. an application kit added to a wrap kit
);
CREATE INDEX order_items_order ON order_items(order_id);

-- Every step on an order, for the timeline and for turnaround stats.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  machine_id INTEGER REFERENCES machines(id),
  kind       TEXT NOT NULL,   -- received, assigned, proof_sent, revision_requested, approved, rejected, checklist_signed,
                              -- length_logged, handed_off, marked_rush, marked_custom, print_file_paused, print_file_resumed, note
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  person_id  INTEGER REFERENCES people(id),
  note       TEXT,
  data_json  TEXT
);
CREATE INDEX events_order ON events(order_id, at);

CREATE TABLE checklist_items (
  id      INTEGER PRIMARY KEY,
  label   TEXT NOT NULL,
  active  INTEGER NOT NULL DEFAULT 1,
  sort    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO checklist_items (label, sort) VALUES
  ('All logos are in the correct place on every machine', 1),
  ('Cut contour lines are set at the correct amount on every machine', 2);

CREATE TABLE time_off (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES people(id),
  starts_on  TEXT NOT NULL,  -- YYYY-MM-DD
  ends_on    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('vacation','sick','other')),
  note       TEXT,
  marked_by  INTEGER NOT NULL REFERENCES people(id),
  marked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One-off shop closures on top of the six holidays.
CREATE TABLE closures (
  day       TEXT PRIMARY KEY, -- YYYY-MM-DD
  reason    TEXT NOT NULL,
  added_by  INTEGER REFERENCES people(id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('length_check_over_pct', '15'),
  ('length_check_under_pct', '15'),
  ('length_check_min_samples', '3'),
  ('rush_tags', 'rush'),
  ('dealer_tags', 'dealer,dealer-b2b'),
  ('custom_tags', 'custom-one-off'),
  -- Line items whose title matches one of these go to design. Everything else ships as-is.
  ('design_kit_patterns', 'wrap kit'),
  ('design_sheetz_patterns', 'sheetz'),
  ('design_other_patterns', 'decals'),
  -- Printed with the order using the approved machine design, no proof of its own.
  ('design_matching_patterns', 'matching wrapped');
