<script setup lang="ts">
import { computed } from "vue";
import GeneratorPanel from "../components/settings/GeneratorPanel.vue";
import { useToolHubState } from "../composables/use-tool-hub-state";

const {
  generatorProjectId,
  generatorStatus,
  updateGeneratorProjectAgentsRules,
} = useToolHubState();

const canUpdateAgentsRules = computed(() => {
  return Boolean(generatorProjectId.value) && generatorStatus.value !== "loading";
});
</script>

<template>
  <div class="mx-auto w-full max-w-[1800px]">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
      <p class="text-xs text-slate-300">
        同步模板中的最新 <code>AGENTS.md</code> 到当前开发项目。
      </p>
      <button
        type="button"
        class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canUpdateAgentsRules"
        @click="updateGeneratorProjectAgentsRules"
      >
        更新 AGENTS.md
      </button>
    </div>
    <GeneratorPanel />
  </div>
</template>
