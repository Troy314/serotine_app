import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the React app runs on :5173 and the API on :3101 (a different
// port than achievement-vault's :3001, since both apps may run at once on
// the same machine). We proxy everything under /api to Express so the
// frontend can just call relative URLs — the same code works in production
// when server/index.js serves the built dist/ itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:3101", changeOrigin: true },
      "/auth": { target: "http://localhost:3101", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
