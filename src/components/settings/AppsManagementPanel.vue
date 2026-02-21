<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToolHubState } from "../../composables/use-tool-hub-state";

const {
    apps,
    appsMessage,
    appsRootInfo,
    appsStatus,
    batchRemoveNodeApps,
    batchStopNodeApps,
    chooseInstallDirectory,
    initializeAppsDb,
    installNodeApp,
    installSourceDir,
    installTabId,
    loadAppsData,
    openNodeAppWindow,
    removeNodeApp,
    stopNodeApp,
    tabs,
    updateNodeAppTab,
} = useToolHubState();

const searchText = ref("");
const statusFilter = ref<"all" | "running" | "stopped">("all");
const selectedAppIds = ref<Set<string>>(new Set());

const filteredApps = computed(() => {
    const query = searchText.value.trim().toLowerCase();
    return apps.value.filter((appItem) => {
        if (statusFilter.value === "running" && !appItem.running) {
            return false;
        }
        if (statusFilter.value === "stopped" && appItem.running) {
            return false;
        }
        if (!query) {
            return true;
        }
        return (
            appItem.name.toLowerCase().includes(query) ||
            appItem.id.toLowerCase().includes(query) ||
            appItem.tabId.toLowerCase().includes(query)
        );
    });
});

const hasSelection = computed(() => selectedAppIds.value.size > 0);
const allFilteredSelected = computed(() => {
    if (filteredApps.value.length === 0) {
        return false;
    }
    return filteredApps.value.every((appItem) => selectedAppIds.value.has(appItem.id));
});

watch(
    () => apps.value.map((item) => item.id).join("|"),
    () => {
        const validIds = new Set(apps.value.map((item) => item.id));
        const next = new Set<string>();
        selectedAppIds.value.forEach((id) => {
            if (validIds.has(id)) {
                next.add(id);
            }
        });
        selectedAppIds.value = next;
    },
);

function setAppSelected(appId: string, checked: boolean) {
    const next = new Set(selectedAppIds.value);
    if (checked) {
        next.add(appId);
    } else {
        next.delete(appId);
    }
    selectedAppIds.value = next;
}

function handleSelectAll(event: Event) {
    const target = event.target as HTMLInputElement | null;
    if (!target) {
        return;
    }
    if (!target.checked) {
        selectedAppIds.value = new Set();
        return;
    }
    selectedAppIds.value = new Set(filteredApps.value.map((item) => item.id));
}

function handleRowSelectChange(appId: string, event: Event) {
    const target = event.target as HTMLInputElement | null;
    if (!target) {
        return;
    }
    setAppSelected(appId, target.checked);
}

function handleTabChange(appId: string, event: Event) {
    const target = event.target as HTMLSelectElement | null;
    if (!target) {
        return;
    }
    void updateNodeAppTab(appId, target.value);
}

function clearSelection() {
    selectedAppIds.value = new Set();
}

function handleBatchStop() {
    if (!hasSelection.value) {
        return;
    }
    const targets = Array.from(selectedAppIds.value);
    void batchStopNodeApps(targets).finally(() => {
        clearSelection();
    });
}

function handleBatchRemove() {
    if (!hasSelection.value) {
        return;
    }
    const targets = Array.from(selectedAppIds.value);
    void batchRemoveNodeApps(targets).finally(() => {
        clearSelection();
    });
}
</script>

