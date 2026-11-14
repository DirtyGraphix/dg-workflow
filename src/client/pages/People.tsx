import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Me, type Role } from "../api";
import { Shell } from "../components/Shell";
import { ErrorNote } from "../components/ui";
import { todayYmd } from "../format";

interface PersonRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  takes_orders: number;
  active: number;
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin (TY)",
  lead: "Team lead",
  billing: "Assigns and billing",
  designer: "Designer",
  production: "Production",
  kits: "Kit development",
  listings: "Shopify listings",
};

function AddPerson({ onAdded }: { onAdded: () => void }) {
  const blank = { name: "", email: "", role: "designer" as Role, takesOrders: true, password: "" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    try {
      await api("POST", "/people", form);
      setDone(`${form.name} can sign in now with that email and password.`);
      setForm(blank);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add them");
    }
  };
  return (
    <form className="panel" onSubmit={submit}>
      <h2 className="group-title" style={{ fontSize: 22 }}>
        Add a person
      </h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="p-name">Name</label>
          <input id="p-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="p-email">Email</label>
          <input id="p-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="p-role">Role</label>
          <select id="p-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-pass">Starting password (10+ characters)</label>
          <input id="p-pass" className="input" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={form.takesOrders} onChange={(e) => setForm({ ...form, takesOrders: e.target.checked })} />
        Takes design orders (shows up in assignment)
      </label>
      <ErrorNote error={error} />
      {done && <p className="signed" style={{ margin: 0 }}>{done}</p>}
      <div>
        <button type="submit" className="btn btn--primary">
          Add person
        </button>
      </div>
    </form>
  );
}

function TimeOff({ people, onSaved }: { people: PersonRow[]; onSaved: () => void }) {
  const [form, setForm] = useState({ personId: 0, startsOn: todayYmd(), endsOn: todayYmd(), kind: "vacation" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    try {
      await api("POST", `/people/${form.personId}/time-off`, form);
      setDone("Saved. They won't get new orders on those days.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save");
    }
  };
  return (
    <form className="panel" onSubmit={submit}>
      <h2 className="group-title" style={{ fontSize: 22 }}>
        Mark someone out
      </h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="t-person">Person</label>
          <select id="t-person" className="select" value={form.personId} onChange={(e) => setForm({ ...form, personId: Number(e.target.value) })} required>
            <option value={0} disabled>
              Pick someone
            </option>
            {people
              .filter((p) => p.active && p.takes_orders)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-kind">Reason</label>
          <select id="t-kind" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="vacation">Vacation</option>
            <option value="sick">Sick</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-start">First day out</label>
          <input id="t-start" className="input" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="t-end">Last day out</label>
          <input id="t-end" className="input" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} required />
        </div>
      </div>
      <ErrorNote error={error} />
      {done && <p className="signed" style={{ margin: 0 }}>{done}</p>}
      <div>
        <button type="submit" className="btn btn--dark" disabled={!form.personId}>
          Save time off
        </button>
      </div>
    </form>
  );
}

export function People({ me }: { me: Me }) {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const load = useCallback(async () => setPeople(await api<PersonRow[]>("GET", "/people")), []);
  useEffect(() => {
    load();
  }, [load]);

  const update = async (id: number, body: Record<string, unknown>) => {
    await api("PATCH", `/people/${id}`, body);
    await load();
  };

  return (
    <Shell me={me} title="People">
      <section className="panel" aria-label="Everyone with a login">
        <h2 className="group-title" style={{ fontSize: 22 }}>
          Everyone with a login
        </h2>
        <div className="people">
          <div className="people__row people__row--head">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Takes orders</span>
            <span />
          </div>
          {people.map((p) => (
            <div key={p.id} className="people__row" style={p.active ? undefined : { color: "var(--muted)" }}>
              <span className="strong">{p.name}</span>
              <span style={{ overflowWrap: "anywhere" }}>{p.email}</span>
              <select className="select" style={{ minWidth: 0 }} aria-label={`${p.name}'s role`} value={p.role} disabled={p.id === me.id} onChange={(e) => update(p.id, { role: e.target.value })}>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <label className="check">
                <input type="checkbox" checked={!!p.takes_orders} onChange={(e) => update(p.id, { takesOrders: e.target.checked })} />
                {p.takes_orders ? "Yes" : "No"}
              </label>
              <span>
                {p.id !== me.id && (
                  <button type="button" className="btn btn--link" onClick={() => update(p.id, { active: !p.active })}>
                    {p.active ? "Turn off login" : "Turn login back on"}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
      <div className="split">
        <div className="split__side" style={{ flexBasis: 520 }}>
          <AddPerson onAdded={load} />
        </div>
        <div className="split__main" style={{ flexBasis: 420 }}>
          <TimeOff people={people} onSaved={load} />
        </div>
      </div>
    </Shell>
  );
}
