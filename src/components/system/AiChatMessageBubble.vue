<script setup lang="ts">
import { computed } from "vue";
import type { AiChatImageAttachment, AiChatMessage } from "../../types/ai-chat";
import { renderAiMessageMarkdown } from "./ai-message-markdown";

const props = defineProps<{
  message: AiChatMessage;
  formattedTime: string;
}>();

const isUser = computed(() => props.message.role === "user");
const attachments = computed<AiChatImageAttachment[]>(() =>
  Array.isArray(props.message.attachments) ? props.message.attachments : [],
);
const markdownHtml = computed(() => {
  if (isUser.value) {
    return "";
  }
  const content = String(props.message.content ?? "");
  if (!content) {
    return `<p class="text-sm leading-7 text-slate-400">...</p>`;
  }
  return renderAiMessageMarkdown(content);
});

async function handleMarkdownClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const button = target?.closest?.("[data-copy-target]") as HTMLElement | null;
  if (!button) {
    return;
  }
  const codeId = String(button.getAttribute("data-copy-target") ?? "").trim();
  if (!codeId) {
    return;
  }
  const codeElement = document.getElementById(codeId);
  const text = String(codeElement?.textContent ?? "");
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    button.classList.add("border-emerald-400", "text-emerald-200");
    window.setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("border-emerald-400", "text-emerald-200");
    }, 1600);
  } catch {
    button.textContent = "Error";
    button.classList.add("border-rose-400", "text-rose-200");
    window.setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("border-rose-400", "text-rose-200");
    }, 1600);
  }
}
</script>

<template>
  <article
    class="flex"
    :class="isUser ? 'justify-end' : 'justify-start'"
  >
    <div
      class="max-w-[85%] rounded-2xl border px-4 py-3"
      :class="
        isUser
          ? 'border-emerald-500/35 bg-emerald-500/10 text-slate-200'
          : 'border-slate-700 bg-slate-950/75 text-slate-300'
      "
    >
      <div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
        <span>{{ message.role }}</span>
        <span>{{ formattedTime }}</span>
        <span v-if="message.status === 'streaming'" class="text-emerald-300">streaming</span>
        <span v-if="message.status === 'error'" class="text-rose-300">error</span>
      </div>

      <p
        v-if="isUser"
        class="mt-2 whitespace-pre-wrap break-words text-sm leading-[1.45rem] text-slate-200"
      >
        {{ message.content || "..." }}
      </p>
      <div
        v-if="attachments.length > 0"
        class="mt-3 flex flex-wrap gap-2"
      >
        <img
          v-for="attachment in attachments"
          :key="attachment.id"
          :src="attachment.dataUrl"
          alt=""
          class="max-h-48 rounded-xl border border-slate-700 bg-slate-950/70 object-contain"
        />
      </div>
      <div
        v-if="!isUser"
        class="ai-chat-markdown mt-3 overflow-hidden [&_.hljs-comment]:text-slate-500 [&_.hljs-keyword]:text-cyan-300 [&_.hljs-literal]:text-orange-300 [&_.hljs-number]:text-orange-300 [&_.hljs-string]:text-emerald-300 [&_.hljs-title]:text-sky-300 [&_.hljs-type]:text-violet-300 [&_table]:w-full"
        v-html="markdownHtml"
        @click="handleMarkdownClick"
      />

      <p
        v-if="message.errorMessage"
        class="mt-2 text-xs text-rose-300"
      >
        {{ message.errorMessage }}
      </p>
    </div>
  </article>
</template>
