<script setup lang="ts">
import { computed } from "vue";
import { useToolHubState } from "../../composables/use-tool-hub-state";

const {
    backupConfigData,
    backupMessage,
    backupStatus,
    bridgeMessage,
    bridgeStatus,
    refreshSystemAppsData,
    restoreConfigData,
    restoreMessage,
    restoreStatus,
    runtimeLabel,
    showOverview,
    systemAppsMessage,
    systemAppsStatus,
    updateState,
    testElectronBridge,
    toggleOverview,
    loadUpdateState,
    checkForAppUpdates,
    downloadAppUpdate,
    installAppUpdate,
} = useToolHubState();

const canDownloadUpdate = computed(() => updateState.value.status === "available");
const canInstallUpdate = computed(() => updateState.value.status === "downloaded");
const isCheckingUpdate = computed(() => updateState.value.status === "checking");
const isDownloadingUpdate = computed(() => updateState.value.status === "downloading");
const updateProgressText = computed(() => {
    const progress = updateState.value.progress;
    if (!progress) {
        return "";
    }
    return `${progress.percent.toFixed(1)}% (${progress.transferred}/${progress.total})`;
});
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
                    @click="backupConfigData"
                >
                    Backup ZIP
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="restoreConfigData"
                >
                    Restore ZIP
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="loadUpdateState"
                >
                    Refresh Update State
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
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <span
                class="rounded-md px-2 py-1 text-xs"
                :class="
                    backupStatus === 'success'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : backupStatus === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : backupStatus === 'loading'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-300'
                "
            >
                Backup: {{ backupStatus }}
            </span>
            <span class="text-xs text-slate-400">{{ backupMessage }}</span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <span
                class="rounded-md px-2 py-1 text-xs"
                :class="
                    restoreStatus === 'success'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : restoreStatus === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : restoreStatus === 'loading'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-300'
                "
            >
                Restore: {{ restoreStatus }}
            </span>
            <span class="text-xs text-slate-400">{{ restoreMessage }}</span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <span
                class="rounded-md px-2 py-1 text-xs"
                :class="
                    updateState.status === 'downloaded'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : updateState.status === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : updateState.status === 'checking' || updateState.status === 'downloading'
                            ? 'bg-amber-500/20 text-amber-200'
                            : updateState.status === 'disabled'
                              ? 'bg-slate-800 text-slate-300'
                              : 'bg-cyan-500/20 text-cyan-200'
                "
            >
                Update: {{ updateState.status }}
            </span>
            <span class="text-xs text-slate-400">Current {{ updateState.currentVersion }}</span>
            <span
                v-if="updateState.availableVersion"
                class="text-xs text-slate-400"
            >
                Latest {{ updateState.availableVersion }}
            </span>
            <span
                v-if="updateProgressText"
                class="text-xs text-slate-400"
            >
                {{ updateProgressText }}
            </span>
        </div>
        <p class="mt-2 text-xs text-slate-400">{{ updateState.message }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isCheckingUpdate || isDownloadingUpdate"
                @click="checkForAppUpdates"
            >
                Check Update
            </button>
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canDownloadUpdate || isDownloadingUpdate"
                @click="downloadAppUpdate"
            >
                Download Update
            </button>
            <button
                type="button"
                class="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canInstallUpdate"
                @click="installAppUpdate"
            >
                Install and Restart
            </button>
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
