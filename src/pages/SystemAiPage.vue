<script setup lang="ts">
import AiChatPanel from "../components/system/AiChatPanel.vue";

function handleCloseWindow() {
  window.close();
}
</script>

<template>
  <main class="h-screen overflow-hidden bg-slate-950 px-4 py-3 text-slate-100 sm:px-5 sm:py-4">
    <div class="mx-auto flex h-full w-full max-w-7xl min-h-0 flex-col">
      <div class="shrink-0 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-base font-semibold text-slate-100 sm:text-lg">
            AI
            <span class="ml-2 text-xs font-normal text-slate-400 sm:text-sm">
              独立窗口 AI 对话面板，支持 OpenAI 兼容接口与流式多轮对话
            </span>
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
          @click="handleCloseWindow"
        >
          Close Window
        </button>
      </div>

      <AiChatPanel class="mt-3 min-h-0 flex-1 sm:mt-4" />
    </div>
  </main>
</template>
