import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Me, type ReplyTemplate } from "../api";
import { Shell } from "../components/Shell";
import { ErrorNote } from "../components/ui";
import { dayTime } from "../format";

// TY's settings for the proof page and customer emails. The same choices Approve Pro had,
// minus the ones this app handles elsewhere (logins, assignment, styling).

type Settings = Record<string, string>;
interface EmailTemplate {
  on: boolean;
  subject: string;
  heading: string;
  body: string;
  button: string;
}
interface SettingsResponse {
  settings: Settings;
  emails: { kind: string; name: string; when: string }[];
  klaviyoConnected: boolean;
  appOrigin: string | null;
  outbox: { id: number; kind: string; toEmail: string; status: string; createdAt: string; sentAt: string | null; error: string | null; orderNumber: string | null; sentBy: string | null; subject: string }[];
}

const SAMPLE = { first_name: "Rick", order_number: "514863584", designer: "Alissa", machines: "Bobcat T770 and JCB 4TS-8T", message: "Can you send a vector version of your logo?" };
const sample = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (SAMPLE as Record<string, string>)[k] ?? m);

function Card({ title, intro, children, onSave, saveLabel = "Save", status }: { title: string; intro?: ReactNode; children: ReactNode; onSave?: () => void; saveLabel?: string; status?: ReactNode }) {
  return (
    <section className="panel settings-card" aria-label={title}>
      <div className="settings-card__body">
        <h2 className="settings-card__title">{title}</h2>
        {intro && <p className="settings-card__intro">{intro}</p>}
        {children}
      </div>
      {onSave && (
        <div className="settings-card__foot">
          {status}
          <button type="button" className="btn btn--dark" onClick={onSave}>
            {saveLabel}
          </button>
        </div>
      )}
    </section>
  );
}

function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check check--top">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check__text">
        <span>{label}</span>
        {help && <span className="help">{help}</span>}
      </span>
    </label>
  );
}

function Select({ id, label, help, value, options, onChange }: { id: string; label: string; help?: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 360 }}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {help && <span className="help">{help}</span>}
    </div>
  );
}

