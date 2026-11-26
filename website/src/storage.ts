// saved settings can be missing, corrupt, from an older shape, or unreadable;
// any of those falls back to the defaults
export function load<T extends object>(key: string, defaults: T): T {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved !== null && typeof saved === "object") return { ...defaults, ...saved };
  } catch {}
  return { ...defaults };
}

// full or blocked storage only loses the setting
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
