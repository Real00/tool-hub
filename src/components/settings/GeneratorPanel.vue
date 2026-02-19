<script setup lang="ts">
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useToolHubState } from "../../composables/use-tool-hub-state";

const {
    autoDetectClaudePath,
    claudeCliPath,
    createNewGeneratorProject,
    generatorFileContent,
    generatorFileLoading,
    generatorFilePath,
    generatorFileTruncated,
    generatorMessage,
    generatorProject,
    generatorProjectId,
    generatorProjectName,
    generatorProjects,
    generatorStatus,
    generatorTabId,
    generatorTerminal,
    generatorTerminalInput,
    generatorTerminalMessage,
    generatorTerminalStatus,
    installAppFromGeneratorProject,
    loadGeneratorProjects,
    loadGeneratorSettingsFromStorage,
    loadGeneratorTerminalState,
    openGeneratorProjectFile,
    resizeEmbeddedTerminal,
    saveClaudePathConfig,
    selectGeneratorProject,
    sendEmbeddedTerminalData,
    sendEmbeddedTerminalCommand,
    startEmbeddedTerminal,
    stopEmbeddedTerminal,
    tabs,
} = useToolHubState();

const generatorFiles = computed(() => {
    return (generatorProject.value?.files ?? []).filter(
        (item) => item.type === "file",
    );
});

const terminalHost = ref<HTMLElement | null>(null);
let xterm: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let renderedOutput = "";
let removeResizeListener: (() => void) | null = null;

function formatTime(value: number): string {
    if (!value) {
        return "-";
    }
    return new Date(value).toLocaleString();
}

function reloadGeneratorPanel() {
    void loadGeneratorSettingsFromStorage();
    void loadGeneratorProjects();
}

function handleProjectChange(projectId: string) {
    void selectGeneratorProject(projectId);
    void loadGeneratorTerminalState(projectId);
}

function handleFileOpen(filePath: string) {
    void openGeneratorProjectFile(filePath);
}

function syncTerminalOutput(output: string) {
    if (!xterm) {
        return;
    }

    const nextOutput = output || "";
    if (!nextOutput) {
        xterm.reset();
        renderedOutput = "";
        return;
    }

    if (nextOutput.startsWith(renderedOutput)) {
        const delta = nextOutput.slice(renderedOutput.length);
        if (delta) {
            xterm.write(delta);
        }
    } else {
        xterm.reset();
        xterm.write(nextOutput);
    }
    renderedOutput = nextOutput;
}

function fitTerminal() {
    if (!xterm || !fitAddon || !generatorProjectId.value) {
        return;
    }
    fitAddon.fit();
    void resizeEmbeddedTerminal(xterm.cols, xterm.rows);
}

onMounted(() => {
    xterm = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontFamily: "Consolas, 'Courier New', monospace",
        fontSize: 12,
        theme: {
            background: "#020617",
            foreground: "#cbd5e1",
            cursor: "#22d3ee",
        },
    });
    fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.onData((data) => {
        void sendEmbeddedTerminalData(data, false);
    });

    if (terminalHost.value) {
        xterm.open(terminalHost.value);
        nextTick(() => {
            fitTerminal();
            syncTerminalOutput(generatorTerminal.value.output);
        });
    }

    const onWindowResize = () => {
        fitTerminal();
    };
    window.addEventListener("resize", onWindowResize);
    removeResizeListener = () => {
        window.removeEventListener("resize", onWindowResize);
    };
});

onBeforeUnmount(() => {
    removeResizeListener?.();
    removeResizeListener = null;
    xterm?.dispose();
    xterm = null;
    fitAddon = null;
    renderedOutput = "";
});

watch(
    () => generatorProjectId.value,
    (projectId) => {
        renderedOutput = "";
        if (xterm) {
            xterm.reset();
        }
        if (projectId) {
            void loadGeneratorTerminalState(projectId);
            nextTick(() => {
                fitTerminal();
            });
        }
    },
);

watch(
    () => generatorTerminal.value.output,
    (output) => {
        syncTerminalOutput(output);
    },
);

watch(
    () => generatorTerminal.value.running,
    (running) => {
        if (running) {
            nextTick(() => {
                fitTerminal();
            });
        }
    },
);
</script>

