"use client";

import { useCallback, useEffect, useState } from "react";
import type { Units } from "../format";
import { keys, storage } from "./storage";

export type ThemePref = "system" | "light" | "dark";

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const saved = storage.get<ThemePref>(keys.theme);
    if (saved === "light" || saved === "dark") setPrefState(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    if (p === "system") {
      storage.remove(keys.theme);
      delete document.documentElement.dataset.theme;
    } else {
      storage.set(keys.theme, p);
      document.documentElement.dataset.theme = p;
    }
  }, []);

  return { pref, setPref, dark: pref === "dark" || (pref === "system" && systemDark) };
}

export function useUnits() {
  const [units, setUnitsState] = useState<Units>("mi");
  useEffect(() => {
    if (storage.get<Units>(keys.units) === "km") setUnitsState("km");
  }, []);
  const setUnits = useCallback((u: Units) => {
    setUnitsState(u);
    storage.set(keys.units, u);
  }, []);
  return { units, setUnits };
}
