"use client";

import { useEffect, useState } from "react";

/**
 * 006 — Hook SSR-safe de breakpoint (matchMedia en efecto, nunca en render).
 * Devuelve false en SSR/primer render y se actualiza tras el mount — consistente
 * con el patrón `panelOpen`/localStorage del inbox (evita hydration mismatch).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
