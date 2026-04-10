<script setup lang="ts">
import { computed, ref, watch } from "vue";

defineOptions({
  name: "JsonTreeNode",
});

const props = withDefaults(defineProps<{
  nodeKey: string;
  label?: string;
  value: unknown;
  depth?: number;
  forceCollapsed?: boolean;
}>(), {
  label: "",
  depth: 0,
  forceCollapsed: false,
});

const collapsed = ref(props.forceCollapsed);

watch(
  () => props.forceCollapsed,
  (value) => {
    collapsed.value = value;
  },
);

const isArrayValue = computed(() => Array.isArray(props.value));
const isObjectValue = computed(() => {
  return !!props.value && typeof props.value === "object" && !Array.isArray(props.value);
});
const isExpandable = computed(() => isArrayValue.value || isObjectValue.value);

const entries = computed(() => {
  if (isArrayValue.value) {
    return (props.value as unknown[]).map((item, index) => ({
      key: `${props.nodeKey}:${index}`,
      label: `[${index}]`,
      value: item,
    }));
  }
  if (isObjectValue.value) {
    return Object.entries(props.value as Record<string, unknown>).map(([key, value]) => ({
      key: `${props.nodeKey}:${key}`,
      label: key,
      value,
    }));
  }
  return [];
});

const summaryText = computed(() => {
  if (isArrayValue.value) {
    return `Array(${entries.value.length})`;
  }
  if (isObjectValue.value) {
    return `Object(${entries.value.length})`;
  }
  return "";
});

const primitiveTypeClass = computed(() => {
  if (typeof props.value === "string") {
    return "text-emerald-300";
  }
  if (typeof props.value === "number") {
    return "text-cyan-300";
  }
  if (typeof props.value === "boolean") {
    return "text-amber-300";
  }
  if (props.value === null) {
    return "text-rose-300";
  }
  return "text-slate-300";
});

const primitiveText = computed(() => {
  if (typeof props.value === "string") {
    return JSON.stringify(props.value);
  }
  if (props.value === null) {
    return "null";
  }
  return String(props.value);
});

function toggleCollapsed() {
  if (!isExpandable.value) {
    return;
  }
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <div class="min-w-0">
    <div class="flex items-start gap-2">
      <button
        v-if="isExpandable"
        type="button"
        class="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-700 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
        @click="toggleCollapsed"
      >
        {{ collapsed ? "+" : "-" }}
      </button>
      <span
        v-else
        class="mt-0.5 inline-flex h-4 w-4 shrink-0"
      />

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5">
          <span
            v-if="label"
            class="break-all text-slate-400"
          >
            {{ label }}:
          </span>

          <template v-if="isExpandable">
            <span class="text-slate-200">{{ summaryText }}</span>
          </template>
          <template v-else>
            <span
              class="break-all"
              :class="primitiveTypeClass"
            >
              {{ primitiveText }}
            </span>
          </template>
        </div>

        <div
          v-if="isExpandable && !collapsed"
          class="mt-1 space-y-1 border-l border-slate-800 pl-3"
        >
          <JsonTreeNode
            v-for="entry in entries"
            :key="entry.key"
            :node-key="entry.key"
            :label="entry.label"
            :value="entry.value"
            :depth="depth + 1"
            :force-collapsed="forceCollapsed"
          />
        </div>
      </div>
    </div>
  </div>
</template>
