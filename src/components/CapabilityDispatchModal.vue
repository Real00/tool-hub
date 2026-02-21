<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { dispatchAppCapability } from "../platform/electron-bridge";
import type {
  AppCapability,
  ContextDispatchRequest,
  DispatchTarget,
  InstalledApp,
} from "../types/app";

type RequestTargetMode = "file" | "folder" | "mixed" | "unknown";

interface DispatchCandidate {
  key: string;
  appId: string;
  appName: string;
  capabilityId: string;
  capabilityName: string;
  capabilityDescription: string | null;
  matchPriority: number;
}

const props = defineProps<{
  open: boolean;
  request: ContextDispatchRequest | null;
  installedApps: InstalledApp[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const selectedCandidateKey = ref("");
const submitStatus = ref<"idle" | "submitting" | "error" | "success">("idle");
const submitMessage = ref("");

function detectTargetMode(targets: DispatchTarget[]): RequestTargetMode {
  let hasFile = false;
  let hasFolder = false;
  let hasUnknown = false;
  for (let i = 0; i < targets.length; i += 1) {
    const kind = targets[i]?.kind;
    if (kind === "file") {
      hasFile = true;
    } else if (kind === "folder") {
      hasFolder = true;
    } else {
      hasUnknown = true;
    }
  }
  if (hasUnknown) {
    return "unknown";
  }
  if (hasFile && hasFolder) {
    return "mixed";
  }
  if (hasFile) {
    return "file";
  }
  if (hasFolder) {
    return "folder";
  }
  return "unknown";
}

function capabilityMatchesTargetMode(
  capability: AppCapability,
  mode: RequestTargetMode,
): boolean {
  const targets = Array.isArray(capability.targets) ? capability.targets : [];
  if (targets.includes("any")) {
    return true;
  }
  if (mode === "file") {
    return targets.includes("file");
  }
  if (mode === "folder") {
    return targets.includes("folder");
  }
  return false;
}

function getCapabilityMatchPriority(
  capability: AppCapability,
  mode: RequestTargetMode,
): number {
  const targets = Array.isArray(capability.targets) ? capability.targets : [];
  const hasAny = targets.includes("any");
  const hasFile = targets.includes("file");
  const hasFolder = targets.includes("folder");

  if (mode === "file") {
    if (hasFile && !hasAny) {
      return 0;
    }
    if (hasAny) {
      return 1;
    }
    return 9;
  }

  if (mode === "folder") {
    if (hasFolder && !hasAny) {
      return 0;
    }
    if (hasAny) {
      return 1;
    }
    return 9;
  }

  if (mode === "mixed" || mode === "unknown") {
    return hasAny ? 0 : 9;
  }

  return 9;
}

const requestTargetMode = computed<RequestTargetMode>(() => {
  const request = props.request;
  if (!request) {
    return "unknown";
  }
  return detectTargetMode(request.targets);
});

const dispatchCandidates = computed<DispatchCandidate[]>(() => {
  const request = props.request;
  if (!request || request.targets.length === 0) {
    return [];
  }

  const mode = requestTargetMode.value;
  const output: DispatchCandidate[] = [];
  for (let i = 0; i < props.installedApps.length; i += 1) {
    const app = props.installedApps[i];
    const capabilities = Array.isArray(app.capabilities) ? app.capabilities : [];
    for (let j = 0; j < capabilities.length; j += 1) {
      const capability = capabilities[j];
      if (!capabilityMatchesTargetMode(capability, mode)) {
        continue;
      }
      output.push({
        key: `${app.id}:${capability.id}`,
        appId: app.id,
        appName: app.name,
        capabilityId: capability.id,
        capabilityName: capability.name,
        capabilityDescription: capability.description,
        matchPriority: getCapabilityMatchPriority(capability, mode),
      });
    }
  }
  output.sort((a, b) => {
    if (a.matchPriority !== b.matchPriority) {
      return a.matchPriority - b.matchPriority;
    }
    if (a.appName !== b.appName) {
      return a.appName.localeCompare(b.appName);
    }
    return a.capabilityName.localeCompare(b.capabilityName);
  });
  return output;
});

const selectedCandidate = computed<DispatchCandidate | null>(() => {
  const key = selectedCandidateKey.value;
  if (!key) {
    return null;
  }
  return dispatchCandidates.value.find((item) => item.key === key) ?? null;
});

const targetSummary = computed(() => {
  const request = props.request;
  if (!request) {
    return "No targets";
  }
  const fileCount = request.targets.filter((item) => item.kind === "file").length;
  const folderCount = request.targets.filter((item) => item.kind === "folder").length;
  const unknownCount = request.targets.length - fileCount - folderCount;
  const parts: string[] = [];
  if (fileCount > 0) {
    parts.push(`${fileCount} file${fileCount > 1 ? "s" : ""}`);
  }
  if (folderCount > 0) {
    parts.push(`${folderCount} folder${folderCount > 1 ? "s" : ""}`);
  }
  if (unknownCount > 0) {
    parts.push(`${unknownCount} unknown`);
  }
  return parts.length > 0 ? parts.join(", ") : "No targets";
});

const emptyStateMessage = computed(() => {
  if (requestTargetMode.value === "mixed" || requestTargetMode.value === "unknown") {
    return "No capability matched these targets. Mixed/unknown targets require an `any` capability.";
  }
  return "No app capability matched these targets.";
});

watch(
  () => [props.open, props.request?.requestId, dispatchCandidates.value.length],
  () => {
    if (!props.open) {
      selectedCandidateKey.value = "";
      submitStatus.value = "idle";
      submitMessage.value = "";
      return;
    }
    const firstCandidate = dispatchCandidates.value[0];
    selectedCandidateKey.value = firstCandidate?.key ?? "";
    submitStatus.value = "idle";
    submitMessage.value = "";
  },
  { immediate: true },
);

function closeModal() {
  if (submitStatus.value === "submitting") {
    return;
  }
  emit("close");
}

async function handleDispatch() {
  const request = props.request;
  const candidate = selectedCandidate.value;
  if (!request || !candidate) {
    submitStatus.value = "error";
    submitMessage.value = "Please select a valid app capability.";
    return;
  }
  submitStatus.value = "submitting";
  submitMessage.value = "";
  try {
    const plainTargets = request.targets.map((target) => ({
      path: String(target.path ?? ""),
      kind:
        target.kind === "file" || target.kind === "folder" || target.kind === "unknown"
          ? target.kind
          : "unknown",
    }));
    await dispatchAppCapability({
      appId: candidate.appId,
      capabilityId: candidate.capabilityId,
      targets: plainTargets,
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      source: request.source,
    });
    submitStatus.value = "success";
    submitMessage.value = `Dispatched to ${candidate.appName} / ${candidate.capabilityName}.`;
    emit("close");
  } catch (error) {
    submitStatus.value = "error";
    submitMessage.value = error instanceof Error ? error.message : String(error);
  }
}
</script>

<template>
  <div
    v-if="open && request"
    class="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/70 px-4 pt-[12vh] backdrop-blur-sm"
    @click.self="closeModal"
  >
    <section class="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-950/95 shadow-2xl">
      <header class="border-b border-slate-800 px-5 py-4">
        <p class="text-sm font-semibold text-slate-100">
          Context Dispatch
        </p>
        <p class="mt-1 text-xs text-slate-400">
          Source: <code>{{ request.source }}</code> · {{ targetSummary }}
        </p>
      </header>

      <div class="grid gap-4 px-5 py-4 md:grid-cols-[1.2fr_1fr]">
        <section class="space-y-2">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-300">
            Targets
          </p>
          <div class="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <p
              v-for="target in request.targets"
              :key="target.path"
              class="rounded-md border border-slate-800 bg-slate-950/80 px-2 py-1 text-xs text-slate-300"
            >
              <span class="mr-2 inline-flex rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                {{ target.kind }}
              </span>
              <code class="break-all">{{ target.path }}</code>
            </p>
          </div>
        </section>

        <section class="space-y-3">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-300">
            App Capability
          </p>

          <template v-if="dispatchCandidates.length > 0">
            <select
              v-model="selectedCandidateKey"
              class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-500/40 focus:ring"
            >
              <option
                v-for="candidate in dispatchCandidates"
                :key="candidate.key"
                :value="candidate.key"
              >
                {{ candidate.appName }} / {{ candidate.capabilityName }}
              </option>
            </select>
            <p
              v-if="selectedCandidate?.capabilityDescription"
              class="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300"
            >
              {{ selectedCandidate.capabilityDescription }}
            </p>
          </template>
          <p
            v-else
            class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
          >
            {{ emptyStateMessage }}
          </p>

          <p
            v-if="submitMessage"
            class="rounded-lg px-3 py-2 text-xs"
            :class="
              submitStatus === 'error'
                ? 'border border-rose-500/40 bg-rose-500/10 text-rose-100'
                : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
            "
          >
            {{ submitMessage }}
          </p>

          <div class="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
              :disabled="submitStatus === 'submitting'"
              @click="closeModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-md bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="submitStatus === 'submitting' || !selectedCandidate"
              @click="handleDispatch"
            >
              {{ submitStatus === "submitting" ? "Dispatching..." : "Dispatch" }}
            </button>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
