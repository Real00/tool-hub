<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import JsonTreeNode from "./JsonTreeNode.vue";
import {
  analyzeDeveloperToolsText,
  getDeveloperToolsLaunchState,
  isElectronRuntime,
  runDeveloperToolsTransform,
  subscribeDeveloperToolsLaunch,
} from "../../platform/electron-bridge";
import type {
  DeveloperToolsAnalyzeResult,
  DeveloperToolsLaunchPayload,
  DeveloperToolsLaunchState,
  DeveloperToolsTransformId,
} from "../../types/developer-tools";

interface TransformOption {
  id: DeveloperToolsTransformId;
  label: string;
  hint: string;
}

interface CurrentTimeEntry {
  key: string;
  label: string;
  value: string;
}

type JsonOutputMode = "pretty" | "minify" | "escape";

const TRANSFORM_OPTIONS: TransformOption[] = [
  { id: "json-format", label: "JSON Format", hint: "Format, minify, escape, and transform JSON" },
  { id: "md5-hash", label: "MD5 Hash", hint: "Generate 32-character MD5 digest" },
  { id: "random-generate", label: "Random Generate", hint: "Generate random characters" },
  { id: "url-decode", label: "URL Decode", hint: "Decode %XX and + text" },
  { id: "url-encode", label: "URL Encode", hint: "Encode plain text for URLs" },
  { id: "unicode-decode", label: "Unicode Decode", hint: "Decode \\uXXXX / \\xNN text" },
  { id: "unicode-encode", label: "Unicode Encode", hint: "Escape text as JS unicode sequences" },
  { id: "base64-decode", label: "Base64 Decode", hint: "Decode UTF-8 Base64 text" },
  { id: "base64-encode", label: "Base64 Encode", hint: "Encode plain text as Base64" },
  { id: "timestamp-convert", label: "Timestamp Convert", hint: "Convert seconds, milliseconds, or date text" },
];

const EMPTY_ANALYSIS: DeveloperToolsAnalyzeResult = {
  rawText: "",
  detectedTransforms: [],
  suggestedTransform: null,
};

const canUseDeveloperTools = isElectronRuntime();
const inputText = ref("");
const outputText = ref("");
const analysis = ref<DeveloperToolsAnalyzeResult>(EMPTY_ANALYSIS);
const activeTransformId = ref<DeveloperToolsTransformId>("url-decode");
const panelStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const panelMessage = ref("粘贴或输入文本，右侧会自动显示转换结果。");
const copied = ref(false);
const currentTimestampSummary = ref("");
const copiedCurrentTimeKey = ref("");
const copiedOutputEntryKey = ref("");
const lastHandledLaunchUpdatedAt = ref(0);
const randomLength = ref(16);
const randomIncludeUppercase = ref(true);
const randomIncludeLowercase = ref(true);
const randomIncludeDigits = ref(true);
const randomIncludeSymbols = ref(false);
const jsonOutputMode = ref<JsonOutputMode>("pretty");
const jsonFilterExpression = ref("");
const jsonTreeValue = ref<unknown>(null);
const jsonTreeForceCollapsed = ref(false);

let disposed = false;
let analyzeTimer: ReturnType<typeof setTimeout> | null = null;
let analyzeToken = 0;
let transformToken = 0;
let unsubscribeLaunch: (() => void) | null = null;
let currentTimeTimer: ReturnType<typeof setInterval> | null = null;

const activeTransform = computed(() => {
  return TRANSFORM_OPTIONS.find((item) => item.id === activeTransformId.value) ?? TRANSFORM_OPTIONS[0];
});
const isJsonTransform = computed(() => activeTransformId.value === "json-format");

const currentTimeEntries = computed<CurrentTimeEntry[]>(() => {
  return parseSummaryEntries(currentTimestampSummary.value, "current");
});

const timestampOutputEntries = computed<CurrentTimeEntry[]>(() => {
  if (activeTransformId.value !== "timestamp-convert") {
    return [];
  }
  return parseSummaryEntries(outputText.value, "output");
});