function Text({ id, label, help, value, onChange, multiline, placeholder }: { id: string; label: string; help?: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} className="textarea" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

const WORDING: [string, string][] = [
  ["text_ready_title", "Proof ready: page title"],
  ["text_ready_message", "Proof ready: message"],
  ["text_approve_button", "Approve button"],
  ["text_approve_note", "Under the approve button"],
  ["text_approve_confirm", "Approve confirmation message"],
  ["text_changes_button", "Send changes button"],
  ["text_approved_title", "Approved: page title"],
  ["text_approved_message", "Approved: message"],
  ["text_changes_title", "Changes sent: page title"],
  ["text_changes_message", "Changes sent: message"],
  ["text_partial_title", "Partly approved: page title"],
  ["text_partial_message", "Partly approved: message"],
  ["text_waiting_title", "Before the first proof: page title"],
  ["text_waiting_message", "Before the first proof: message"],
  ["text_store_button", '"Go to store" button (leave empty to hide)'],
];

export function ProofSettings({ me }: { me: Me }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [s, setS] = useState<Settings>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const [draft, setDraft] = useState<{ id: number | null; name: string; body: string } | null>(null);

  const load = useCallback(async () => {
    const d = await api<SettingsResponse>("GET", "/proof-settings");
    setData(d);
    setS(d.settings);
    setTemplates(await api<ReplyTemplate[]>("GET", "/reply-templates"));
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load settings"));
  }, [load]);

  const set = (k: string) => (v: string) => setS((x) => ({ ...x, [k]: v }));
  const flag = (k: string) => (v: boolean) => setS((x) => ({ ...x, [k]: v ? "1" : "0" }));
  const tpl = (kind: string): EmailTemplate => JSON.parse(s[`email_${kind}`] ?? '{"on":false,"subject":"","heading":"","body":"","button":""}');
  const setTpl = (kind: string, patch: Partial<EmailTemplate>) => setS((x) => ({ ...x, [`email_${kind}`]: JSON.stringify({ ...tpl(kind), ...patch }) }));

  const save = (section: string, keys: string[]) => async () => {
    setError(null);
    setSaved(null);
    try {
      await api("PUT", "/proof-settings", Object.fromEntries(keys.map((k) => [k, s[k] ?? ""])));
      setSaved(section);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save");
    }
  };
  const savedNote = (section: string) => (saved === section ? <span className="small" style={{ color: "var(--success)", fontWeight: 600 }}>Saved</span> : null);

  const saveTemplate = async () => {
    if (!draft) return;
    setError(null);
    try {
      if (draft.id) await api("PATCH", `/reply-templates/${draft.id}`, { name: draft.name, body: draft.body });
      else await api("POST", "/reply-templates", { name: draft.name, body: draft.body });
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the template");
    }
  };

  if (!data) return <Shell me={me} title="Proof settings">{error ? <ErrorNote error={error} /> : null}</Shell>;

  const linkExample = `${s.proof_link_base?.trim() || `${data.appOrigin || window.location.origin}/proof`}/…`;
  const emailKeys = data.emails.map((e) => `email_${e.kind}`);

  return (
    <Shell me={me} title="Proof settings">
      <div className="settings">
        <ErrorNote error={error} />

        <Card
          title="Approval page"
          intro="The page customers open from their email to approve a design or ask for changes."
          onSave={save("page", ["proof_change_window_minutes", "proof_show_history", "proof_download_after_approval", "proof_link_base", "proof_store_url"])}
          status={savedNote("page")}
        >
          <Select
            id="window"
            label="Let the customer change an approval"
            help="Shows “Approved by mistake? Change it” for this long, as long as the job hasn't gone to production."
            value={s.proof_change_window_minutes ?? "30"}
            onChange={set("proof_change_window_minutes")}
            options={[
              ["0", "Never"],
              ["15", "Within 15 minutes"],
              ["30", "Within 30 minutes"],
              ["60", "Within 1 hour"],
              ["240", "Within 4 hours"],
            ]}
          />
          <Toggle label="Show revision history" help="Customers can see earlier versions of their design." checked={s.proof_show_history === "1"} onChange={flag("proof_show_history")} />
          <Toggle label="Show a download button after approval" help="The customer can save their approved design." checked={s.proof_download_after_approval === "1"} onChange={flag("proof_download_after_approval")} />
          <Text
            id="linkbase"
            label="Customer link address"
            value={s.proof_link_base ?? ""}
            onChange={set("proof_link_base")}
            placeholder="https://dirtygraphix.com/apps/proof"
            help={`Leave empty to use this app's own address. Once the store's app proxy is set up, enter https://dirtygraphix.com/apps/proof so links show your domain. Links look like: ${linkExample}`}
          />
          <Text id="store" label='"Go to store" link' value={s.proof_store_url ?? ""} onChange={set("proof_store_url")} />
        </Card>

        <Card title="Customer feedback" onSave={save("feedback", ["proof_customer_uploads", "proof_comment_on_approve", "proof_max_comment", "proof_require_ack", "proof_ack_items"])} status={savedNote("feedback")}>
          <Toggle label="Allow file uploads" help="Customers can attach photos or logo files when they ask for changes or send a message (up to 5 files, 20 MB each)." checked={s.proof_customer_uploads === "1"} onChange={flag("proof_customer_uploads")} />
          <Toggle label="Allow a comment when approving" help="Off: customers can only comment when they ask for changes." checked={s.proof_comment_on_approve === "1"} onChange={flag("proof_comment_on_approve")} />
          <Select
            id="maxc"
            label="Longest comment"
            value={s.proof_max_comment ?? "500"}
            onChange={set("proof_max_comment")}
            options={[
              ["250", "250 characters"],
              ["500", "500 characters"],
              ["1000", "1,000 characters"],
              ["2000", "2,000 characters"],
            ]}
          />
          <Toggle
            label="Require the approval checklist"
            help="Customers tick every item below before the Approve button works. Off: the list still shows as a reminder."
            checked={s.proof_require_ack === "1"}
            onChange={flag("proof_require_ack")}
          />
          <Text id="ack" label="“Before you approve, check:” items (one per line)" value={s.proof_ack_items ?? ""} onChange={set("proof_ack_items")} multiline />
        </Card>

        <Card title="Page wording" intro="Use {designer} for the designer's first name and {first_name} for the customer's." onSave={save("wording", WORDING.map(([k]) => k))} status={savedNote("wording")}>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" }}>
            {WORDING.map(([k, label]) => (
              <Text key={k} id={k} label={label} value={s[k] ?? ""} onChange={set(k)} />
            ))}
          </div>
        </Card>

        <Card
          title="Reminders"
          intro="Sent automatically while a proof waits on the customer, during business hours only. Designers can also send one from the order at any time."
          onSave={save("reminders", ["reminder_after_days", "reminder_recurring", "reminder_max", "reminder_stop_days"])}
          status={savedNote("reminders")}
        >
          <Select
            id="after"
            label="Send a reminder"
            value={s.reminder_after_days ?? "2"}
            onChange={set("reminder_after_days")}
            options={[
              ["0", "Never automatically"],
              ["1", "After 1 day"],
              ["2", "After 2 days"],
              ["3", "After 3 days"],
              ["5", "After 5 days"],
              ["7", "After 7 days"],
            ]}
          />
          <Toggle label="Keep reminding" help="Repeats on the same schedule until the customer answers." checked={s.reminder_recurring === "1"} onChange={flag("reminder_recurring")} />
          <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
            <Select id="max" label="At most" value={s.reminder_max ?? "4"} onChange={set("reminder_max")} options={["2", "3", "4", "5", "6"].map((n) => [n, `${n} reminders`])} />
            <Select id="stop" label="Stop after" value={s.reminder_stop_days ?? "28"} onChange={set("reminder_stop_days")} options={["14", "21", "28"].map((n) => [n, `${n} days`])} />
          </div>
        </Card>

        <Card
          title="Customer emails"
          intro="Turn each email on or off and edit its wording. Placeholders: {first_name} {order_number} {designer} {machines} {message}."
          onSave={save("emails", emailKeys)}
          status={savedNote("emails")}
        >
          <div>
            {data.emails.map((e) => {
              const t = tpl(e.kind);
              const open = editing === e.kind;
              return (
                <div key={e.kind}>
                  <div className="email-row">
                    <span className="switch">
                      <input type="checkbox" role="switch" aria-label={`${e.name} email`} checked={t.on} onChange={(x) => setTpl(e.kind, { on: x.target.checked })} />
                      <span aria-hidden="true" />
                    </span>
                    <span className="check__text">
                      <span className="strong">{e.name}</span>
                      <span className="help">{e.when}</span>
                    </span>
                    <button type="button" className="btn" aria-expanded={open} onClick={() => setEditing(open ? null : e.kind)}>
                      {open ? "Done" : "Edit wording"}
                    </button>
                  </div>
                  {open && (
                    <div className="email-edit">
                      <div className="stack">
                        <Text id={`${e.kind}-subject`} label="Subject" value={t.subject} onChange={(v) => setTpl(e.kind, { subject: v })} />
                        <Text id={`${e.kind}-heading`} label="Heading" value={t.heading} onChange={(v) => setTpl(e.kind, { heading: v })} />
                        <Text id={`${e.kind}-body`} label="Message" value={t.body} onChange={(v) => setTpl(e.kind, { body: v })} multiline />
                        <Text id={`${e.kind}-button`} label="Button" value={t.button} onChange={(v) => setTpl(e.kind, { button: v })} />
                      </div>
                      <div className="stack">
                        <span className="field__label">Preview</span>
                        <span className="small muted">Subject: {sample(t.subject)}</span>
                        <div className="email-preview">
                          <span className="email-preview__brand">Dirty Graphix</span>
                          <span className="small muted">Order #{SAMPLE.order_number}</span>
                          <h3 className="email-preview__heading">{sample(t.heading)}</h3>
                          <p className="email-preview__body">{sample(t.body)}</p>
                          <span className="email-preview__button">{sample(t.button)}</span>
                        </div>
                        <span className="help">The final look comes from the branded Klaviyo template. This shows the words.</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Email sending" onSave={save("sending", ["email_bcc"])} status={savedNote("sending")}>
          <div className={`notice${data.klaviyoConnected ? "" : " notice--warn"}`}>
            {data.klaviyoConnected
              ? "Connected to Klaviyo. Emails send within a minute of being queued."
              : "Klaviyo isn't connected yet, so emails are saved below but not sent. Connecting it is a go-live step."}
          </div>
          <Text id="bcc" label="BCC email" value={s.email_bcc ?? ""} onChange={set("email_bcc")} placeholder="e.g. orders@dirtygraphix.com" help="If set, a copy of every customer email goes to this address." />
        </Card>

        <Card title="Reply templates" intro="Canned text designers can drop into a proof note or a message. Cierra can manage these too.">
          {templates.length === 0 && !draft && <p className="empty">No reply templates yet.</p>}
          {templates.map((t) => (
            <div key={t.id} className="email-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto" }}>
              <span className="check__text">
                <span className="strong">{t.name}</span>
                <span className="help" style={{ whiteSpace: "pre-wrap" }}>{t.body}</span>
              </span>
              <button type="button" className="btn" onClick={() => setDraft({ id: t.id, name: t.name, body: t.body })}>
                Edit
              </button>
              <button
                type="button"
                className="btn btn--bad"
                onClick={async () => {
                  await api("PATCH", `/reply-templates/${t.id}`, { active: false });
                  await load();
                }}
              >
                Delete
              </button>
            </div>
          ))}
          {draft ? (
            <div className="form-box" style={{ marginTop: 0 }}>
              <Text id="tname" label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="e.g. First proof" />
              <Text id="tbody" label="Text" value={draft.body} onChange={(v) => setDraft({ ...draft, body: v })} multiline placeholder="Hey {first_name}, here's your first mockup! Let me know what you think. Thanks, {designer}" />
              <div className="row">
                <button type="button" className="btn btn--dark" disabled={!draft.name.trim() || !draft.body.trim()} onClick={saveTemplate}>
                  Save template
                </button>
                <button type="button" className="btn btn--link" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setDraft({ id: null, name: "", body: "" })}>
              New template
            </button>
          )}
        </Card>

        <Card title="Recent customer emails" intro="The last 30 emails, newest first.">
          {data.outbox.length === 0 ? (
            <p className="empty">No emails yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="outbox">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Order</th>
                    <th>Email</th>
                    <th>To</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outbox.map((o) => (
                    <tr key={o.id}>
                      <td>{dayTime(o.createdAt)}</td>
                      <td>{o.orderNumber ?? "—"}</td>
                      <td>
                        {o.subject}
                        {o.sentBy && <span className="help"> · sent by {o.sentBy}</span>}
                      </td>
                      <td>{o.toEmail}</td>
                      <td>
                        {o.status === "sent" ? (
                          <span className="pill pill--success">Sent</span>
                        ) : o.status === "failed" ? (
                          <span className="pill pill--danger" title={o.error ?? ""}>Failed</span>
                        ) : (
                          <span className="pill">{data.klaviyoConnected ? "Sending" : "Waiting for Klaviyo"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
