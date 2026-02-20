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
    startEmbeddedTerminal,
    stopEmbeddedTerminal,
    tabs,
} = useToolHubState();

interface TreeNode {
    path: string;
    name: string;
    type: "file" | "directory";
    children: TreeNode[];
}

interface TreeRow {
    node: TreeNode;
    depth: number;
    hasChildren: boolean;
    expanded: boolean;
}

const expandedDirs = ref<Set<string>>(new Set());

function buildTreeNodes(
    entries: Array<{
        path: string;
        type: "file" | "directory";
    }>,
): TreeNode[] {
    type BuildNode = {
        path: string;
        name: string;
        type: "file" | "directory";
        children: Map<string, BuildNode>;
    };

    const root: BuildNode = {
        path: "",
        name: "",
        type: "directory",
        children: new Map(),
    };

    function ensureDirectory(parts: string[]): BuildNode {
        let current = root;
        let currentPath = "";
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            let next = current.children.get(part);
            if (!next) {
                next = {
                    path: currentPath,
                    name: part,
                    type: "directory",
                    children: new Map(),
                };
                current.children.set(part, next);
            }
            current = next;
        }
        return current;
    }

    const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
    for (const entry of sorted) {
        const parts = entry.path.split("/").filter(Boolean);
        if (parts.length === 0) {
            continue;
        }

        if (entry.type === "directory") {
            ensureDirectory(parts);
            continue;
        }

        const parent = ensureDirectory(parts.slice(0, -1));
        const name = parts[parts.length - 1];
        if (!parent.children.has(name)) {
            parent.children.set(name, {
                path: entry.path,
                name,
                type: "file",
                children: new Map(),
            });
        }
    }

    function toTree(node: BuildNode): TreeNode[] {
        const children = Array.from(node.children.values()).sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "directory" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return children.map((child) => ({
            path: child.path,
            name: child.name,
            type: child.type,
            children: child.type === "directory" ? toTree(child) : [],
        }));
    }

    return toTree(root);
}

const generatorTree = computed(() => {
    return buildTreeNodes(generatorProject.value?.files ?? []);
});

const generatorTreeRows = computed<TreeRow[]>(() => {
    const rows: TreeRow[] = [];
    const expanded = expandedDirs.value;

    function walk(nodes: TreeNode[], depth: number) {
        for (const node of nodes) {
            const hasChildren = node.children.length > 0;
            const isExpanded =
                node.type === "directory" &&
                (expanded.has(node.path) || node.path === "");

            rows.push({
                node,
                depth,
                hasChildren,
                expanded: isExpanded,
            });

            if (node.type === "directory" && isExpanded && hasChildren) {
                walk(node.children, depth + 1);
            }
        }
    }

    walk(generatorTree.value, 0);
    return rows;
});

function expandAllDirectories() {
    const next = new Set<string>();
    const entries = generatorProject.value?.files ?? [];
    for (const entry of entries) {
        if (entry.type === "directory") {
            next.add(entry.path);
        }
    }
    expandedDirs.value = next;
}

function toggleDirectory(path: string) {
    const next = new Set(expandedDirs.value);
    if (next.has(path)) {
        next.delete(path);
    } else {
        next.add(path);
    }
    expandedDirs.value = next;
}

const terminalHost = ref<HTMLElement | null>(null);
let xterm: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let renderedOutput = "";
let renderedSeq = 0;
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

function writeTerminalWithScrollRetention(chunk: string) {
    if (!xterm || !chunk) {
        return;
    }
    const previousViewportY = xterm.buffer.active.viewportY;
    const previousBaseY = xterm.buffer.active.baseY;
    const pinnedToBottom = previousViewportY >= previousBaseY;

    xterm.write(chunk, () => {
        if (!xterm) {
            return;
        }
        if (!pinnedToBottom) {
            xterm.scrollToLine(previousViewportY);
        }
    });
}

function syncTerminalOutput(state: {
    output: string;
    outputSeq: number;
    lastChunk: string;
}) {
    if (!xterm) {
        return;
    }

    const nextOutput = state.output || "";
    const nextSeq = Number(state.outputSeq || 0);
    const nextChunk = state.lastChunk || "";
    if (!nextOutput) {
        xterm.reset();
        renderedOutput = "";
        renderedSeq = 0;
        return;
    }

    if (
        nextSeq > renderedSeq &&
        nextChunk &&
        nextOutput.startsWith(renderedOutput) &&
        nextOutput.endsWith(nextChunk)
    ) {
        writeTerminalWithScrollRetention(nextChunk);
        renderedOutput = nextOutput;
        renderedSeq = nextSeq;
        return;
    }

    if (nextOutput === renderedOutput) {
        renderedSeq = nextSeq;
        return;
    }

    xterm.reset();
    writeTerminalWithScrollRetention(nextOutput);
    renderedOutput = nextOutput;
    renderedSeq = nextSeq;
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
            syncTerminalOutput({
                output: generatorTerminal.value.output,
                outputSeq: generatorTerminal.value.outputSeq,
                lastChunk: generatorTerminal.value.lastChunk,
            });
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
    renderedSeq = 0;
});

