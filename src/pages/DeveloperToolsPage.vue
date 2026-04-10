<script setup lang="ts">
import DeveloperToolsPanel from "../components/system/DeveloperToolsPanel.vue";

function handleCloseWindow() {
  window.close();
}
</script>

<template>
  <main class="min-h-screen overflow-y-auto bg-slate-950 px-4 py-3 text-slate-100 sm:px-5 sm:py-4 xl:h-screen xl:overflow-hidden">
    <div class="mx-auto flex w-full max-w-7xl min-h-0 flex-col xl:h-full">
      <div class="shrink-0 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-base font-semibold text-slate-100 sm:text-lg">
            开发者工具
            <span class="ml-2 text-xs font-normal text-slate-400 sm:text-sm">
              URL / Unicode / Base64 / 时间戳转换
            </span>
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
          @click="handleCloseWindow"
        >
          Close Window
        </button>
      </div>

      <DeveloperToolsPanel class="mt-3 min-h-0 flex-1 sm:mt-4 xl:overflow-hidden" />
    </div>
  </main>
</template>
