// AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        timeout: 300_000,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
