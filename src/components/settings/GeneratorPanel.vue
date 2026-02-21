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
    generatorValidationMessage,
    generatorValidationResult,
    generatorValidationStatus,
    generatorVerifyMessage,
    generatorVerifyResult,
    generatorVerifyStatus,
    generatorTerminal,
    generatorTerminalMessage,
    generatorTerminalStatus,
    installAppFromGeneratorProject,
    loadGeneratorProjects,
    loadGeneratorSettingsFromStorage,
    loadGeneratorTerminalState,
    openGeneratorProjectFile,
    runGeneratorProjectValidation,
    runGeneratorProjectVerifyCheck,
    resizeEmbeddedTerminal,
    saveClaudePathConfig,
    selectGeneratorProject,
    sendEmbeddedTerminalData,
    startEmbeddedTerminal,
    stopEmbeddedTerminal,
    tabs,
    verifyCommand,
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
const showCliConfig = ref(false);
const showProjectMetaDetails = ref(false);
const showValidationDetails = ref(false);
const showVerifyDetails = ref(false);

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

const hasSelectedProject = computed(() => Boolean(generatorProjectId.value));
const isGeneratorLoading = computed(() => generatorStatus.value === "loading");
const isTerminalLoading = computed(() => generatorTerminalStatus.value === "loading");
const selectedProjectSummary = computed(() => {
    if (generatorProjectId.value) {
        const matched = generatorProjects.value.find(
            (item) => item.projectId === generatorProjectId.value,
        );
        if (matched) {
            return matched;
        }
    }
    return generatorProject.value;
});
const terminalRunningClass = computed(() =>
    generatorTerminal.value.running
        ? "bg-emerald-500/20 text-emerald-200"
        : "bg-slate-800 text-slate-300",
);
const generatorStatusClass = computed(() => {
    return generatorStatus.value === "success"
        ? "bg-emerald-500/20 text-emerald-200"
        : generatorStatus.value === "error"
          ? "bg-rose-500/20 text-rose-200"
          : generatorStatus.value === "loading"
            ? "bg-amber-500/20 text-amber-200"
            : "bg-slate-800 text-slate-300";
});
const validationStatusClass = computed(() => {
    return generatorValidationStatus.value === "success"
        ? "bg-emerald-500/20 text-emerald-200"
        : generatorValidationStatus.value === "error"
          ? "bg-rose-500/20 text-rose-200"
          : generatorValidationStatus.value === "loading"
            ? "bg-amber-500/20 text-amber-200"
            : "bg-slate-800 text-slate-300";
});
const verifyStatusClass = computed(() => {
    return generatorVerifyStatus.value === "success"
        ? "bg-emerald-500/20 text-emerald-200"
        : generatorVerifyStatus.value === "error"
          ? "bg-rose-500/20 text-rose-200"
          : generatorVerifyStatus.value === "loading"
            ? "bg-amber-500/20 text-amber-200"
            : "bg-slate-800 text-slate-300";
});
const terminalStatusClass = computed(() => {
    return generatorTerminalStatus.value === "success"
        ? "bg-emerald-500/20 text-emerald-200"
        : generatorTerminalStatus.value === "error"
          ? "bg-rose-500/20 text-rose-200"
          : generatorTerminalStatus.value === "loading"
            ? "bg-amber-500/20 text-amber-200"
            : "bg-slate-800 text-slate-300";
});
const manifestSummary = computed(() => {
    if (!selectedProjectSummary.value || !selectedProjectSummary.value.hasManifest) {
        return "missing app.json";
    }
    return `${selectedProjectSummary.value.appId ?? "-"} (${selectedProjectSummary.value.version ?? "-"})`;
});
const validationSummary = computed(() => {
    if (!generatorValidationResult.value) {
        return "No validation report yet.";
    }
    const errors = generatorValidationResult.value.errors.length;
    const warnings = generatorValidationResult.value.warnings.length;
    if (errors > 0) {
        return `${errors} error(s), ${warnings} warning(s).`;
    }
    if (warnings > 0) {
        return `No errors, ${warnings} warning(s).`;
    }
    return "No blocking validation issues.";
});
const verifySummary = computed(() => {
    if (!generatorVerifyResult.value) {
        return "No verify result yet.";
    }
    return `Exit ${generatorVerifyResult.value.exitCode ?? "-"} in ${generatorVerifyResult.value.durationMs}ms.`;
});

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
        showProjectMetaDetails.value = false;
        showValidationDetails.value = false;
        showVerifyDetails.value = false;
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
    <section class="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 shadow-soft md:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
                <p class="text-sm font-medium text-slate-100">
                    AI app generator (Claude CLI)
                </p>
                <p class="mt-1 text-sm text-slate-400">
                    Select a project, edit files through Claude CLI, then install to a target tab.
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <span
                    v-if="selectedProjectSummary"
                    class="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300"
                >
                    {{ selectedProjectSummary.projectId }}
                </span>
                <span
                    class="rounded-md px-2 py-1 text-xs"
                    :class="generatorStatusClass"
                >
                    {{ generatorStatus }}
                </span>
                <button
                    type="button"
                    class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="isGeneratorLoading"
                    @click="reloadGeneratorPanel"
                >
                    Reload
                </button>
            </div>
        </div>

        <div class="mt-4 grid gap-3 xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,2.1fr)] xl:items-stretch">
            <aside class="space-y-3">
                <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3 xl:flex xl:h-[clamp(300px,34vh,420px)] xl:flex-col">
                    <div class="flex items-center justify-between gap-2">
                        <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Projects
                        </p>
                        <span class="text-[11px] text-slate-500">
                            {{ generatorProjects.length }} total
                        </span>
                    </div>
                    <div class="no-scrollbar mt-2 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
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

                <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                    <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Project Actions
                    </p>
                    <label class="mt-2 block text-[11px] text-slate-500">
                        Target Tab
                    </label>
                    <select
                        v-model="generatorTabId"
                        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 focus:ring"
                    >
                        <option
                            v-for="tab in tabs"
                            :key="`generator-tab-${tab.id}`"
                            :value="tab.id"
                        >
                            {{ tab.label }} ({{ tab.id }})
                        </option>
                    </select>
                    <label class="mt-2 block text-[11px] text-slate-500">
                        New Project Name
                    </label>
                    <input
                        v-model="generatorProjectName"
                        type="text"
                        placeholder="Optional project name"
                        class="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
                    />
                    <div class="mt-2 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                            :disabled="isGeneratorLoading"
                            @click="createNewGeneratorProject"
                        >
                            Create Project
                        </button>
                        <button
                            type="button"
                            class="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                            :disabled="!hasSelectedProject || isGeneratorLoading"
                            @click="installAppFromGeneratorProject"
                        >
                            Install App
                        </button>
                    </div>
                    <div class="mt-2 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                            :disabled="!hasSelectedProject || isGeneratorLoading"
                            @click="runGeneratorProjectValidation"
                        >
                            Validate
                        </button>
                        <button
                            type="button"
                            class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                            :disabled="!hasSelectedProject || isGeneratorLoading"
                            @click="runGeneratorProjectVerifyCheck"
                        >
                            Run Verify
                        </button>
                    </div>
                </div>

                <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                    <button
                        type="button"
                        class="flex w-full items-center justify-between gap-2 text-left"
                        @click="showCliConfig = !showCliConfig"
                    >
                        <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Claude CLI
                        </p>
                        <span class="text-[11px] text-slate-500">
                            {{ showCliConfig ? "Hide" : "Show" }}
                        </span>
                    </button>
                    <div v-if="showCliConfig" class="mt-3">
                        <input
                            v-model="claudeCliPath"
                            type="text"
                            placeholder="Claude CLI path or command (e.g. claude, C:\\Tools\\claude.exe)"
                            class="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
                        />
                        <label class="mt-2 block text-[11px] text-slate-500">
                            Verify Command
                        </label>
                        <input
                            v-model="verifyCommand"
                            type="text"
                            placeholder="node --check src/index.js"
                            class="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/50 placeholder:text-slate-500 focus:ring"
                        />
                        <div class="mt-2 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                class="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="isGeneratorLoading"
                                @click="autoDetectClaudePath"
                            >
                                Detect Path
                            </button>
                            <button
                                type="button"
                                class="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="isGeneratorLoading"
                                @click="saveClaudePathConfig"
                            >
                                Save Settings
                            </button>
                        </div>
                    </div>
                    <p v-else class="mt-2 text-xs text-slate-500">
                        CLI path and verify command are hidden by default to keep focus on generation and terminal.
                    </p>
                </div>
            </aside>

            <div class="min-w-0 space-y-3 xl:flex xl:flex-col">
                <div
                    class="rounded-xl border border-slate-700 bg-gradient-to-br from-slate-950/90 via-slate-900/75 to-slate-950/85 p-3"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Project Snapshot
                            </p>
                            <p class="mt-1 text-xs text-slate-500">
                                Keep essentials visible, expand details only when needed.
                            </p>
                        </div>
                        <button
                            type="button"
                            class="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                            :disabled="!selectedProjectSummary"
                            @click="showProjectMetaDetails = !showProjectMetaDetails"
                        >
                            {{ showProjectMetaDetails ? "Hide Details" : "Show Details" }}
                        </button>
                    </div>
                    <p v-if="!selectedProjectSummary" class="mt-2 text-xs text-slate-400">
                        Select or create a project.
                    </p>
                    <div v-else class="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span class="rounded-md bg-slate-800 px-2 py-1 text-slate-200">
                            Files {{ selectedProjectSummary.fileCount }}
                        </span>
                        <span
                            class="rounded-md px-2 py-1"
                            :class="
                                selectedProjectSummary.running
                                    ? 'bg-emerald-500/20 text-emerald-200'
                                    : 'bg-slate-800 text-slate-300'
                            "
                        >
                            {{ selectedProjectSummary.running ? "running" : "idle" }}
                        </span>
                        <span class="rounded-md bg-slate-800 px-2 py-1 text-slate-300">
                            Updated {{ formatTime(selectedProjectSummary.updatedAt) }}
                        </span>
                        <span class="rounded-md bg-slate-800 px-2 py-1 text-slate-300">
                            Manifest {{ manifestSummary }}
                        </span>
                    </div>
                    <div
                        v-if="showProjectMetaDetails && selectedProjectSummary"
                        class="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-xs text-slate-300"
                    >
                        <p>Project: <code>{{ selectedProjectSummary.projectId }}</code></p>
                        <p class="mt-1">Path: <code>{{ selectedProjectSummary.projectDir }}</code></p>
                        <p class="mt-1">
                            App:
                            <code>{{ selectedProjectSummary.appName ?? selectedProjectSummary.appId ?? "-" }}</code>
                        </p>
                        <p class="mt-1">Version: <code>{{ selectedProjectSummary.version ?? "-" }}</code></p>
                    </div>
                </div>

                <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                    <div class="grid gap-3 lg:grid-cols-2">
                        <div class="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                            <div class="flex items-center justify-between gap-2">
                                <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    Validation
                                </p>
                                <div class="flex items-center gap-2">
                                    <span
                                        class="rounded-md px-2 py-1 text-[11px]"
                                        :class="validationStatusClass"
                                    >
                                        {{ generatorValidationStatus }}
                                    </span>
                                    <button
                                        type="button"
                                        class="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                                        :disabled="!generatorValidationResult"
                                        @click="showValidationDetails = !showValidationDetails"
                                    >
                                        {{ showValidationDetails ? "Hide" : "Show" }}
                                    </button>
                                </div>
                            </div>
                            <p class="mt-1 text-[11px] text-slate-300">
                                {{ validationSummary }}
                            </p>
                            <p class="mt-1 text-[11px] text-slate-500">
                                {{ generatorValidationMessage }}
                            </p>
                            <div
                                v-if="showValidationDetails && generatorValidationResult"
                                class="mt-2 space-y-1 text-[11px] text-slate-300"
                            >
                                <p>
                                    Errors: {{ generatorValidationResult.errors.length }} · Warnings:
                                    {{ generatorValidationResult.warnings.length }} · Checks:
                                    {{ generatorValidationResult.checks.length }}
                                </p>
                                <p
                                    v-if="generatorValidationResult.errors.length > 0"
                                    class="text-rose-200"
                                >
                                    {{ generatorValidationResult.errors[0].message }}
                                </p>
                                <p
                                    v-else-if="generatorValidationResult.warnings.length > 0"
                                    class="text-amber-200"
                                >
                                    {{ generatorValidationResult.warnings[0].message }}
                                </p>
                                <p v-else class="text-emerald-200">
                                    No blocking validation issues.
                                </p>
                            </div>
                        </div>

                        <div class="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                            <div class="flex items-center justify-between gap-2">
                                <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    Verify
                                </p>
                                <div class="flex items-center gap-2">
                                    <span
                                        class="rounded-md px-2 py-1 text-[11px]"
                                        :class="verifyStatusClass"
                                    >
                                        {{ generatorVerifyStatus }}
                                    </span>
                                    <button
                                        type="button"
                                        class="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                                        :disabled="!generatorVerifyResult"
                                        @click="showVerifyDetails = !showVerifyDetails"
                                    >
                                        {{ showVerifyDetails ? "Hide" : "Show" }}
                                    </button>
                                </div>
                            </div>
                            <p class="mt-1 text-[11px] text-slate-300">
                                {{ verifySummary }}
                            </p>
                            <p class="mt-1 text-[11px] text-slate-500">
                                {{ generatorVerifyMessage }}
                            </p>
                            <div
                                v-if="showVerifyDetails && generatorVerifyResult"
                                class="mt-2 space-y-1 text-[11px] text-slate-300"
                            >
                                <p>
                                    Cmd: <code>{{ generatorVerifyResult.command }}</code>
                                </p>
                                <p>
                                    Exit: <code>{{ generatorVerifyResult.exitCode ?? "-" }}</code> ·
                                    Duration: <code>{{ generatorVerifyResult.durationMs }}ms</code>
                                </p>
                                <pre class="no-scrollbar max-h-28 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-400">{{
                                    generatorVerifyResult.output || "(no output)"
                                }}</pre>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Project Workspace
                        </p>
                        <span class="text-[11px] text-slate-500">
                            Tree + file content
                        </span>
                    </div>
                    <div class="mt-2 grid gap-3 lg:grid-cols-[minmax(240px,0.76fr)_minmax(0,2.24fr)]">
                        <div class="flex h-[clamp(320px,38vh,500px)] min-h-0 flex-col rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                            <p class="text-xs font-medium text-slate-300">Files</p>
                            <div class="no-scrollbar mt-2 min-h-0 flex-1 space-y-1 overflow-auto pr-1">
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

                        <div class="flex h-[clamp(320px,38vh,500px)] min-h-0 flex-col rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <p class="text-xs font-medium text-slate-300">
                                    File Content
                                </p>
                                <span class="text-xs text-slate-500">
                                    {{ generatorFileLoading ? "Loading..." : generatorFilePath || "-" }}
                                </span>
                            </div>
                            <pre class="no-scrollbar mt-2 min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-xs text-slate-200">{{
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
        </div>

        <div class="mt-4 rounded-2xl border border-slate-700 bg-slate-950/85 p-4 shadow-soft">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p class="text-sm font-medium text-slate-100">Embedded Terminal</p>
                    <p class="mt-1 text-[11px] text-slate-500">
                        Core workspace for Claude CLI session. Keep this area primary.
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <span
                        class="rounded-md px-2 py-1 text-[11px]"
                        :class="terminalRunningClass"
                    >
                        {{ generatorTerminal.running ? "running" : "stopped" }}
                    </span>
                    <button
                        type="button"
                        class="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!hasSelectedProject || isTerminalLoading"
                        @click="loadGeneratorTerminalState()"
                    >
                        Refresh
                    </button>
                    <button
                        v-if="!generatorTerminal.running"
                        type="button"
                        class="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!hasSelectedProject || isTerminalLoading"
                        @click="startEmbeddedTerminal"
                    >
                        Start Claude
                    </button>
                    <button
                        v-else
                        type="button"
                        class="rounded-md border border-rose-500/40 px-2 py-1 text-[11px] text-rose-200 transition hover:border-rose-400 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="isTerminalLoading"
                        @click="stopEmbeddedTerminal"
                    >
                        Stop
                    </button>
                </div>
            </div>
            <p class="mt-2 text-[11px] text-slate-500">
                {{ generatorTerminal.shellCommand || "-" }}
            </p>
            <div
                ref="terminalHost"
                class="mt-3 h-[clamp(420px,52vh,760px)] overflow-hidden rounded-md border border-slate-700 bg-slate-950"
            />
            <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                    class="rounded-md px-2 py-1"
                    :class="terminalStatusClass"
                >
                    {{ generatorTerminalStatus }}
                </span>
                <span class="text-slate-400">{{ generatorTerminalMessage }}</span>
            </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
            <span
                class="rounded-md px-2 py-1"
                :class="generatorStatusClass"
            >
                {{ generatorStatus }}
            </span>
            <span class="text-slate-300">{{ generatorMessage }}</span>
        </div>
    </section>
</template>
