// Handles Explorer/CLI context target aggregation and capability dispatch.
function createContextDispatchController(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const appName = String(options.appName || "Tool Hub");
  const requestChannel = String(
    options.requestChannel || "context-dispatch:request",
  );
  const sourceExplorer = String(
    options.sourceExplorer || "explorer-context-menu",
  );
  const aggregateWindowMs = Number.isFinite(Number(options.aggregateWindowMs))
    ? Math.max(0, Math.floor(Number(options.aggregateWindowMs)))
    : 650;
  const maxQueue = Number.isFinite(Number(options.maxQueue))
    ? Math.max(1, Math.floor(Number(options.maxQueue)))
    : 32;
  const pendingTtlMs = Number.isFinite(Number(options.pendingTtlMs))
    ? Math.max(500, Math.floor(Number(options.pendingTtlMs)))
    : 5000;
  const collectContextTargetsFromArgv =
    typeof options.collectContextTargetsFromArgv === "function"
      ? options.collectContextTargetsFromArgv
      : () => [];
  const getAppsManager = options.getAppsManager;
  const openAppWindowById =
    typeof options.openAppWindowById === "function"
      ? options.openAppWindowById
      : async () => true;
  const showSystemNotification =
    typeof options.showSystemNotification === "function"
      ? options.showSystemNotification
      : () => false;

  const contextTargetKinds = new Set(["file", "folder", "unknown"]);
  const capabilityTargetKinds = new Set(["file", "folder", "any"]);
  const pendingTargetsByKey = new Map();
  const pendingRequests = [];
  let pendingTimer = null;
  let rendererProvider = () => null;

  // Renderer dependency is injected to keep this module independent of window code.
  function setRendererProvider(provider) {
    rendererProvider = typeof provider === "function" ? provider : () => null;
  }

  function normalizeCapabilityId(input) {
    return String(input ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeCapabilityTargets(input) {
    if (!Array.isArray(input)) {
      return [];
    }
    const seen = new Set();
    const targets = [];
    for (let i = 0; i < input.length; i += 1) {
      const normalized = String(input[i] ?? "")
        .trim()
        .toLowerCase();
      if (capabilityTargetKinds.has(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        targets.push(normalized);
      }
    }
    return targets;
  }

  function normalizeLaunchContextTargetKind(input) {
    const normalized = String(input ?? "")
      .trim()
      .toLowerCase();
    if (!contextTargetKinds.has(normalized)) {
      return "unknown";
    }
    return normalized;
  }

  function normalizeDispatchSource(input) {
    const source = String(input ?? "").trim();
    return source || sourceExplorer;
  }

  function normalizeDispatchTargetPath(input) {
    let text = String(input ?? "").trim();
    for (let i = 0; i < 3; i += 1) {
      if (text.length < 2) {
        break;
      }
      const first = text[0];
      const last = text[text.length - 1];
      if (
        (first === "\"" && last === "\"") ||
        (first === "'" && last === "'")
      ) {
        text = text.slice(1, -1).trim();
        continue;
      }
      break;
    }
    if (!text) {
      return "";
    }
    if (text.includes("\0")) {
      return "";
    }
    if (text.startsWith("-")) {
      return "";
    }
    if (!path.isAbsolute(text)) {
      return "";
    }
    return path.resolve(text);
  }

  async function detectDispatchTargetKind(absolutePath) {
    try {
      const stat = await fs.promises.stat(absolutePath);
      if (stat.isFile()) {
        return "file";
      }
      if (stat.isDirectory()) {
        return "folder";
      }
    } catch {
      // Ignore stat errors and fallback to unknown.
    }
    return "unknown";
  }

  async function normalizeDispatchTargets(input) {
    if (!Array.isArray(input)) {
      throw new Error("Dispatch targets are required.");
    }
    // Deduplicate paths so one filesystem target maps to one launch target.
    const seen = new Set();
    const targets = [];
    for (let i = 0; i < input.length; i += 1) {
      const item = input[i];
      const sourcePath =
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? item.path
            : "";
      const absolutePath = normalizeDispatchTargetPath(sourcePath);
      if (!absolutePath) {
        continue;
      }
      const key =
        process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const detectedKind = await detectDispatchTargetKind(absolutePath);
      const fallbackKind =
        item && typeof item === "object"
          ? normalizeLaunchContextTargetKind(item.kind)
          : "unknown";
      const kind = detectedKind !== "unknown" ? detectedKind : fallbackKind;
      targets.push({
        path: absolutePath,
        kind: normalizeLaunchContextTargetKind(kind),
      });
    }
    if (targets.length === 0) {
      throw new Error("No valid dispatch targets were provided.");
    }
    return targets;
  }

  function createContextDispatchRequestId(prefix = "ctx") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getAppCapabilityById(appInfo, capabilityIdInput) {
    const capabilityId = normalizeCapabilityId(capabilityIdInput);
    if (!capabilityId) {
      return null;
    }
    const capabilities = Array.isArray(appInfo?.capabilities)
      ? appInfo.capabilities
      : [];
    for (let i = 0; i < capabilities.length; i += 1) {
      const item = capabilities[i];
      if (!item || typeof item !== "object") {
        continue;
      }
      if (normalizeCapabilityId(item.id) !== capabilityId) {
        continue;
      }
      const targets = normalizeCapabilityTargets(item.targets);
      if (targets.length === 0) {
        continue;
      }
      return {
        id: capabilityId,
        name: String(item.name ?? capabilityId).trim() || capabilityId,
        description: String(item.description ?? "").trim() || null,
        targets,
      };
    }
    return null;
  }

  function capabilitySupportsTargets(capability, targets) {
    if (!capability || !Array.isArray(capability.targets)) {
      return false;
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      return false;
    }
    if (capability.targets.includes("any")) {
      return true;
    }
    return (
      targets.every((item) => item.kind === "file" || item.kind === "folder") &&
      targets.every((item) => capability.targets.includes(item.kind))
    );
  }

  async function dispatchCapabilitySelection(input) {
    const payload = input && typeof input === "object" ? input : {};
    const appId = normalizeCapabilityId(payload.appId);
    const capabilityId = normalizeCapabilityId(payload.capabilityId);
    if (!appId) {
      throw new Error("Invalid app id.");
    }
    if (!capabilityId) {
      throw new Error("Invalid capability id.");
    }

    const appInfo = await getAppsManager().getAppById(appId);
    if (!appInfo) {
      throw new Error(`App not found: ${appId}`);
    }
    const capability = getAppCapabilityById(appInfo, capabilityId);
    if (!capability) {
      throw new Error(`Capability not found: ${capabilityId}`);
    }

    // Validate capability/target compatibility before starting app window.
    const targets = await normalizeDispatchTargets(payload.targets);
    if (!capabilitySupportsTargets(capability, targets)) {
      throw new Error("Capability targets do not match selected file/folder targets.");
    }

    const requestedAtRaw = Number(payload.requestedAt);
    const requestedAt = Number.isFinite(requestedAtRaw) && requestedAtRaw > 0
      ? Math.floor(requestedAtRaw)
      : Date.now();
    const requestId =
      String(payload.requestId ?? "").trim() ||
      createContextDispatchRequestId("dispatch");
    const source = normalizeDispatchSource(payload.source);
    const launchContext = {
      source,
      requestId,
      requestedAt,
      capability: {
        id: capability.id,
        name: capability.name,
        targets: [...capability.targets],
      },
      targets: targets.map((item) => ({
        path: item.path,
        kind: item.kind,
      })),
    };

    await getAppsManager().startApp(appId);
    await openAppWindowById(appId, launchContext);

    const targetCount = targets.length;
    const targetLabel = targetCount === 1 ? "target" : "targets";
    showSystemNotification(
      appName,
      `Dispatched ${appInfo.name} / ${capability.name} (${targetCount} ${targetLabel}).`,
    );

    return {
      ok: true,
      appId,
      capabilityId: capability.id,
      requestId,
      targetCount,
    };
  }

  function resolveRendererWebContents() {
    const target = rendererProvider();
    if (!target) {
      return null;
    }
    if (target.webContents) {
      return target.webContents;
    }
    return target;
  }

  function canSendContextDispatchRequests() {
    const webContents = resolveRendererWebContents();
    if (!webContents || webContents.isDestroyed()) {
      return false;
    }
    return !webContents.isLoadingMainFrame();
  }

  function toContextDispatchEventPayload(entry) {
    return {
      requestId: String(entry?.requestId ?? ""),
      requestedAt: Number(entry?.requestedAt ?? Date.now()),
      source: String(entry?.source ?? sourceExplorer),
      targets: Array.isArray(entry?.targets)
        ? entry.targets.map((target) => ({
            path: String(target?.path ?? ""),
            kind: normalizeLaunchContextTargetKind(target?.kind),
          }))
        : [],
    };
  }

  function pruneContextDispatchQueue(now = Date.now()) {
    // Keep sent entries for a short TTL so late renderer consumers can still read them.
    for (let i = pendingRequests.length - 1; i >= 0; i -= 1) {
      const entry = pendingRequests[i];
      const sentAt = Number(entry?.__sentAt ?? 0);
      if (!sentAt) {
        continue;
      }
      if (now - sentAt > pendingTtlMs) {
        pendingRequests.splice(i, 1);
      }
    }
  }

  function flushPendingToRenderer() {
    pruneContextDispatchQueue();
    if (!canSendContextDispatchRequests()) {
      return;
    }
    const webContents = resolveRendererWebContents();
    if (!webContents || webContents.isDestroyed()) {
      return;
    }
    const sentAt = Date.now();
    for (let i = 0; i < pendingRequests.length; i += 1) {
      const entry = pendingRequests[i];
      if (!entry) {
        continue;
      }
      webContents.send(requestChannel, toContextDispatchEventPayload(entry));
      if (!entry.__sentAt) {
        entry.__sentAt = sentAt;
      }
    }
  }

  function enqueueContextDispatchRequest(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    pendingRequests.push({
      ...toContextDispatchEventPayload(payload),
      __sentAt: null,
    });
    pruneContextDispatchQueue();
    if (pendingRequests.length > maxQueue) {
      pendingRequests.splice(0, pendingRequests.length - maxQueue);
    }
    flushPendingToRenderer();
  }

  function queueContextDispatchTargets(pathsInput) {
    if (!Array.isArray(pathsInput)) {
      return;
    }
    for (let i = 0; i < pathsInput.length; i += 1) {
      const absolutePath = normalizeDispatchTargetPath(pathsInput[i]);
      if (!absolutePath) {
        continue;
      }
      const key =
        process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
      pendingTargetsByKey.set(key, absolutePath);
    }
    // Small aggregation window merges rapid argv/context-menu inputs into one dispatch batch.
    if (pendingTargetsByKey.size === 0) {
      return;
    }
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void flushPendingContextDispatchTargets();
    }, aggregateWindowMs);
  }

  async function flushPendingContextDispatchTargets() {
    const rawTargets = Array.from(pendingTargetsByKey.values());
    pendingTargetsByKey.clear();
    if (rawTargets.length === 0) {
      return;
    }

    let targets = [];
    try {
      targets = await normalizeDispatchTargets(rawTargets);
    } catch (error) {
      console.warn(
        "Failed to normalize context dispatch targets:",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (targets.length === 0) {
      return;
    }

    enqueueContextDispatchRequest({
      requestId: createContextDispatchRequestId("ctxmenu"),
      requestedAt: Date.now(),
      source: sourceExplorer,
      targets,
    });
  }

  function queueTargetsFromArgv(argv) {
    let targets = [];
    try {
      targets = collectContextTargetsFromArgv(argv);
    } catch (error) {
      console.warn(
        "Failed to parse context dispatch argv:",
        error instanceof Error ? error.message : String(error),
      );
      targets = [];
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      return 0;
    }
    queueContextDispatchTargets(targets);
    return targets.length;
  }

  function consumePending() {
    pruneContextDispatchQueue();
    const snapshot = pendingRequests.map((item) =>
      toContextDispatchEventPayload(item),
    );
    pendingRequests.length = 0;
    return snapshot;
  }

  function dispose() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingTargetsByKey.clear();
    pendingRequests.length = 0;
  }

  return {
    setRendererProvider,
    queueTargetsFromArgv,
    flushPendingToRenderer,
    consumePending,
    dispatchCapabilitySelection,
    dispose,
  };
}

module.exports = {
  createContextDispatchController,
};
