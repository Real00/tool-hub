<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import QuickLauncherModal from "../components/QuickLauncherModal.vue";
import {
  closeQuickLauncherWindow,
  isElectronRuntime,
  listApps,
  subscribeQuickLauncherRequest,
  type QuickLauncherWindowSizePayload,
  setQuickLauncherWindowSize,
} from "../platform/electron-bridge";
import type { InstalledApp } from "../types/app";

const apps = ref<InstalledApp[]>([]);
const launcherOpen = ref(true);

let disposed = false;
let appsPollingTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeQuickLauncherRequest: (() => void) | null = null;

async function loadInstalledApps() {
  if (!isElectronRuntime() || disposed) {
    return;
  }
  try {
    apps.value = await listApps();
  } catch {
    // Keep the launcher responsive even if app list refresh fails.
  }
}

function startAppsPolling() {
  if (appsPollingTimer) {
    clearInterval(appsPollingTimer);
  }
  appsPollingTimer = setInterval(() => {
    void loadInstalledApps();
  }, 4000);
}

async function reopenLauncher() {
  launcherOpen.value = false;
  await nextTick();
  if (disposed) {
    return;
  }
  launcherOpen.value = true;
  void setQuickLauncherWindowSize({ mode: "compact" });
}

function handleClose() {
  launcherOpen.value = false;
  void closeQuickLauncherWindow();
}

function handleSizeMode(payload: QuickLauncherWindowSizePayload) {
  void setQuickLauncherWindowSize(payload);
}

onMounted(() => {
  disposed = false;
  launcherOpen.value = true;
  void setQuickLauncherWindowSize({ mode: "compact" });
  if (!isElectronRuntime()) {
    return;
  }

  void loadInstalledApps();
  startAppsPolling();
  unsubscribeQuickLauncherRequest = subscribeQuickLauncherRequest(() => {
    void loadInstalledApps();
    void reopenLauncher();
  });
});

onBeforeUnmount(() => {
  disposed = true;
  unsubscribeQuickLauncherRequest?.();
  unsubscribeQuickLauncherRequest = null;
  if (appsPollingTimer) {
    clearInterval(appsPollingTimer);
    appsPollingTimer = null;
  }
});
</script>

<template>
  <QuickLauncherModal
    :open="launcherOpen"
    :installed-apps="apps"
    :embedded="true"
    @close="handleClose"
    @size-mode="handleSizeMode"
  />
</template>
