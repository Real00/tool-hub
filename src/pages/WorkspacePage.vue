<script setup lang="ts">
import { useRouter } from "vue-router";
import { useToolHubState } from "../composables/use-tool-hub-state";

const router = useRouter();
const { activeTabLabel, appsInActiveTab, openNodeAppWindow, removeNodeApp, stopNodeApp } = useToolHubState();

function openRuntimePage(appId: string) {
    void router.push({
        name: "runtime",
        query: { appId },
    });
}
</script>

<template>
    <section
        class="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6"
    >
        <p class="text-xs uppercase tracking-[0.2em] text-cyan-300/90">
            Active Category
        </p>
        <p class="mt-2 text-xl font-semibold text-slate-100">
            {{ activeTabLabel }}
        </p>
        <p class="mt-2 text-sm text-slate-400">
            App count in this tab: {{ appsInActiveTab.length }}
        </p>
    </section>

    <section class="mt-6 grid gap-3 md:grid-cols-2">
        <article
            v-for="appItem in appsInActiveTab"
            :key="appItem.id"
            class="rounded-2xl border border-slate-700 bg-slate-900/55 p-4"
        >
            <div class="flex items-start justify-between gap-3">
                <div>
                    <p class="text-base font-semibold text-slate-100">
                        {{ appItem.name }}
                    </p>
                    <p class="mt-1 text-xs text-slate-400">
                        {{ appItem.id }} · v{{ appItem.version }}
                    </p>
                    <p class="mt-2 text-xs text-slate-500">
                        {{ appItem.appDir }}
                    </p>
                </div>
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
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    class="rounded-md border border-slate-600 px-2.5 py-1.5 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="openNodeAppWindow(appItem.id)"
                >
                    Open
                </button>
                <button
                    v-if="appItem.running"
                    type="button"
                    class="rounded-md bg-rose-500 px-2.5 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-rose-400"
                    @click="stopNodeApp(appItem.id)"
                >
                    Stop
                </button>
                <button
                    type="button"
                    class="rounded-md border border-slate-600 px-2.5 py-1.5 text-xs transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="openRuntimePage(appItem.id)"
                >
                    Runtime
                </button>
                <button
                    type="button"
                    class="rounded-md border border-rose-500/40 px-2.5 py-1.5 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                    @click="removeNodeApp(appItem.id)"
                >
                    Remove
                </button>
            </div>
        </article>
        <article
            v-if="appsInActiveTab.length === 0"
            class="rounded-2xl border border-slate-700 bg-slate-900/55 p-5 text-sm text-slate-400"
        >
            No apps bound to this tab yet. Install an app to this tab from
            Settings and refresh apps.
        </article>
    </section>
</template>
