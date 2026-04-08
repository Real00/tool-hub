<script setup lang="ts">
import SystemRecorderPanel from "../components/system/SystemRecorderPanel.vue";

function handleCloseWindow() {
  window.close();
}
</script>

<template>
  <main class="min-h-screen bg-slate-950 px-5 py-6 text-slate-100">
    <div class="mx-auto w-full max-w-6xl">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-cyan-300/90">System App</p>
          <p class="mt-2 text-2xl font-semibold text-slate-100">系统录像器</p>
          <p class="mt-2 text-sm text-slate-400">
            独立窗口运行的系统应用，支持屏幕录像和应用窗口录像。
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
          @click="handleCloseWindow"
        >
          Close Window
        </button>
      </div>

      <SystemRecorderPanel />
    </div>
  </main>
</template>
