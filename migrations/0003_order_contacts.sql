-- Extra people who get a view-only copy of each proof (e.g. the owner when the foreman ordered).
-- Only the main customer approves or asks for changes. Each extra person has their own link.
CREATE TABLE order_contacts (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  added_by    INTEGER REFERENCES people(id),
  added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  removed_at  TEXT
);
CREATE INDEX order_contacts_order ON order_contacts(order_id);

INSERT INTO settings (key, value) VALUES
  ('email_viewer_copy', '{"on":true,"subject":"A Dirty Graphix proof to look over: order {order_number}","heading":"A copy of the proof","body":"Hi! {customer_name} asked us to send you a copy of the design for {machines}. Take a look. {customer_name} approves it or tells {designer} what to change.","button":"View the design"}');