<template>
    <section class="rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm font-medium text-slate-100">
                AI app generator (Claude CLI)
            </p>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="reloadGeneratorPanel"
                >
                    Reload
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                    @click="autoDetectClaudePath"
                >
                    Detect Path
                </button>
                <button
                    type="button"
                    class="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300"
                    @click="saveClaudePathConfig"
                >
                    Save Path
                </button>
            </div>
        </div>
        <p class="mt-2 text-sm text-slate-400">
            Select a generator project folder, chat with Claude to modify files,
            inspect file content, and install the whole project for validation.
        </p>

        <div class="mt-4 grid gap-2 md:grid-cols-[1fr_220px]">
            <input
                v-model="claudeCliPath"
                type="text"
                placeholder="Claude CLI path or command (e.g. claude, C:\\Tools\\claude.exe)"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
            />
            <select
                v-model="generatorTabId"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring"
            >
                <option
                    v-for="tab in tabs"
                    :key="`generator-tab-${tab.id}`"
                    :value="tab.id"
                >
                    {{ tab.label }} ({{ tab.id }})
                </option>
            </select>
        </div>

        <div class="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
                v-model="generatorProjectName"
                type="text"
                placeholder="New project name (optional)"
                class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
            />
            <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                @click="createNewGeneratorProject"
            >
                Create Project
            </button>
        </div>

        <div class="mt-4 grid gap-3 xl:grid-cols-[260px_320px_1fr]">
            <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <p
                    class="text-xs font-semibold uppercase tracking-wide text-slate-400"
                >
                    Projects
                </p>
                <div class="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
                    <button
                        v-for="project in generatorProjects"
                        :key="project.projectId"
                        type="button"
                        class="w-full rounded-lg border px-3 py-2 text-left text-xs transition"
                        :class="
                            project.projectId === generatorProjectId
                                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                                : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'
                        "
                        @click="handleProjectChange(project.projectId)"
                    >
                        <p class="font-medium">{{ project.projectId }}</p>
                        <p class="mt-1 text-slate-400">
                            {{ project.fileCount }} files ·
                            {{ project.messageCount }} msgs
                        </p>
                        <p class="mt-1 text-slate-500">
                            {{ project.running ? "running" : "idle" }}
                        </p>
                    </button>
                    <p
                        v-if="generatorProjects.length === 0"
                        class="text-xs text-slate-500"
                    >
                        No projects yet. Create one to start.
                    </p>
                </div>
            </div>

            <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <p
                    class="text-xs font-semibold uppercase tracking-wide text-slate-400"
                >
                    Files
                </p>
                <div class="mt-2 max-h-64 space-y-1 overflow-auto pr-1">
                    <button
                        v-for="file in generatorFiles"
                        :key="`generator-file-${file.path}`"
                        type="button"
                        class="w-full rounded-md border px-2 py-1.5 text-left text-xs transition"
                        :class="
                            file.path === generatorFilePath
                                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                                : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'
                        "
                        @click="handleFileOpen(file.path)"
                    >
                        {{ file.path }}
                    </button>
                    <p
                        v-if="generatorFiles.length === 0"
                        class="text-xs text-slate-500"
                    >
                        Select a project to browse files.
                    </p>
                </div>
            </div>

            <div class="space-y-3">
                <div
                    class="rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-xs text-slate-300"
                >
                    <p v-if="generatorProject">
                        Project: <code>{{ generatorProject.projectId }}</code
                        ><br />
                        Path: <code>{{ generatorProject.projectDir }}</code
                        ><br />
                        Updated:
                        <code>{{ formatTime(generatorProject.updatedAt) }}</code
                        ><br />
                        Manifest:
                        <code>
                            {{
                                generatorProject.hasManifest
                                    ? `${generatorProject.appId ?? "-"} (${generatorProject.version ?? "-"})`
                                    : "missing app.json"
                            }}
                        </code>
                    </p>
                    <p v-else>Select or create a project.</p>
                </div>

                <div
                    v-if="generatorProject"
                    class="rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-xs text-slate-300"
                >
                    <p class="font-medium text-slate-200">Claude CLI Output</p>
                    <pre
                        class="mt-2 max-h-36 overflow-auto whitespace-pre-wrap"
                        >{{
                            generatorProject.runningOutput ||
                            (generatorProject.running
                                ? "Claude 正在运行，等待输出..."
                                : "No output yet.")
                        }}</pre
                    >
                </div>

                <div
                    class="rounded-xl border border-slate-700 bg-slate-950/80 p-3"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Embedded Terminal
                        </p>
                        <div class="flex items-center gap-2">
                            <span
                                class="rounded-md px-2 py-1 text-[11px]"
                                :class="
                                    generatorTerminal.running
                                        ? 'bg-emerald-500/20 text-emerald-200'
                                        : 'bg-slate-800 text-slate-300'
                                "
                            >
                                {{ generatorTerminal.running ? "running" : "stopped" }}
                            </span>
                            <button
                                type="button"
                                class="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                                @click="loadGeneratorTerminalState()"
                            >
                                Refresh
                            </button>
                            <button
                                v-if="!generatorTerminal.running"
                                type="button"
                                class="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                                @click="startEmbeddedTerminal"
                            >
                                Start
                            </button>
                            <button
                                v-else
                                type="button"
                                class="rounded-md border border-rose-500/40 px-2 py-1 text-[11px] text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                                @click="stopEmbeddedTerminal"
                            >
                                Stop
                            </button>
                        </div>
                    </div>
                    <p class="mt-1 text-[11px] text-slate-500">
                        {{ generatorTerminal.shellCommand || "-" }}
                    </p>
                    <div
                        ref="terminalHost"
                        class="mt-2 h-52 overflow-hidden rounded-md border border-slate-700 bg-slate-950"
                    />
                    <p class="mt-2 text-[11px] text-slate-500">
                        Terminal keyboard input is forwarded directly to the PTY session.
                    </p>
                    <div class="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                        <input
                            v-model="generatorTerminalInput"
                            type="text"
                            placeholder="Command in selected project directory (e.g. dir, claude)"
                            class="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
                            @keyup.enter="sendEmbeddedTerminalCommand"
                        />
                        <button
                            type="button"
                            class="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                            @click="sendEmbeddedTerminalCommand"
                        >
                            Run
                        </button>
                    </div>
                    <div class="mt-2 flex items-center gap-2 text-[11px]">
                        <span
                            class="rounded-md px-2 py-1"
                            :class="
                                generatorTerminalStatus === 'success'
                                    ? 'bg-emerald-500/20 text-emerald-200'
                                    : generatorTerminalStatus === 'error'
                                      ? 'bg-rose-500/20 text-rose-200'
                                      : generatorTerminalStatus === 'loading'
                                        ? 'bg-amber-500/20 text-amber-200'
                                        : 'bg-slate-800 text-slate-300'
                            "
                        >
                            {{ generatorTerminalStatus }}
                        </span>
                        <span class="text-slate-400">{{ generatorTerminalMessage }}</span>
                    </div>
                </div>

                <div
                    class="rounded-xl border border-slate-700 bg-slate-950/80 p-3"
                >
                    <div class="flex items-center justify-between gap-2">
                        <p
                            class="text-xs font-semibold uppercase tracking-wide text-slate-400"
                        >
                            File Content
                        </p>
                        <span class="text-xs text-slate-500">
                            {{
                                generatorFileLoading
                                    ? "Loading..."
                                    : generatorFilePath || "-"
                            }}
                        </span>
                    </div>
                    <pre
                        class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-200"
                        >{{
                            generatorFileContent ||
                            "Select a file to view its content."
                        }}</pre
                    >
                    <p
                        v-if="generatorFileTruncated"
                        class="mt-2 text-xs text-amber-300"
                    >
                        File content is truncated due to size limit.
                    </p>
                </div>

                <div
                    class="rounded-xl border border-slate-700 bg-slate-950/80 p-3"
                >
                    <div class="max-h-40 space-y-2 overflow-auto pr-1">
                        <div
                            v-for="(
                                item, index
                            ) in generatorProject?.messages ?? []"
                            :key="`generator-msg-${index}`"
                            class="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1.5 text-xs"
                        >
                            <p class="uppercase tracking-wide text-slate-400">
                                {{ item.role }} ·
                                {{ formatTime(item.createdAt) }}
                            </p>
                            <p class="mt-1 whitespace-pre-wrap text-slate-200">
                                {{ item.content }}
                            </p>
                        </div>
                        <p
                            v-if="
                                (generatorProject?.messages ?? []).length === 0
                            "
                            class="text-xs text-slate-500"
                        >
                            No Claude conversation history yet.
                        </p>
                    </div>
                    <div class="mt-3">
                        <button
                            type="button"
                            class="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-emerald-400"
                            @click="installAppFromGeneratorProject"
                        >
                            Install Project App
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="mt-4 flex items-center gap-3 text-xs">
            <span
                class="rounded-md px-2 py-1"
                :class="
                    generatorStatus === 'success'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : generatorStatus === 'error'
                          ? 'bg-rose-500/20 text-rose-200'
                          : generatorStatus === 'loading'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-300'
                "
            >
                {{ generatorStatus }}
            </span>
            <span class="text-slate-300">{{ generatorMessage }}</span>
        </div>
    </section>
</template>
