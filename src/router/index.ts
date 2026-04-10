import { createRouter, createWebHashHistory } from "vue-router";
import GeneratorPage from "../pages/GeneratorPage.vue";
import DeveloperToolsPage from "../pages/DeveloperToolsPage.vue";
import QuickLauncherPage from "../pages/QuickLauncherPage.vue";
import RuntimePage from "../pages/RuntimePage.vue";
import SettingsPage from "../pages/SettingsPage.vue";
import SystemAiPage from "../pages/SystemAiPage.vue";
import SystemRecorderPage from "../pages/SystemRecorderPage.vue";
import WorkspacePage from "../pages/WorkspacePage.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      name: "workspace",
      component: WorkspacePage,
    },
    {
      path: "/settings",
      name: "settings",
      component: SettingsPage,
    },
    {
      path: "/generator",
      name: "generator",
      component: GeneratorPage,
    },
    {
      path: "/runtime",
      name: "runtime",
      component: RuntimePage,
    },
    {
      path: "/quick-launcher",
      name: "quick-launcher",
      component: QuickLauncherPage,
    },
    {
      path: "/developer-tools",
      name: "developer-tools",
      component: DeveloperToolsPage,
    },
    {
      path: "/system-recorder",
      name: "system-recorder",
      component: SystemRecorderPage,
    },
    {
      path: "/system-ai",
      name: "system-ai",
      component: SystemAiPage,
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/workspace",
    },
  ],
});

export default router;