function parseSummaryEntries(text: string, scope: string): CurrentTimeEntry[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "[Current]" && line !== "[Input]" && line !== "Time zones:");

  return lines
    .map((line, index) => {
      const normalizedLine = line.startsWith("- ") ? line.slice(2) : line;
      const separatorIndex = normalizedLine.indexOf(": ");
      if (separatorIndex <= 0) {
        return null;
      }
      return {
        key: `${scope}:${index}:${normalizedLine.slice(0, separatorIndex)}`,
        label: normalizedLine.slice(0, separatorIndex),
        value: normalizedLine.slice(separatorIndex + 2),
      };
    })
    .filter((item): item is CurrentTimeEntry => !!item);
}

function clearPendingTimers() {
  if (analyzeTimer) {
    clearTimeout(analyzeTimer);
    analyzeTimer = null;
  }
}

function normalizeLaunchPayload(
  payloadText: string | null | undefined,
  sourceInput: "manual" | "quick-launcher" = "manual",
): DeveloperToolsLaunchPayload | null {
  const rawText = String(payloadText ?? "");
  if (!rawText) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      source: parsed.source === "quick-launcher" ? "quick-launcher" : sourceInput,
      inputText: String(parsed.inputText ?? ""),
      suggestedTransform: typeof parsed.suggestedTransform === "string"
        ? parsed.suggestedTransform as DeveloperToolsTransformId
        : null,
    };
  } catch {
    return {
      source: sourceInput,
      inputText: rawText,
      suggestedTransform: null,
    };
  }
}

function getRandomCharset(): string {
  let charset = "";
  if (randomIncludeUppercase.value) {
    charset += "ABCDEFGHJKLMNPQRSTUVWXYZ";
  }
  if (randomIncludeLowercase.value) {
    charset += "abcdefghijkmnopqrstuvwxyz";
  }
  if (randomIncludeDigits.value) {
    charset += "23456789";
  }
  if (randomIncludeSymbols.value) {
    charset += "!@#$%^&*()-_=+[]{};:,.?";
  }
  return charset;
}

function clampRandomLength(input: number): number {
  if (!Number.isFinite(input)) {
    return 16;
  }
  return Math.max(4, Math.min(128, Math.floor(input)));
}

function generateRandomText(): string {
  const charset = getRandomCharset();
  if (!charset) {
    throw new Error("至少选择一种随机字符集。");
  }
  const length = clampRandomLength(randomLength.value);
  randomLength.value = length;
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  let output = "";
  for (let i = 0; i < randomValues.length; i += 1) {
    output += charset[randomValues[i] % charset.length];
  }
  return output;
}

function parseJsonInput(): unknown {
  const rawText = inputText.value.trim();
  if (!rawText) {
    throw new Error("请输入 JSON 内容。");
  }
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败。",
    );
  }
}

function applyJsonFilterExpression(input: unknown): unknown {
  const expression = jsonFilterExpression.value.trim();
  if (!expression) {
    return input;
  }
  if (!expression.startsWith(".")) {
    throw new Error("JSON 表达式需要以 . 开头，例如 .length 或 .filter(x => x.ok)。");
  }
  try {
    const evaluator = new Function(
      "value",
      `"use strict"; return value${expression};`,
    );
    return evaluator(input);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `JSON 表达式执行失败：${error.message}` : "JSON 表达式执行失败。",
    );
  }
}

function serializeJsonOutput(input: unknown): string {
  if (jsonOutputMode.value === "minify") {
    return JSON.stringify(input);
  }
  if (jsonOutputMode.value === "escape") {
    return JSON.stringify(JSON.stringify(input, null, 2));
  }
  return JSON.stringify(input, null, 2);
}

function runJsonTransform() {
  const parsed = parseJsonInput();
  const transformed = applyJsonFilterExpression(parsed);
  jsonTreeValue.value = transformed;
  jsonTreeForceCollapsed.value = false;
  outputText.value = serializeJsonOutput(transformed);
  panelStatus.value = "success";
  panelMessage.value = "JSON 处理完成。";
}

