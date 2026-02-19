import { createRouter, createWebHashHistory } from "vue-router";
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
      path: "/:pathMatch(.*)*",
      redirect: "/workspace",
    },
  ],
});

export default router;
