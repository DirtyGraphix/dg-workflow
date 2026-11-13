import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { api, type Me } from "../api";

const canAssign = (me: Me) => me.role === "admin" || me.role === "lead" || me.role === "billing";

/** The header bar every screen shares, then the page. */
export function Shell({ me, title, actions, children }: { me: Me; title: string; actions?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" }).format(new Date());
  const signOut = async () => {
    await api("POST", "/logout").catch(() => undefined);
    navigate("/login");
  };
  return (
    <>
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__left">
            <span className="app-header__brand">Dirty Graphix</span>
            <h1 className="app-header__title">{title}</h1>
          </div>
          <div className="app-header__right">
            <span className="app-header__who">
              Signed in as <strong>{me.name}</strong> · {today}
            </span>
            {actions}
            {me.takes_orders || me.role === "admin" || me.role === "lead" ? (
              <NavLink className="app-header__btn" to="/design" end>
                Design queue
              </NavLink>
            ) : null}
            {canAssign(me) && (
              <NavLink className="app-header__btn" to="/assign">
                Assign
              </NavLink>
            )}
            {me.role === "admin" && (
              <NavLink className="app-header__btn" to="/people">
                People
              </NavLink>
            )}
            <button type="button" className="app-header__btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
