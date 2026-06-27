/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional build-time default for the live-run backend (set in Netlify env).
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
