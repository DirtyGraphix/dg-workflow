-- Phase 2: the customer proof page that replaces Approve Pro.
-- See docs/workflow-spec.md, "Replacing Approve Pro", "Order flow" and "Customer emails".

-- The secret part of the customer's proof link. Made the first time a proof goes out.
ALTER TABLE orders ADD COLUMN proof_token TEXT;
CREATE UNIQUE INDEX orders_proof_token ON orders(proof_token);
-- Set when the customer writes in, cleared when the designer opens or answers the order.
ALTER TABLE orders ADD COLUMN customer_unread INTEGER NOT NULL DEFAULT 0;

-- One proof sheet sent to the customer. It covers one machine or several: a single sheet for all
-- machines is approved or changed as a whole, and split proofs (one per machine) are decided one by one.
CREATE TABLE proofs (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  number        INTEGER NOT NULL,   -- 1 = first proof, 2 = revision 1, ... counted per machine
  message       TEXT,               -- the designer's note to the customer
  sent_by       INTEGER REFERENCES people(id),
  sent_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','approved','changes_requested','replaced','withdrawn')),
  decided_at    TEXT,
  viewed_at     TEXT,             -- first time the customer opened it ("Customer viewed the design")
  last_viewed_at TEXT,
  approved_name TEXT              -- name the customer typed, when the approval checklist asks for it
);
CREATE INDEX proofs_order ON proofs(order_id, sent_at);

CREATE TABLE proof_machines (
  proof_id   INTEGER NOT NULL REFERENCES proofs(id),
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  PRIMARY KEY (proof_id, machine_id)
);

-- Files live in R2. Proof images are what the customer approves; customer files ride along with messages.
CREATE TABLE files (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  proof_id     INTEGER REFERENCES proofs(id),
  message_id   INTEGER,
  r2_key       TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT NOT NULL CHECK (uploaded_by IN ('staff','customer')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX files_order ON files(order_id);

-- The conversation with the customer. Everything stays on the order, never in a personal inbox.
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  proof_id   INTEGER REFERENCES proofs(id),
  author     TEXT NOT NULL CHECK (author IN ('customer','staff')),
  person_id  INTEGER REFERENCES people(id),
  kind       TEXT NOT NULL CHECK (kind IN ('changes','message','reply')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX messages_order ON messages(order_id, created_at);

-- Canned text for the designer's note on a proof or a reply to the customer.
CREATE TABLE reply_templates (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Every customer email, queued here first so nothing is lost and TY can see exactly what went out.
-- Klaviyo does the sending once its key is set.
CREATE TABLE outbox (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER REFERENCES orders(id),
  kind         TEXT NOT NULL,
  to_email     TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_by      INTEGER REFERENCES people(id),  -- set when someone sent it by hand (reminders, messages)
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','off')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent_at      TEXT,
  error        TEXT
);
CREATE INDEX outbox_status ON outbox(status, created_at);
CREATE INDEX outbox_order ON outbox(order_id, kind, created_at);

-- Intake for the new product page (product-page-v2): priced option lines that are part of the kit's design.
INSERT INTO settings (key, value) VALUES ('design_option_patterns', 'model options');

-- Defaults copy TY's Approve Pro settings, except where the workflow spec says otherwise.
INSERT INTO settings (key, value) VALUES
  -- Approval page
  ('proof_change_window_minutes', '30'),      -- "Allow customer to change approval: within 30 minutes"
  ('proof_show_history', '0'),                 -- customers don't see earlier versions
  ('proof_download_after_approval', '1'),
  ('proof_link_base', ''),                     -- e.g. https://dirtygraphix.com/apps/proof once the app proxy is set up
  ('proof_customer_uploads', '1'),             -- customers can attach files to change requests
  ('proof_comment_on_approve', '0'),           -- comments only when asking for changes
  ('proof_max_comment', '500'),
  ('proof_require_ack', '0'),                  -- tick the "before you approve" list first
  ('proof_ack_items', 'Names, numbers and spelling
Logo placement and colors
Finish matches what you ordered'),
  ('proof_store_url', 'https://dirtygraphix.com'),
  -- Approval page wording
  ('text_ready_title', 'Your proof is ready'),
  ('text_ready_message', 'Look it over hard. Once you approve, this is what goes on your machine.'),
  ('text_approved_title', 'Design approved!'),
  ('text_approved_message', 'Thanks for approving. Your kit is headed to the production queue. Most orders print within 7 business days.'),
  ('text_changes_title', 'Changes received'),
  ('text_changes_message', 'Thanks for your feedback. {designer} will send you a revised design shortly.'),
  ('text_partial_title', 'Feedback received'),
  ('text_partial_message', 'Thanks! We saved your approval and your changes. {designer} will send a revised design shortly.'),
  ('text_waiting_title', 'Your design is in the works'),
  ('text_waiting_message', '{designer} is working on your design. You''ll get an email the moment your proof is ready.'),
  ('text_approve_button', 'Approve design'),
  ('text_approve_note', 'Approving sends your kit to the production queue. Most orders print within 7 business days.'),
  ('text_approve_confirm', 'Please confirm you want to APPROVE this design. This is what we print.'),
  ('text_changes_button', 'Send changes'),
  ('text_store_button', 'Go to store'),
  -- Reminders to the customer while a proof waits (calendar days, sent during business hours)
  ('reminder_after_days', '2'),
  ('reminder_recurring', '1'),
  ('reminder_max', '4'),
  ('reminder_stop_days', '28'),
  -- Email sending
  ('email_bcc', ''),
  -- Each customer email: on/off plus its wording. {first_name} {order_number} {designer} {machines} {message}
  ('email_proof_ready', '{"on":true,"subject":"Your Dirty Graphix proof is ready","heading":"Your custom design is ready!","body":"Hi {first_name}! {designer} finished your proof for {machines}. Look it over and approve it or tell us what to change.","button":"Review design"}'),
  ('email_revision_ready', '{"on":true,"subject":"Your revised proof is ready","heading":"Your revision is ready","body":"Hi {first_name}! {designer} made your changes to {machines}. Take a look and approve it or tell us what else to change.","button":"Review design"}'),
  ('email_reminder', '{"on":true,"subject":"Your proof is waiting on you","heading":"Your design is waiting","body":"Hi {first_name}, your proof for {machines} is still waiting for your OK. Nothing prints until you approve it.","button":"Review design"}'),
  ('email_approved', '{"on":true,"subject":"Design approved: order {order_number}","heading":"Design approved!","body":"Thanks {first_name}! Your design for {machines} is approved and headed to the production queue. Most orders print within 7 business days.","button":"View your design"}'),
  ('email_changes_received', '{"on":false,"subject":"We got your changes","heading":"Changes received","body":"Thanks {first_name}. {designer} has your notes and will send a revised design shortly.","button":"View your order"}'),
  ('email_reply', '{"on":true,"subject":"{designer} replied about your design","heading":"New message from {designer}","body":"Hi {first_name}, {designer} replied about order {order_number}:\n\n{message}","button":"Reply"}'),
  ('email_message', '{"on":true,"subject":"A message about your order {order_number}","heading":"A message from {designer}","body":"Hi {first_name},\n\n{message}","button":"Reply"}');
