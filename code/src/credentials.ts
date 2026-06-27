// On-the-fly credential store. When a tool is added to an agent, the builder
// prompts for exactly that tool's fields and stores them HERE — in memory only,
// keyed by env-var name. Secrets never enter the canvas FlowState or the
// generated Python; export writes only a .env.example with the names.

export type CredStore = Record<string, string>;

const KEY = "vab_credentials";

export function loadCreds(): CredStore {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveCreds(creds: CredStore): void {
  // sessionStorage, not localStorage: cleared when the tab closes.
  sessionStorage.setItem(KEY, JSON.stringify(creds));
}

export function hasAllFields(creds: CredStore, fieldNames: string[]): boolean {
  return fieldNames.every((n) => (creds[n] ?? "").trim().length > 0);
}
