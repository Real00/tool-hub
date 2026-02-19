import { createApp } from "vue";
import App from "./app/App.vue";
import "./styles/global.css";

function showBootError(error: unknown) {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }

  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  root.innerHTML = `<pre style="margin:12px;padding:12px;background:#0f172a;color:#fca5a5;border:1px solid #ef4444;border-radius:8px;white-space:pre-wrap;font:12px/1.4 Consolas,Monaco,monospace;">[Boot Error]\n\n${message}</pre>`;
}

try {
  createApp(App).mount("#app");
} catch (error) {
  showBootError(error);
  throw error;
}