async function runCurrentTransform() {
  if (!canUseDeveloperTools) {
    return;
  }
  if (activeTransformId.value === "json-format") {
    if (!inputText.value.trim()) {
      outputText.value = "";
      jsonTreeValue.value = null;
      panelStatus.value = "idle";
      panelMessage.value = "输入 JSON 内容后，右侧会默认显示格式化结果。";
      return;
    }
    try {
      runJsonTransform();
    } catch (error) {
      outputText.value = "";
      jsonTreeValue.value = null;
      panelStatus.value = "error";
      panelMessage.value = error instanceof Error ? error.message : String(error);
    }
    return;
  }
  if (activeTransformId.value === "random-generate") {
    try {
      outputText.value = generateRandomText();
      panelStatus.value = "success";
      panelMessage.value = "已生成随机字符串。";
    } catch (error) {
      outputText.value = "";
      panelStatus.value = "error";
      panelMessage.value = error instanceof Error ? error.message : String(error);
    }
    return;
  }
  const nextInput = inputText.value;
  if (!nextInput.trim()) {
    outputText.value = "";
    panelStatus.value = "idle";
    panelMessage.value = activeTransformId.value === "timestamp-convert"
      ? "输入时间戳或日期文本后，右侧会显示结构化时间列表。"
      : "粘贴或输入文本，右侧会自动显示转换结果。";
    return;
  }

  const token = ++transformToken;
  panelStatus.value = "loading";
  try {
    const result = await runDeveloperToolsTransform(nextInput, activeTransformId.value);
    if (disposed || token !== transformToken) {
      return;
    }
    outputText.value = result.outputText;
    panelStatus.value = "success";
    panelMessage.value = `${activeTransform.value.label} 已完成。`;
  } catch (error) {
    if (disposed || token !== transformToken) {
      return;
    }
    outputText.value = "";
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function refreshCurrentTimestampSummary() {
  if (!canUseDeveloperTools || disposed) {
    return;
  }
  try {
    const result = await runDeveloperToolsTransform("", "timestamp-convert");
    if (disposed) {
      return;
    }
    currentTimestampSummary.value = result.outputText;
  } catch {
    // Keep the panel usable even if the current summary refresh fails.
  }
}

function scheduleAnalyze() {
  clearPendingTimers();
  const nextInput = inputText.value;
  const token = ++analyzeToken;
  if (!nextInput.trim()) {
    analysis.value = EMPTY_ANALYSIS;
    void runCurrentTransform();
    return;
  }

  analyzeTimer = setTimeout(async () => {
    try {
      const nextAnalysis = await analyzeDeveloperToolsText(nextInput);
      if (disposed || token !== analyzeToken) {
        return;
      }
      analysis.value = nextAnalysis;
      if (
        nextAnalysis.suggestedTransform &&
        !nextAnalysis.detectedTransforms.includes(activeTransformId.value)
      ) {
        activeTransformId.value = nextAnalysis.suggestedTransform;
        return;
      }
      void runCurrentTransform();
    } catch (error) {
      if (disposed || token !== analyzeToken) {
        return;
      }
      panelStatus.value = "error";
      panelMessage.value = error instanceof Error ? error.message : String(error);
    }
  }, 100);
}

async function handleCopyOutput() {
  if (!outputText.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(outputText.value);
    copied.value = true;
    panelStatus.value = "success";
    panelMessage.value = "结果已复制到剪切板。";
    setTimeout(() => {
      copied.value = false;
    }, 1200);
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function handleCopyCurrentTimeEntry(entry: CurrentTimeEntry) {
  try {
    await navigator.clipboard.writeText(entry.value);
    copiedCurrentTimeKey.value = entry.key;
    panelStatus.value = "success";
    panelMessage.value = `${entry.label} 已复制到剪切板。`;
    setTimeout(() => {
      if (copiedCurrentTimeKey.value === entry.key) {
        copiedCurrentTimeKey.value = "";
      }
    }, 1200);
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function handleCopyOutputEntry(entry: CurrentTimeEntry) {
  try {
    await navigator.clipboard.writeText(entry.value);
    copiedOutputEntryKey.value = entry.key;
    panelStatus.value = "success";
    panelMessage.value = `${entry.label} 已复制到剪切板。`;
    setTimeout(() => {
      if (copiedOutputEntryKey.value === entry.key) {
        copiedOutputEntryKey.value = "";
      }
    }, 1200);
  } catch (error) {
    panelStatus.value = "error";
    panelMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function handleSwap() {
  if (!outputText.value) {
    return;
  }
  inputText.value = outputText.value;
}

function handleClear() {
  inputText.value = "";
  outputText.value = "";
  jsonTreeValue.value = null;
  analysis.value = EMPTY_ANALYSIS;
  panelStatus.value = "idle";
  panelMessage.value = "输入已清空。";
}

function handleSelectTransform(transformId: DeveloperToolsTransformId) {
  activeTransformId.value = transformId;
}

function handleGenerateRandom() {
  void runCurrentTransform();
}

function handleExpandJsonTree() {
  jsonTreeForceCollapsed.value = false;
}

function handleCollapseJsonTree() {
  jsonTreeForceCollapsed.value = true;
}

async function applyLaunchState(state: DeveloperToolsLaunchState | null | undefined) {
  const updatedAt = Number(state?.updatedAt ?? 0);
  if (!updatedAt || updatedAt <= lastHandledLaunchUpdatedAt.value) {
    return;
  }
  const payload = normalizeLaunchPayload(state?.payload, state?.source);
  if (!payload) {
    return;
  }
  lastHandledLaunchUpdatedAt.value = updatedAt;
  if (payload.suggestedTransform) {
    activeTransformId.value = payload.suggestedTransform;
  }
  if (typeof payload.inputText === "string") {
    inputText.value = payload.inputText;
  }
  panelStatus.value = "success";
  panelMessage.value = payload.source === "quick-launcher"
    ? (payload.inputText
      ? "已载入 quick launcher 内容。"
      : "已切换到 quick launcher 指定的工具模式。")
    : "已载入外部输入内容。";
}

watch(
  () => inputText.value,
  () => {
    scheduleAnalyze();
  },
);

watch(
  () => activeTransformId.value,
  () => {
    void runCurrentTransform();
  },
);

watch(
  () => [
    randomLength.value,
    randomIncludeUppercase.value,
    randomIncludeLowercase.value,
    randomIncludeDigits.value,
    randomIncludeSymbols.value,
  ],
  () => {
    if (activeTransformId.value === "random-generate") {
      void runCurrentTransform();
    }
  },
);

watch(
  () => [jsonOutputMode.value, jsonFilterExpression.value],
  () => {
    if (activeTransformId.value === "json-format") {
      void runCurrentTransform();
    }
  },
);

onMounted(async () => {
  disposed = false;
  if (!canUseDeveloperTools) {
    panelStatus.value = "error";
    panelMessage.value = "Developer tools are only available in Electron runtime.";
    return;
  }
  unsubscribeLaunch = subscribeDeveloperToolsLaunch((state) => {
    void applyLaunchState(state);
  });
  await refreshCurrentTimestampSummary();
  currentTimeTimer = setInterval(() => {
    void refreshCurrentTimestampSummary();
  }, 1000);
  try {
    const launchState = await getDeveloperToolsLaunchState();
    await applyLaunchState(launchState);
  } catch {
    // Keep the page usable even if the initial launch-state fetch fails.
  }
});

onBeforeUnmount(() => {
  disposed = true;
  clearPendingTimers();
  unsubscribeLaunch?.();
  unsubscribeLaunch = null;
  if (currentTimeTimer) {
    clearInterval(currentTimeTimer);
    currentTimeTimer = null;
  }
});
</script>

<template>
  <section class="grid min-h-0 gap-4 xl:h-full xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
    <aside class="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 xl:min-h-0 xl:overflow-y-auto">
      <p class="text-xs uppercase tracking-[0.2em] text-cyan-300/90">Developer Tools</p>
      <p class="mt-2 text-xl font-semibold text-slate-100">编码与时间转换</p>
      <p class="mt-2 text-sm text-slate-400">
        支持 URL、Unicode、Base64 和时间戳转换。quick launcher 命中时会自动带入剪切板内容。
      </p>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="item in TRANSFORM_OPTIONS"
          :key="item.id"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs transition"
          :class="
            activeTransformId === item.id
              ? 'border-cyan-400 bg-cyan-500/10 text-cyan-100'
              : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500'
          "
          @click="handleSelectTransform(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
        <p
          class="text-xs"
          :class="
            panelStatus === 'error'
              ? 'text-rose-300'
              : panelStatus === 'loading'
                ? 'text-amber-300'
                : panelStatus === 'success'
                  ? 'text-emerald-300'
                  : 'text-slate-400'
          "
        >
          {{ panelMessage }}
        </p>
      </div>

      <div
        v-if="isJsonTransform"
        class="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3"
      >
        <p class="text-xs uppercase tracking-[0.16em] text-slate-500">JSON Input</p>

        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs transition"
            :class="
              jsonOutputMode === 'pretty'
                ? 'border-cyan-400 bg-cyan-500/10 text-cyan-100'
                : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500'
            "
            @click="jsonOutputMode = 'pretty'"
          >
            Pretty
          </button>
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs transition"
            :class="
              jsonOutputMode === 'minify'
                ? 'border-cyan-400 bg-cyan-500/10 text-cyan-100'
                : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500'
            "
            @click="jsonOutputMode = 'minify'"
          >
            Minify
          </button>
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs transition"
            :class="
              jsonOutputMode === 'escape'
                ? 'border-cyan-400 bg-cyan-500/10 text-cyan-100'
                : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500'
            "
            @click="jsonOutputMode = 'escape'"
          >
            Escape
          </button>
        </div>

        <label class="mt-3 block">
          <span class="text-[11px] uppercase tracking-[0.14em] text-slate-500">Expression</span>
          <input
            v-model="jsonFilterExpression"
            type="text"
            class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500/40"
            placeholder=".length / .filter(x => x.ok) / .map(x => x.id)"
          />
        </label>

        <textarea
          v-model="inputText"
          class="mt-3 min-h-[180px] w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-500/40"
          placeholder='Paste JSON here, for example: {"items":[{"ok":true}]}'
        />
      </div>

      <div
        v-if="activeTransformId === 'timestamp-convert'"
        class="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3"
      >
        <p class="text-xs uppercase tracking-[0.16em] text-slate-500">Current Time</p>
        <div
          v-if="currentTimeEntries.length > 0"
          class="mt-2 space-y-1.5"
        >
          <div
            v-for="entry in currentTimeEntries"
            :key="entry.key"
            class="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5"
          >
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500">{{ entry.label }}</p>
              <p class="mt-0.5 break-all text-[11px] leading-4 text-slate-300">{{ entry.value }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-cyan-200 transition hover:border-cyan-400 hover:text-cyan-100"
              @click="handleCopyCurrentTimeEntry(entry)"
            >
              {{ copiedCurrentTimeKey === entry.key ? "Copied" : "Copy" }}
            </button>
          </div>
        </div>
        <p
          v-else
          class="mt-2 text-[11px] text-slate-500"
        >
          Current time summary unavailable.
        </p>
      </div>
    </aside>

    <section class="grid min-h-0 gap-4 xl:min-h-0 xl:overflow-hidden">
      <div
        class="grid min-h-0 gap-4 xl:flex-1"
        :class="isJsonTransform ? '' : 'lg:grid-cols-2'"
      >
        <div
          v-if="!isJsonTransform"
          class="flex min-h-0 flex-col rounded-2xl border border-slate-700 bg-slate-900/60 p-4"
        >
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-semibold text-slate-100">Input</p>
            <button
              type="button"
              class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              @click="handleClear"
            >
              Clear
            </button>
          </div>
          <div
            v-if="activeTransformId === 'random-generate'"
            class="mt-3 space-y-3"
          >
            <label class="block">
              <span class="text-[11px] uppercase tracking-[0.14em] text-slate-500">Length</span>
              <input
                v-model.number="randomLength"
                type="number"
                min="4"
                max="128"
                class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500/40"
              />
            </label>

            <div class="grid gap-2 sm:grid-cols-2">
              <label class="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                <input
                  v-model="randomIncludeUppercase"
                  type="checkbox"
                  class="h-4 w-4 accent-cyan-400"
                />
                <span>Uppercase</span>
              </label>
              <label class="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                <input
                  v-model="randomIncludeLowercase"
                  type="checkbox"
                  class="h-4 w-4 accent-cyan-400"
                />
                <span>Lowercase</span>
              </label>
              <label class="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                <input
                  v-model="randomIncludeDigits"
                  type="checkbox"
                  class="h-4 w-4 accent-cyan-400"
                />
                <span>Digits</span>
              </label>
              <label class="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                <input
                  v-model="randomIncludeSymbols"
                  type="checkbox"
                  class="h-4 w-4 accent-cyan-400"
                />
                <span>Symbols</span>
              </label>
            </div>

            <button
              type="button"
              class="rounded-lg border border-cyan-500/40 px-3 py-2 text-xs text-cyan-200 transition hover:border-cyan-300 hover:text-cyan-100"
              @click="handleGenerateRandom"
            >
              Generate Again
            </button>
          </div>
          <textarea
            v-else
            v-model="inputText"
            class="mt-3 min-h-[220px] flex-1 rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-500/40 sm:min-h-[280px] xl:min-h-0"
            placeholder="Paste or type text here..."
          />
        </div>

        <div class="flex min-h-0 flex-col rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm font-semibold text-slate-100">Output</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-if="isJsonTransform && jsonOutputMode !== 'escape' && jsonTreeValue !== null"
                type="button"
                class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                @click="handleExpandJsonTree"
              >
                Expand All
              </button>
              <button
                v-if="isJsonTransform && jsonOutputMode !== 'escape' && jsonTreeValue !== null"
                type="button"
                class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                @click="handleCollapseJsonTree"
              >
                Collapse All
              </button>
              <button
                v-if="activeTransformId !== 'timestamp-convert' && activeTransformId !== 'random-generate' && activeTransformId !== 'json-format'"
                type="button"
                class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                :disabled="!outputText"
                @click="handleSwap"
              >
                Swap
              </button>
              <button
                v-if="activeTransformId !== 'timestamp-convert'"
                type="button"
                class="rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-200 transition hover:border-cyan-300 hover:text-cyan-100 disabled:opacity-50"
                :disabled="!outputText"
                @click="handleCopyOutput"
              >
                {{ copied ? "Copied" : "Copy" }}
              </button>
            </div>
          </div>
          <div
            v-if="activeTransformId === 'timestamp-convert'"
            class="mt-3 flex-1 rounded-xl border border-slate-700 bg-slate-950/80 p-3"
          >
            <div
              v-if="timestampOutputEntries.length > 0"
              class="space-y-1.5"
            >
              <div
                v-for="entry in timestampOutputEntries"
                :key="entry.key"
                class="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5"
              >
                <div class="min-w-0">
                  <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500">{{ entry.label }}</p>
                  <p class="mt-0.5 break-all text-[11px] leading-4 text-slate-300">{{ entry.value }}</p>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-cyan-200 transition hover:border-cyan-400 hover:text-cyan-100"
                  @click="handleCopyOutputEntry(entry)"
                >
                  {{ copiedOutputEntryKey === entry.key ? "Copied" : "Copy" }}
                </button>
              </div>
            </div>
            <p
              v-else
              class="text-xs text-slate-500"
            >
              输入时间戳或日期文本后，这里会显示结构化时间列表。
            </p>
          </div>
          <div
            v-else-if="isJsonTransform && jsonOutputMode !== 'escape'"
            class="mt-3 flex-1 overflow-auto rounded-xl border border-slate-700 bg-slate-950/80 p-3"
          >
            <div
              v-if="jsonTreeValue !== null"
              class="space-y-1"
            >
              <JsonTreeNode
                node-key="json-root"
                label="root"
                :value="jsonTreeValue"
                :force-collapsed="jsonTreeForceCollapsed"
              />
            </div>
            <p
              v-else
              class="text-xs text-slate-500"
            >
              输入 JSON 内容后，这里会显示可展开的结构化结果。
            </p>
          </div>
          <textarea
            v-else
            :value="outputText"
            readonly
            class="mt-3 min-h-[220px] flex-1 rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none sm:min-h-[280px] xl:min-h-0"
            placeholder="Converted output will appear here..."
          />
        </div>
      </div>
    </section>
  </section>
</template>
