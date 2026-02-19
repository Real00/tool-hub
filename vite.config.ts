import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const devHost = "127.0.0.1";

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    include: ["vue"],
  },
  resolve: {
    extensions: [".mjs", ".mts", ".ts", ".jsx", ".tsx", ".js", ".json", ".vue"],
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: devHost,
    warmup: {
      clientFiles: [
        "./index.html",
        "./src/main.ts",
        "./src/app/App.vue",
        "./src/components/*.vue",
        "./src/styles/global.css",
      ],
    },
  },
  envPrefix: ["VITE_"],
  build: {
    target: "chrome120",
    minify: "esbuild",
    sourcemap: false,
  },
});
