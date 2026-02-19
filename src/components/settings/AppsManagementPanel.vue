<script setup lang="ts">
import { useToolHubState } from "../../composables/use-tool-hub-state";

const {
    apps,
    appsMessage,
    appsRootInfo,
    appsStatus,
    chooseInstallDirectory,
    initializeAppsDb,
    installNodeApp,
    installSourceDir,
    installTabId,
    loadAppsData,
    openNodeAppWindow,
    removeNodeApp,
    startNodeApp,
    stopNodeApp,
    tabs,
} = useToolHubState();
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

        <div
            class="mt-4 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950/80"
        >
            <table class="min-w-full text-left text-sm text-slate-300">
                <thead
                    class="border-b border-slate-700 bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400"
                >
                    <tr>
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
                        v-for="appItem in apps"
                        :key="appItem.id"
                        class="border-b border-slate-800 last:border-b-0"
                    >
                        <td class="px-3 py-2">{{ appItem.name }}</td>
                        <td class="px-3 py-2 font-mono text-xs">
                            {{ appItem.id }}
                        </td>
                        <td class="px-3 py-2">{{ appItem.tabId }}</td>
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
                                    v-if="!appItem.running"
                                    type="button"
                                    class="rounded-md border border-slate-600 px-2 py-1 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
                                    @click="startNodeApp(appItem.id)"
                                >
                                    Start
                                </button>
                                <button
                                    v-else
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
                    <tr v-if="apps.length === 0">
                        <td
                            colspan="6"
                            class="px-3 py-4 text-center text-slate-500"
                        >
                            No apps discovered in the user apps directory.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>
