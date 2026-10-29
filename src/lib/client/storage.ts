/** localStorage that never throws (private windows, blocked storage). */
export const storage = {
  get<T>(key: string): T | null {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? null : (JSON.parse(v) as T);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

export interface MyRow {
  participantId: string;
  editToken: string;
}

export const keys = {
  organizer: (eventId: string) => `w2m:org:${eventId}`,
  me: (eventId: string) => `w2m:me:${eventId}`,
  units: "w2m:units",
  theme: "w2m:theme",
};

/** Runs before paint (inlined in the layout) so the page doesn't flash the wrong theme. */
export const THEME_BOOT_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("${keys.theme}"));if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
