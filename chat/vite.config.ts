import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 5179, proxy: { "/api": "http://127.0.0.1:5178", "/scenes": "http://127.0.0.1:5178", "/out": "http://127.0.0.1:5178", "/uploads": "http://127.0.0.1:5178" } },
});
