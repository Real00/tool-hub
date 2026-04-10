<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { isElectronRuntime, listSystemApps, openSystemApp } from "../../platform/electron-bridge";
import type { SystemAppEntry } from "../../types/system-app";

const canUseSystemApps = isElectronRuntime();
const systemApps = ref<SystemAppEntry[]>([]);
const filterText = ref("");
const status = ref<"idle" | "loading" | "error">("idle");
const message = ref("浏览 Tool Hub 当前内置的系统应用，并直接打开对应能力。");

const categoryLabelMap: Record<string, string> = {
  launcher: "AI",
  recorder: "Recorder",
  tool: "System Tool",
};

const filteredApps = computed(() => {
  const query = filterText.value.trim().toLowerCase();
  if (!query) {
    return systemApps.value;
  }
  return systemApps.value.filter((item) => {
    const haystack = [
      item.name,
      item.description ?? "",
      item.category ?? "",
      item.source,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
});

function formatCategory(category: string | undefined): string {
  const key = String(category ?? "").trim().toLowerCase();
  return categoryLabelMap[key] || "System Tool";
}

async function loadSystemApps() {
  if (!canUseSystemApps) {
    systemApps.value = [];
    status.value = "error";
    message.value = "System apps are only available in Electron runtime.";
    return;
  }

  status.value = "loading";
  message.value = "Loading system apps...";
  try {
    systemApps.value = await listSystemApps();
    status.value = "idle";
    message.value =
      systemApps.value.length > 0
        ? `当前系统应用共有 ${systemApps.value.length} 个，可在这里直接打开。`
        : "No built-in system apps found.";
  } catch (error) {
    status.value = "error";
    message.value = error instanceof Error ? error.message : String(error);
  }
}

async function handleOpen(appId: string) {
  try {
    await openSystemApp(appId);
  } catch (error) {
    status.value = "error";
    message.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(() => {
  void loadSystemApps();
});
</script>

<template>
  <section class="rounded-2xl border border-slate-700 bg-slate-900/55 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-slate-100">System Apps</p>
        <p class="mt-2 text-sm text-slate-400">
          {{ message }}
        </p>
      </div>
      <input
        v-model="filterText"
        type="text"
        class="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-500/40 sm:w-72"
        placeholder="Search built-in system apps..."
      />
    </div>

    <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="app in filteredApps"
        :key="app.id"
        class="rounded-2xl border border-slate-700 bg-slate-950/70 p-4"
      >
        <div class="flex items-start gap-3">
          <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 text-xs font-semibold text-slate-200">
            <img
              v-if="app.iconDataUrl"
              :src="app.iconDataUrl"
              alt=""
              class="h-10 w-10 object-contain"
            />
            <span v-else>{{ app.name.slice(0, 1) }}</span>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-base font-semibold text-slate-100">{{ app.name }}</p>
              <span class="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                {{ formatCategory(app.category) }}
              </span>
              <span
                v-if="app.acceptsLaunchPayload"
                class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-emerald-200"
              >
                Supports payload
              </span>
            </div>
            <p class="mt-2 text-sm leading-6 text-slate-400">
              {{ app.description || "No description available." }}
            </p>
            <p class="mt-2 text-xs text-slate-500">{{ app.source }}</p>
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="rounded-lg border border-cyan-500/40 px-3 py-2 text-xs text-cyan-200 transition hover:border-cyan-400 hover:text-cyan-100"
            @click="handleOpen(app.id)"
          >
            Open
          </button>
        </div>
      </article>

      <article
        v-if="filteredApps.length === 0 && status !== 'loading'"
        class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 p-5 text-sm text-slate-500 md:col-span-2 xl:col-span-3"
      >
        No matching built-in system apps.
      </article>

      <article
        v-if="status === 'loading'"
        class="rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 p-5 text-sm text-slate-500 md:col-span-2 xl:col-span-3"
      >
        Loading...
      </article>
    </div>
  </section>
</template>
