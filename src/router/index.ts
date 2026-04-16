import { createRouter, createWebHashHistory } from "vue-router";

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
      component: () => import("../pages/WorkspacePage.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../pages/SettingsPage.vue"),
    },
    {
      path: "/generator",
      name: "generator",
      component: () => import("../pages/GeneratorPage.vue"),
    },
    {
      path: "/runtime",
      name: "runtime",
      component: () => import("../pages/RuntimePage.vue"),
    },
    {
      path: "/quick-launcher",
      name: "quick-launcher",
      component: () => import("../pages/QuickLauncherPage.vue"),
    },
    {
      path: "/developer-tools",
      name: "developer-tools",
      component: () => import("../pages/DeveloperToolsPage.vue"),
    },
    {
      path: "/system-recorder",
      name: "system-recorder",
      component: () => import("../pages/SystemRecorderPage.vue"),
    },
    {
      path: "/system-ai",
      name: "system-ai",
      component: () => import("../pages/SystemAiPage.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/workspace",
    },
  ],
});

export default router;
