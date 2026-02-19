<script setup lang="ts">
import { useToolHubState } from "../../composables/use-tool-hub-state";

const {
    addTabRow,
    autofillTabId,
    initializeSettingsDb,
    loadTabsFromStorage,
    removeTabRow,
    saveTabsToStorage,
    settingsMessage,
    settingsStatus,
    tabDraft,
} = useToolHubState();
</script>

<template>
    <section class="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm font-medium text-slate-100">
                Settings: Tab definitions
            </p>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="loadTabsFromStorage"
                >
                    Reload
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="addTabRow"
                >
                    Add Tab
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="initializeSettingsDb"
                >
                    Init DB
                </button>
                <button
                    type="button"
                    class="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300"
                    @click="saveTabsToStorage"
                >
                    Save
                </button>
            </div>
        </div>
        <p class="mt-2 text-sm text-slate-400">
            Built-in tab definitions are persisted to local SQLite.
        </p>

        <div class="mt-4 space-y-2">
            <div
                v-for="(tab, index) in tabDraft"
                :key="`${tab.id}-${index}`"
                class="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/60 p-3 md:grid-cols-[1fr_1fr_auto]"
            >
                <input
                    v-model="tab.label"
                    type="text"
                    placeholder="Tab label"
                    class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
                    @blur="autofillTabId(index)"
                />
                <input
                    v-model="tab.id"
                    type="text"
                    placeholder="tab-id"
                    class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
                />
                <button
                    type="button"
                    class="rounded-md border border-rose-500/40 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                    @click="removeTabRow(index)"
                >
                    Remove
                </button>
            </div>
        </div>

        <div class="mt-4 flex items-center gap-3 text-xs">
            <span
                class="rounded-md px-2 py-1"
                :class="
                    settingsStatus === 'success'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : settingsStatus === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : settingsStatus === 'saving'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-300'
                "
            >
                {{ settingsStatus }}
            </span>
            <span class="text-slate-300">{{ settingsMessage }}</span>
        </div>
    </section>
</template>
