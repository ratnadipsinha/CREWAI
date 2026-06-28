/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional build-time default for the live-run backend (set in CI env).
  readonly VITE_BACKEND_URL?: string;
  // Optional shared token sent to the backend when it enforces BACKEND_TOKEN.
  readonly VITE_BACKEND_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
