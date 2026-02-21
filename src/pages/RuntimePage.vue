<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useToolHubState } from "../composables/use-tool-hub-state";

const route = useRoute();
const {
    appLogs,
    appRuns,
    apps,
    appsInActiveTab,
    loadAppLogs,
    logsStatus,
    openNodeAppWindow,
    runsStatus,
    stopNodeApp,
} = useToolHubState();

const selectedAppId = ref("");

const selectedApp = computed(() => {
    if (!selectedAppId.value) {
        return null;
    }
    return apps.value.find((item) => item.id === selectedAppId.value) ?? null;
});

const routeAppId = computed(() => {
    const raw = route.query.appId;
    if (typeof raw === "string") {
        return raw.trim();
    }
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
        return raw[0].trim();
    }
    return "";
});

function appExists(appId: string): boolean {
    return apps.value.some((item) => item.id === appId);
}

function pickFallbackAppId(): string {
    if (appsInActiveTab.value.length > 0) {
        return appsInActiveTab.value[0].id;
    }
    return apps.value[0]?.id ?? "";
}

function syncSelectedApp(preferredAppId?: string) {
    const candidates = [
        preferredAppId ?? "",
        selectedAppId.value,
        pickFallbackAppId(),
    ].filter(Boolean);

    for (let i = 0; i < candidates.length; i += 1) {
        if (appExists(candidates[i])) {
            selectedAppId.value = candidates[i];
            return;
        }
    }

    selectedAppId.value = "";
}

function refreshRuntimeData() {
    void loadAppLogs(selectedAppId.value || null);
}

function handleOpenSelectedApp() {
    if (!selectedApp.value) {
        return;
    }
    void openNodeAppWindow(selectedApp.value.id);
}

function handleStopSelectedApp() {
    if (!selectedApp.value || !selectedApp.value.running) {
        return;
    }
    void stopNodeApp(selectedApp.value.id);
}

function formatRunTime(value: number | null): string {
    if (!value || !Number.isFinite(value)) {
        return "-";
    }
    return new Date(value).toLocaleString();
}

function formatDuration(value: number | null): string {
    if (!value || value <= 0) {
        return "-";
    }
    if (value < 1000) {
        return `${value} ms`;
    }
    const seconds = Math.floor(value / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return `${minutes}m ${remainSeconds}s`;
}

watch(
    [() => apps.value.map((item) => item.id).join("|"), routeAppId],
    ([, queryAppId]) => {
        syncSelectedApp(queryAppId || undefined);
    },
    { immediate: true },
);

watch(
    () => selectedAppId.value,
    () => {
        refreshRuntimeData();
    },
    { immediate: true },
);
</script>

<template>
    <section class="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
        <p class="text-sm font-medium text-slate-100">Runtime Diagnostics</p>
        <p class="mt-2 text-sm text-slate-400">
            Dedicated runtime view for app logs and execution history.
        </p>

        <div v-if="apps.length === 0" class="mt-4 rounded-lg border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-400">
            No installed apps found. Install apps from Settings first.
        </div>

        <div v-else class="mt-4 grid gap-3 md:grid-cols-[minmax(280px,1fr)_auto_auto_auto]">
            <select
                v-model="selectedAppId"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring"
            >
                <option
                    v-for="appItem in apps"
                    :key="`runtime-app-${appItem.id}`"
                    :value="appItem.id"
                >
                    {{ appItem.name }} ({{ appItem.id }}) {{ appItem.running ? "• running" : "• stopped" }}
                </option>
            </select>
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedApp"
                @click="handleOpenSelectedApp"
            >
                Open
            </button>
            <button
                type="button"
                class="rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedApp || !selectedApp.running"
                @click="handleStopSelectedApp"
            >
                Stop
            </button>
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedApp"
                @click="refreshRuntimeData"
            >
                Refresh
            </button>
        </div>
    </section>

    <section class="mt-6 grid gap-4 xl:grid-cols-2">
        <article class="rounded-xl border border-slate-700 bg-slate-950/80 p-4">
            <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-slate-100">Runtime logs</p>
                <span
                    class="rounded-md px-2 py-1 text-xs"
                    :class="
                        logsStatus === 'error'
                            ? 'bg-rose-500/20 text-rose-200'
                            : logsStatus === 'loading'
                              ? 'bg-amber-500/20 text-amber-200'
                              : 'bg-slate-800 text-slate-300'
                    "
                >
                    {{ logsStatus }}
                </span>
            </div>
            <pre class="mt-3 max-h-[62vh] overflow-auto whitespace-pre-wrap text-xs text-slate-300">{{
                appLogs.join("\n") || "No logs selected."
            }}</pre>
        </article>

        <article class="rounded-xl border border-slate-700 bg-slate-950/80 p-4">
            <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-slate-100">Runtime history</p>
                <span
                    class="rounded-md px-2 py-1 text-xs"
                    :class="
                        runsStatus === 'error'
                            ? 'bg-rose-500/20 text-rose-200'
                            : runsStatus === 'loading'
                              ? 'bg-amber-500/20 text-amber-200'
                              : 'bg-slate-800 text-slate-300'
                    "
                >
                    {{ runsStatus }}
                </span>
            </div>
            <div
                class="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70"
            >
                <table class="min-w-full text-left text-xs text-slate-300">
                    <thead class="border-b border-slate-800 text-slate-400">
                        <tr>
                            <th class="px-3 py-2">Run ID</th>
                            <th class="px-3 py-2">Started</th>
                            <th class="px-3 py-2">Ended</th>
                            <th class="px-3 py-2">Duration</th>
                            <th class="px-3 py-2">PID</th>
                            <th class="px-3 py-2">Exit</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="run in appRuns"
                            :key="`runtime-run-${run.runId}`"
                            class="border-b border-slate-900 last:border-b-0"
                        >
                            <td class="px-3 py-2">{{ run.runId }}</td>
                            <td class="px-3 py-2">{{ formatRunTime(run.startedAt) }}</td>
                            <td class="px-3 py-2">{{ formatRunTime(run.endedAt) }}</td>
                            <td class="px-3 py-2">{{ formatDuration(run.durationMs) }}</td>
                            <td class="px-3 py-2">{{ run.pid ?? "-" }}</td>
                            <td class="px-3 py-2">{{ run.exitCode ?? "-" }}</td>
                        </tr>
                        <tr v-if="appRuns.length === 0">
                            <td
                                colspan="6"
                                class="px-3 py-3 text-center text-slate-500"
                            >
                                No runtime history selected.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </article>
    </section>
</template>