<template>
    <section class="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm font-medium text-slate-100">
                Node apps management
            </p>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="loadAppsData"
                >
                    Refresh Apps
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="initializeAppsDb"
                >
                    Init DB
                </button>
            </div>
        </div>
        <p class="mt-2 text-sm text-slate-400">
            Apps root: <code>{{ appsRootInfo?.appsRoot ?? "-" }}</code
            ><br />
            Apps DB: <code>{{ appsRootInfo?.dbPath ?? "-" }}</code
            ><br />
            App category is persisted in local SQLite
            (<code>apps.tab_id</code>). The tab selected below will be written
            to database at install time.
        </p>

        <div class="mt-4 grid gap-2 md:grid-cols-[1fr_220px_auto_auto]">
            <input
                v-model="installSourceDir"
                type="text"
                placeholder="Source directory with app.json (e.g. D:\\apps\\hello-app)"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
            />
            <select
                v-model="installTabId"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring"
            >
                <option
                    v-for="tab in tabs"
                    :key="`install-tab-${tab.id}`"
                    :value="tab.id"
                >
                    {{ tab.label }} ({{ tab.id }})
                </option>
            </select>
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                @click="chooseInstallDirectory"
            >
                Select Dir
            </button>
            <button
                type="button"
                class="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300"
                @click="installNodeApp"
            >
                Install App
            </button>
        </div>

        <div class="mt-4 flex items-center gap-3 text-xs">
            <span
                class="rounded-md px-2 py-1"
                :class="
                    appsStatus === 'success'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : appsStatus === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : appsStatus === 'loading'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-300'
                "
            >
                {{ appsStatus }}
            </span>
            <span class="text-slate-300">{{ appsMessage }}</span>
        </div>

        <div class="mt-4 grid gap-2 md:grid-cols-[1fr_160px_auto_auto_auto]">
            <input
                v-model="searchText"
                type="text"
                placeholder="Search by name/id/tab"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
            />
            <select
                v-model="statusFilter"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring"
            >
                <option value="all">All</option>
                <option value="running">Running</option>
                <option value="stopped">Stopped</option>
            </select>
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!hasSelection"
                @click="handleBatchStop"
            >
                Stop Selected
            </button>
            <button
                type="button"
                class="rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!hasSelection"
                @click="handleBatchRemove"
            >
                Remove Selected
            </button>
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!hasSelection"
                @click="clearSelection"
            >
                Clear Selection
            </button>
        </div>

        <div
            class="mt-4 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950/80"
        >
            <table class="min-w-full text-left text-sm text-slate-300">
                <thead
                    class="border-b border-slate-700 bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400"
                >
                    <tr>
                        <th class="px-3 py-2">
                            <input
                                type="checkbox"
                                class="h-3.5 w-3.5 accent-cyan-400"
                                :checked="allFilteredSelected"
                                @change="handleSelectAll"
                            />
                        </th>
                        <th class="px-3 py-2">Name</th>
                        <th class="px-3 py-2">ID</th>
                        <th class="px-3 py-2">Tab</th>
                        <th class="px-3 py-2">Version</th>
                        <th class="px-3 py-2">Status</th>
                        <th class="px-3 py-2">Action</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="appItem in filteredApps"
                        :key="appItem.id"
                        class="border-b border-slate-800 last:border-b-0"
                    >
                        <td class="px-3 py-2">
                            <input
                                type="checkbox"
                                class="h-3.5 w-3.5 accent-cyan-400"
                                :checked="selectedAppIds.has(appItem.id)"
                                @change="handleRowSelectChange(appItem.id, $event)"
                            />
                        </td>
                        <td class="px-3 py-2">{{ appItem.name }}</td>
                        <td class="px-3 py-2 font-mono text-xs">
                            {{ appItem.id }}
                        </td>
                        <td class="px-3 py-2">
                            <select
                                :value="appItem.tabId"
                                class="min-w-[160px] rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none ring-cyan-500/50 focus:ring"
                                @change="handleTabChange(appItem.id, $event)"
                            >
                                <option
                                    v-for="tab in tabs"
                                    :key="`row-tab-${appItem.id}-${tab.id}`"
                                    :value="tab.id"
                                >
                                    {{ tab.label }} ({{ tab.id }})
                                </option>
                            </select>
                        </td>
                        <td class="px-3 py-2">{{ appItem.version }}</td>
                        <td class="px-3 py-2">
                            <span
                                class="rounded-md px-2 py-1 text-xs"
                                :class="
                                    appItem.running
                                        ? 'bg-emerald-500/20 text-emerald-200'
                                        : 'bg-slate-800 text-slate-300'
                                "
                            >
                                {{
                                    appItem.running
                                        ? `running (${appItem.pid ?? "-"})`
                                        : "stopped"
                                }}
                            </span>
                        </td>
                        <td class="px-3 py-2">
                            <div class="flex gap-1">
                                <button
                                    type="button"
                                    class="rounded-md border border-slate-600 px-2 py-1 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
                                    @click="openNodeAppWindow(appItem.id)"
                                >
                                    Open
                                </button>
                                <button
                                    v-if="appItem.running"
                                    type="button"
                                    class="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                                    @click="stopNodeApp(appItem.id)"
                                >
                                    Stop
                                </button>
                                <button
                                    type="button"
                                    class="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                                    @click="removeNodeApp(appItem.id)"
                                >
                                    Remove
                                </button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="filteredApps.length === 0">
                        <td
                            colspan="7"
                            class="px-3 py-4 text-center text-slate-500"
                        >
                            No apps match current filter.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>
