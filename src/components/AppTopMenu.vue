<script setup lang="ts">
import type { TabDefinition } from "../types/settings";

defineProps<{
  tabs: TabDefinition[];
  activeTab: string;
  isSettingsActive: boolean;
}>();

const emit = defineEmits<{
  select: [tabId: string];
  settings: [];
}>();
</script>

<template>
  <header
    class="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur"
  >
    <div class="mx-auto w-full max-w-7xl px-4 py-3 md:px-6">
      <div class="flex items-center gap-3">
        <div
          class="flex min-w-fit items-center gap-2 pr-2"
        >
          <div
            class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-cyan-400 text-sm font-bold text-slate-900"
          >
            TH
          </div>
          <div class="leading-tight">
            <p class="text-sm font-semibold text-slate-100">Tool Hub</p>
            <p class="text-xs text-slate-400">Electron + Vue 3</p>
          </div>
        </div>

        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border px-3 py-1.5 text-sm transition"
            :class="
              isSettingsActive
                ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
            "
            @click="emit('settings')"
          >
            Settings
          </button>
        </div>
      </div>

      <nav class="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm transition"
          :class="
            activeTab === tab.id
              ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/40'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          "
          @click="emit('select', tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>
  </header>
</template>
