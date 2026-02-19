<script setup lang="ts">
import AppsManagementPanel from "../components/settings/AppsManagementPanel.vue";
import GeneratorPanel from "../components/settings/GeneratorPanel.vue";
import TabDefinitionsPanel from "../components/settings/TabDefinitionsPanel.vue";
</script>

<template>
  <div class="space-y-6">
    <TabDefinitionsPanel />
    <AppsManagementPanel />
    <GeneratorPanel />
  </div>
</template>
