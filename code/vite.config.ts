import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Self-contained SPA. Canvas + code generation happen client-side.
//
// LLM calls (vibe-fill + live Run) go through a dev-server proxy at /llm so that:
//   1. CORS isn't a problem (browser talks to same origin),
//   2. the API key stays server-side (never shipped to the browser).
//
// Configure in a .env.local file (see .env.local.example):
//   LLM_UPSTREAM=https://api.groq.com/openai/v1
//   LLM_API_KEY=gsk_...
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const upstream = env.LLM_UPSTREAM || "https://api.groq.com/openai/v1";
  const key = env.LLM_API_KEY || "";

  return {
    // relative asset paths so the build works on GitHub Pages (served from a subpath)
    base: "./",
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        "/llm": {
          target: upstream,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/llm/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (key) proxyReq.setHeader("Authorization", `Bearer ${key}`);
            });
          },
        },
      },
    },
  };
});
