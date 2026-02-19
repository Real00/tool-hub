<script setup lang="ts">
import { useToolHubState } from "../../composables/use-tool-hub-state";

const {
    bridgeMessage,
    bridgeStatus,
    refreshSystemAppsData,
    runtimeLabel,
    showOverview,
    systemAppsMessage,
    systemAppsStatus,
    testElectronBridge,
    toggleOverview,
} = useToolHubState();
</script>

<template>
    <section class="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm font-medium text-slate-100">Runtime and Bridge</p>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="testElectronBridge"
                >
                    Test Bridge
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="refreshSystemAppsData"
                >
                    Refresh System Apps
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="toggleOverview"
                >
                    {{ showOverview ? "Hide Overview" : "Show Overview" }}
                </button>
            </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200">
                Runtime: {{ runtimeLabel }}
            </span>
            <span
                class="rounded-md px-2 py-1 text-xs"
                :class="
                    bridgeStatus === 'success'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : bridgeStatus === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : bridgeStatus === 'loading'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-300'
                "
            >
                {{ bridgeStatus }}
            </span>
        </div>
        <p class="mt-2 text-xs text-slate-400">{{ bridgeMessage }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <span
                class="rounded-md px-2 py-1 text-xs"
                :class="
                    systemAppsStatus === 'success'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : systemAppsStatus === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : systemAppsStatus === 'loading'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-300'
                "
            >
                System Apps: {{ systemAppsStatus }}
            </span>
            <span class="text-xs text-slate-400">{{ systemAppsMessage }}</span>
        </div>

        <div
            v-if="showOverview"
            class="mt-3 rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300"
        >
            Top tabs are category definitions. App-to-tab binding is persisted
            in local SQLite, and opening an app launches its UI in a new window.
        </div>
    </section>
</template>
