import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { api, ApiError, type Me } from "./api";
import { Login, Setup } from "./pages/SignIn";
import { DesignQueue } from "./pages/DesignQueue";
import { Assign } from "./pages/Assign";
import { People } from "./pages/People";
import { ManualJob } from "./pages/ManualJob";
import { ProofSettings } from "./pages/ProofSettings";

const home = (me: Me) => (me.role === "billing" ? "/assign" : "/design");

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const location = useLocation();

  const load = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, location.pathname === "/login"]);

  if (me === undefined) return null;

  if (!me) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup onDone={load} />} />
        <Route path="*" element={<Login onDone={load} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/design" element={<DesignQueue me={me} />} />
      <Route path="/assign" element={<Assign me={me} />} />
      <Route path="/people" element={me.role === "admin" ? <People me={me} /> : <Navigate to={home(me)} replace />} />
      <Route path="/settings/proofs" element={me.role === "admin" ? <ProofSettings me={me} /> : <Navigate to={home(me)} replace />} />
      <Route path="/jobs/new" element={<ManualJob me={me} />} />
      <Route path="*" element={<Navigate to={home(me)} replace />} />
    </Routes>
  );
}
