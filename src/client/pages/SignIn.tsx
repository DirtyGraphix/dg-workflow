import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "../api";
import { ErrorNote } from "../components/ui";

function Card({ title, children, onSubmit }: { title: string; children: React.ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <div className="signin">
      <form className="signin__card" onSubmit={onSubmit}>
        <span className="signin__brand">Dirty Graphix</span>
        <h1 className="signin__title">{title}</h1>
        {children}
      </form>
    </div>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/login", { email, password });
      onDone();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Sign in" onSubmit={submit}>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <ErrorNote error={error} />
      <button type="submit" className="btn btn--primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </Card>
  );
}

/** First-time setup: TY creates his admin login with the one-time setup token. */
export function Setup({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ token: "", name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api("POST", "/setup", form);
      onDone();
      navigate("/people");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Setup failed");
    }
  };
  return (
    <Card title="First-time setup" onSubmit={submit}>
      <p className="muted small" style={{ margin: 0 }}>
        Creates the first admin login. This only works once.
      </p>
      <div className="field">
        <label htmlFor="token">Setup token</label>
        <input id="token" className="input" value={form.token} onChange={set("token")} required />
      </div>
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" className="input" value={form.name} onChange={set("name")} required />
      </div>
      <div className="field">
        <label htmlFor="setup-email">Email</label>
        <input id="setup-email" className="input" type="email" value={form.email} onChange={set("email")} required />
      </div>
      <div className="field">
        <label htmlFor="setup-password">Password (at least 10 characters)</label>
        <input id="setup-password" className="input" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required minLength={10} />
      </div>
      <ErrorNote error={error} />
      <button type="submit" className="btn btn--primary">
        Create admin login
      </button>
    </Card>
  );
}
