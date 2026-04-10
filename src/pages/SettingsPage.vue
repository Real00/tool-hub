<script setup lang="ts">
import AppsManagementPanel from "../components/settings/AppsManagementPanel.vue";
import RuntimePanel from "../components/settings/RuntimePanel.vue";
import SystemAppsPanel from "../components/settings/SystemAppsPanel.vue";
import TabDefinitionsPanel from "../components/settings/TabDefinitionsPanel.vue";
</script>

<template>
  <div class="space-y-6">
    <RuntimePanel />
    <SystemAppsPanel />
    <TabDefinitionsPanel />
    <AppsManagementPanel />
  </div>
</template>