watch(
    () => generatorProjectId.value,
    (projectId) => {
        renderedOutput = "";
        if (xterm) {
            xterm.reset();
        }
        renderedSeq = 0;
        if (projectId) {
            expandAllDirectories();
            void loadGeneratorTerminalState(projectId);
            nextTick(() => {
                fitTerminal();
            });
        }
    },
);

watch(
    [
        () => generatorTerminal.value.output,
        () => generatorTerminal.value.outputSeq,
        () => generatorTerminal.value.lastChunk,
    ],
    ([output, outputSeq, lastChunk]) => {
        syncTerminalOutput({
            output,
            outputSeq,
            lastChunk,
        });
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
            Select a generator project folder, run Claude CLI in the embedded
            terminal to modify files, inspect file content, and install the
            whole project for validation.
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

        <div class="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto]">
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
            <button
                type="button"
                class="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-emerald-400"
                @click="installAppFromGeneratorProject"
            >
                Install Project App
            </button>
        </div>

        <div class="mt-4 grid gap-3 xl:grid-cols-[minmax(180px,0.55fr)_minmax(700px,2.45fr)]">
            <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Projects
                </p>
                <div class="mt-2 max-h-[clamp(360px,58vh,760px)] space-y-2 overflow-auto pr-1">
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
                            {{ project.fileCount }} files
                        </p>
                        <p class="mt-1 text-slate-500">{{ project.running ? "running" : "idle" }}</p>
                    </button>
                    <p
                        v-if="generatorProjects.length === 0"
                        class="text-xs text-slate-500"
                    >
                        No projects yet. Create one to start.
                    </p>
                </div>
            </div>

            <div class="space-y-3">
                <div
                    class="rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-xs text-slate-300"
                >
                    <p v-if="generatorProject">
                        Project: <code>{{ generatorProject.projectId }}</code><br />
                        Path: <code>{{ generatorProject.projectDir }}</code><br />
                        Updated: <code>{{ formatTime(generatorProject.updatedAt) }}</code><br />
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

                <div class="grid gap-3 xl:grid-cols-[minmax(260px,0.9fr)_minmax(420px,1.8fr)]">
                    <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                        <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Files
                        </p>
                        <div class="mt-2 max-h-[clamp(320px,50vh,700px)] space-y-1 overflow-auto pr-1">
                            <button
                                v-for="row in generatorTreeRows"
                                :key="`generator-entry-${row.node.path}`"
                                type="button"
                                class="w-full rounded-md border px-2 py-1.5 text-left text-xs transition"
                                :class="
                                    row.node.type === 'directory'
                                        ? 'border-slate-700/80 bg-slate-900/40 text-slate-400'
                                        : row.node.path === generatorFilePath
                                          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                                          : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'
                                "
                                @click="
                                    row.node.type === 'directory'
                                        ? toggleDirectory(row.node.path)
                                        : handleFileOpen(row.node.path)
                                "
                            >
                                <span
                                    class="inline-block"
                                    :style="{ paddingLeft: `${row.depth * 12}px` }"
                                >
                                    <span v-if="row.node.type === 'directory'">
                                        {{ row.hasChildren ? (row.expanded ? "[-]" : "[+]") : "[ ]" }}
                                        {{ row.node.name }}
                                    </span>
                                    <span v-else>
                                        [F] {{ row.node.name }}
                                    </span>
                                </span>
                            </button>
                            <p
                                v-if="generatorTreeRows.length === 0"
                                class="text-xs text-slate-500"
                            >
                                Select a project to browse files.
                            </p>
                        </div>
                    </div>

                    <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                        <div class="flex items-center justify-between gap-2">
                            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                File Content
                            </p>
                            <span class="text-xs text-slate-500">
                                {{ generatorFileLoading ? "Loading..." : generatorFilePath || "-" }}
                            </span>
                        </div>
                        <pre class="mt-2 max-h-[clamp(320px,50vh,700px)] overflow-auto whitespace-pre-wrap text-xs text-slate-200">{{
                            generatorFileContent || "Select a file to view its content."
                        }}</pre>
                        <p
                            v-if="generatorFileTruncated"
                            class="mt-2 text-xs text-amber-300"
                        >
                            File content is truncated due to size limit.
                        </p>
                    </div>
                </div>

            </div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-700 bg-slate-950/80 p-3">
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
                        Start Claude
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
                class="mt-2 h-[clamp(360px,48vh,700px)] overflow-hidden rounded-md border border-slate-700 bg-slate-950"
            />
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
