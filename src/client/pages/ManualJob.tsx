import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, FINISH_NAMES, type FinishCode, type Me } from "../api";
import { Shell } from "../components/Shell";
import { ErrorNote } from "../components/ui";

type MachineInput = { machine: string; kit: string; finish: FinishCode | "" };

/** Orders that didn't come through Shopify: samples, warranty work, phone orders, other sales systems. */
export function ManualJob({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ sourceSystem: "", orderNumber: "", customerName: "", company: "", customerEmail: "", customerPhone: "", shipTo: "", note: "", isRush: false });
  const [machines, setMachines] = useState<MachineInput[]>([{ machine: "", kit: "", finish: "" }]);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const setMachine = (i: number, patch: Partial<MachineInput>) => setMachines(machines.map((m, x) => (x === i ? { ...m, ...patch } : m)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { id } = await api<{ id: number }>("POST", "/orders/manual", { ...form, machines });
      const canAssign = me.role === "admin" || me.role === "lead" || me.role === "billing";
      navigate(canAssign ? "/assign" : `/design?order=${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the job");
    }
  };

  const field = (id: keyof typeof form, label: string, opts: { required?: boolean; type?: string; placeholder?: string } = {}) => (
    <div className="field">
      <label htmlFor={`mj-${id}`}>{label}</label>
      <input id={`mj-${id}`} className="input" type={opts.type ?? "text"} value={form[id] as string} onChange={set(id)} required={opts.required} placeholder={opts.placeholder} />
    </div>
  );

  return (
    <Shell me={me} title="New manual job">
      <form className="panel" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>
          For work with no Shopify order: samples, warranty work, phone orders and orders from other sales systems. It goes to assignment like any other order.
        </p>
        <div className="form-grid">
          {field("sourceSystem", "Where the order came from", { required: true, placeholder: "e.g. Phone order, eBay, warranty" })}
          {field("orderNumber", "Order number there", { required: true })}
          {field("customerName", "Customer", { required: true })}
          {field("company", "Company")}
          {field("customerEmail", "Email", { type: "email" })}
          {field("customerPhone", "Phone")}
        </div>
        {field("shipTo", "Ship to")}
        <div className="stack">
          <h2 className="section-label">Machines</h2>
          {machines.map((m, i) => (
            <div key={i} className="form-grid" style={{ alignItems: "end" }}>
              <div className="field">
                <label htmlFor={`mj-machine-${i}`}>Machine</label>
                <input id={`mj-machine-${i}`} className="input" value={m.machine} onChange={(e) => setMachine(i, { machine: e.target.value })} required placeholder="e.g. CAT 259D3" />
              </div>
              <div className="field">
                <label htmlFor={`mj-kit-${i}`}>Kit</label>
                <input id={`mj-kit-${i}`} className="input" value={m.kit} onChange={(e) => setMachine(i, { kit: e.target.value })} placeholder="e.g. Full wrap kit" />
              </div>
              <div className="field">
                <label htmlFor={`mj-finish-${i}`}>Finish</label>
                <select id={`mj-finish-${i}`} className="select" value={m.finish} onChange={(e) => setMachine(i, { finish: e.target.value as FinishCode })} required>
                  <option value="" disabled>
                    Pick a finish
                  </option>
                  {Object.entries(FINISH_NAMES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} · {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                {machines.length > 1 && (
                  <button type="button" className="btn btn--link" onClick={() => setMachines(machines.filter((_, x) => x !== i))}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <div>
            <button type="button" className="btn" onClick={() => setMachines([...machines, { machine: "", kit: "", finish: "" }])}>
              Add another machine
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="mj-note">Notes</label>
          <textarea id="mj-note" className="textarea" rows={2} value={form.note} onChange={set("note")} />
        </div>
        <label className="check">
          <input type="checkbox" checked={form.isRush} onChange={(e) => setForm({ ...form, isRush: e.target.checked })} />
          Rush
        </label>
        <ErrorNote error={error} />
        <div>
          <button type="submit" className="btn btn--primary">
            Create job
          </button>
        </div>
      </form>
    </Shell>
  );
}
