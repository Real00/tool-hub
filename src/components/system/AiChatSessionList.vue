<script setup lang="ts">
import type { AiChatSessionSummary } from "../../types/ai-chat";

defineProps<{
  sessions: AiChatSessionSummary[];
  activeSessionId: string;
  sessionsLoading: boolean;
  canUseAiChat: boolean;
  sending: boolean;
  formatTime: (value: number) => string;
  collapsible?: boolean;
}>();

const emit = defineEmits<{
  create: [];
  delete: [sessionId: string];
  select: [sessionId: string];
  collapse: [];
}>();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-slate-100">
          历史对话
          <span class="ml-2 text-xs font-normal text-slate-500">{{ sessions.length }}</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="collapsible"
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/80 text-slate-300 transition hover:border-emerald-400 hover:text-emerald-200"
          title="收起历史对话"
          @click="emit('collapse')"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4">
            <path d="M12.5 4.5L7 10L12.5 15.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          class="rounded-lg border border-emerald-500/50 px-3 py-2 text-xs text-emerald-200 transition hover:border-emerald-400 hover:text-emerald-100 disabled:opacity-50"
          :disabled="!canUseAiChat || sending"
          @click="emit('create')"
        >
          New
        </button>
      </div>
    </div>

    <div class="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="w-full rounded-xl border px-3 py-3 text-left transition"
        :class="
          activeSessionId === session.id
            ? 'border-emerald-500/50 bg-emerald-500/10 text-slate-100'
            : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:text-slate-100'
        "
      >
        <div class="flex items-start justify-between gap-3">
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            @click="emit('select', session.id)"
          >
            <p class="truncate text-sm font-medium">{{ session.title }}</p>
            <p class="mt-1 truncate text-xs text-slate-500">
              {{ formatTime(session.updatedAt) }}
            </p>
          </button>
          <button
            type="button"
            class="shrink-0 rounded border border-transparent px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:border-rose-500/40 hover:text-rose-200"
            @click.stop="emit('delete', session.id)"
          >
            Delete
          </button>
        </div>
      </div>

      <div
        v-if="sessions.length === 0 && !sessionsLoading"
        class="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-4 py-6 text-sm text-slate-500"
      >
        还没有历史会话。
      </div>
    </div>
  </div>
</template>
