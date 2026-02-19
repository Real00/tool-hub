<script setup lang="ts">
import AppsManagementPanel from "../components/settings/AppsManagementPanel.vue";
import RuntimePanel from "../components/settings/RuntimePanel.vue";
import TabDefinitionsPanel from "../components/settings/TabDefinitionsPanel.vue";
</script>

<template>
  <div class="space-y-6">
    <RuntimePanel />
    <TabDefinitionsPanel />
    <AppsManagementPanel />
  </div>
</template>
