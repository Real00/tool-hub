<script setup lang="ts">
import { ref } from "vue";
import { useToolHubState } from "../../composables/use-tool-hub-state";

const {
    addTabRow,
    autofillTabId,
    initializeSettingsDb,
    loadTabsFromStorage,
    moveTabRow,
    moveTabRowTo,
    removeTabRow,
    saveTabsToStorage,
    settingsMessage,
    settingsStatus,
    tabDraft,
} = useToolHubState();

const draggingIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

function clearDragState() {
    draggingIndex.value = null;
    dragOverIndex.value = null;
}

function handleDragStart(index: number, event: DragEvent) {
    draggingIndex.value = index;
    dragOverIndex.value = index;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
    }
}

function handleDragEnd() {
    clearDragState();
}

function handleRowDragEnter(index: number) {
    if (draggingIndex.value === null) {
        return;
    }
    dragOverIndex.value = index;
}

function handleRowDragOver(index: number, event: DragEvent) {
    if (draggingIndex.value === null) {
        return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dragOverIndex.value = index;
}

function handleRowDrop(index: number, event: DragEvent) {
    event.preventDefault();
    const sourceIndex = draggingIndex.value;
    if (sourceIndex === null) {
        clearDragState();
        return;
    }

    let targetIndex = index;
    if (targetIndex > sourceIndex) {
        targetIndex -= 1;
    }
    moveTabRowTo(sourceIndex, targetIndex);
    clearDragState();
}

function handleDropToEnd(event: DragEvent) {
    event.preventDefault();
    const sourceIndex = draggingIndex.value;
    if (sourceIndex === null) {
        clearDragState();
        return;
    }
    moveTabRowTo(sourceIndex, tabDraft.value.length);
    clearDragState();
}
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
        <p class="mt-1 text-xs text-slate-500">
            Drag rows to reorder tabs.
        </p>

        <div class="mt-4 space-y-2">
            <div
                v-for="(tab, index) in tabDraft"
                :key="`${tab.id}-${index}`"
                class="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/60 p-3 md:grid-cols-[1fr_1fr_auto]"
                :class="
                    dragOverIndex === index &&
                    draggingIndex !== null &&
                    draggingIndex !== index
                        ? 'border-cyan-500/50 ring-1 ring-cyan-500/40'
                        : ''
                "
                @dragenter="handleRowDragEnter(index)"
                @dragover="handleRowDragOver(index, $event)"
                @drop="handleRowDrop(index, $event)"
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
                <div class="flex items-center gap-1">
                    <button
                        type="button"
                        draggable="true"
                        class="cursor-grab rounded-md border border-slate-600 px-2 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 active:cursor-grabbing"
                        aria-label="Drag tab"
                        title="Drag"
                        @dragstart="handleDragStart(index, $event)"
                        @dragend="handleDragEnd"
                    >
                        <span aria-hidden="true" class="inline-flex items-center">
                            <svg
                                viewBox="0 0 16 16"
                                class="h-3.5 w-3.5 fill-current"
                            >
                                <circle cx="5" cy="4" r="1.1" />
                                <circle cx="11" cy="4" r="1.1" />
                                <circle cx="5" cy="8" r="1.1" />
                                <circle cx="11" cy="8" r="1.1" />
                                <circle cx="5" cy="12" r="1.1" />
                                <circle cx="11" cy="12" r="1.1" />
                            </svg>
                        </span>
                    </button>
                    <button
                        type="button"
                        class="rounded-md border border-slate-600 px-2 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
                        :disabled="index === 0"
                        aria-label="Move up"
                        title="Move up"
                        @click="moveTabRow(index, 'up')"
                    >
                        <span aria-hidden="true" class="inline-flex items-center">
                            <svg
                                viewBox="0 0 16 16"
                                class="h-3.5 w-3.5 fill-current"
                            >
                                <path d="M8 3.2l4.8 5.6H3.2L8 3.2z" />
                            </svg>
                        </span>
                    </button>
                    <button
                        type="button"
                        class="rounded-md border border-slate-600 px-2 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
                        :disabled="index === tabDraft.length - 1"
                        aria-label="Move down"
                        title="Move down"
                        @click="moveTabRow(index, 'down')"
                    >
                        <span aria-hidden="true" class="inline-flex items-center">
                            <svg
                                viewBox="0 0 16 16"
                                class="h-3.5 w-3.5 fill-current"
                            >
                                <path d="M8 12.8L3.2 7.2h9.6L8 12.8z" />
                            </svg>
                        </span>
                    </button>
                    <button
                        type="button"
                        class="rounded-md border border-rose-500/40 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                        @click="removeTabRow(index)"
                    >
                        Remove
                    </button>
                </div>
            </div>

            <div
                class="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-500"
                :class="draggingIndex !== null ? 'border-cyan-500/50 text-cyan-300' : ''"
                @dragover.prevent
                @drop="handleDropToEnd($event)"
            >
                Drop here to move tab to end
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
