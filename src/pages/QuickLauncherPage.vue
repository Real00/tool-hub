<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import QuickLauncherModal from "../components/QuickLauncherModal.vue";
import { useToolHubState } from "../composables/use-tool-hub-state";
import {
  closeQuickLauncherWindow,
  type QuickLauncherWindowSizePayload,
  setQuickLauncherWindowSize,
} from "../platform/electron-bridge";

const { apps, dispose, init } = useToolHubState();

function handleClose() {
  void closeQuickLauncherWindow();
}

function handleSizeMode(payload: QuickLauncherWindowSizePayload) {
  void setQuickLauncherWindowSize(payload);
}

onMounted(() => {
  init();
  void setQuickLauncherWindowSize({ mode: "compact" });
});

onUnmounted(() => {
  dispose();
});
</script>

<template>
  <QuickLauncherModal
    :open="true"
    :installed-apps="apps"
    :embedded="true"
    @close="handleClose"
    @size-mode="handleSizeMode"
  />
</template>
