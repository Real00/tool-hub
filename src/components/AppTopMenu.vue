<script setup lang="ts">
import type { TabDefinition } from "../types/settings";

defineProps<{
  tabs: TabDefinition[];
  activeTab: string;
  isSettingsActive: boolean;
  isGeneratorActive: boolean;
}>();

const emit = defineEmits<{
  select: [tabId: string];
  generator: [];
  settings: [];
}>();
</script>

<template>
  <header
    class="sticky top-0 z-30 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur-xl"
  >
    <div class="mx-auto w-full max-w-7xl px-4 pb-2 pt-3 md:px-6">
      <div class="flex items-center gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-300 to-sky-500 text-xs font-bold text-slate-950"
          >
            TH
          </div>
          <div class="min-w-0 leading-tight">
            <p class="text-sm font-semibold text-slate-100">Tool Hub</p>
            <p class="hidden text-xs text-slate-400 sm:block">Workspace</p>
          </div>
        </div>

        <div class="ml-auto inline-flex items-center gap-1 rounded-xl bg-slate-900/70 p-1 ring-1 ring-slate-700/80">
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              isGeneratorActive
                ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
            "
            @click="emit('generator')"
          >
            Generator
          </button>
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              isSettingsActive
                ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
            "
            @click="emit('settings')"
          >
            Settings
          </button>
        </div>
      </div>

      <nav class="mt-3 overflow-x-auto pb-1">
        <div class="inline-flex items-center gap-1.5 rounded-xl bg-slate-900/50 p-1 ring-1 ring-slate-800/70">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              activeTab === tab.id
                ? 'bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
            "
            @click="emit('select', tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>
      </nav>
    </div>
  </header>
</template>
