import { useEffect, useRef } from "react";

/**
 * Runs `refresh` every `ms` while the tab is open and visible, and right away when the person comes back
 * to the tab. Keeps queues and order screens current without anyone reloading the page.
 */
export function useLiveRefresh(refresh: () => void, ms = 20_000) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = setInterval(tick, ms);
    const onVisible = () => document.visibilityState === "visible" && latest.current();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [ms]);
}
