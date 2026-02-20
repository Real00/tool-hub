import { createRouter, createWebHashHistory } from "vue-router";
import GeneratorPage from "../pages/GeneratorPage.vue";
import QuickLauncherPage from "../pages/QuickLauncherPage.vue";
import SettingsPage from "../pages/SettingsPage.vue";
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
      path: "/quick-launcher",
      name: "quick-launcher",
      component: QuickLauncherPage,
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/workspace",
    },
  ],
});

export default router;
