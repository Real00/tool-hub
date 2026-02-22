// Manages per-app BrowserWindow instances and app-runtime permission checks.
function createAppRuntimeWindowsController(options = {}) {
  const BrowserWindow = options.BrowserWindow;
  const Notification = options.Notification;
  const dialog = options.dialog;
  const fs = options.fs;
  const path = options.path;
  const electronRootDir = options.electronRootDir
    ? path.resolve(String(options.electronRootDir))
    : path.join(__dirname, "..");
  const getAppsManager = options.getAppsManager;
  const getMainWindow =
    typeof options.getMainWindow === "function"
      ? options.getMainWindow
      : () => null;
  const getAppIcon =
    typeof options.getAppIcon === "function" ? options.getAppIcon : () => null;
  const stripWindowMenu =
    typeof options.stripWindowMenu === "function"
      ? options.stripWindowMenu
      : () => {};
  const attachWindowKeyboardShortcuts =
    typeof options.attachWindowKeyboardShortcuts === "function"
      ? options.attachWindowKeyboardShortcuts
      : () => {};
  const appName = String(options.appName || "Tool Hub");
  const launchContextChannel = String(
    options.launchContextChannel || "app-runtime:launch-context",
  );

  const CONTEXT_DISPATCH_SOURCE_EXPLORER = "explorer-context-menu";
  const CONTEXT_TARGET_KINDS = new Set(["file", "folder", "unknown"]);
  const NOTIFICATION_MAX_TEXT_LENGTH = 200;
  const APP_RUNTIME_PICK_DIRECTORY_DEFAULT_TITLE = "Select directory";
  const APP_RUNTIME_PICK_DIRECTORY_DEFAULT_MAX_ENTRIES = 2000;
  const APP_RUNTIME_PICK_DIRECTORY_MAX_ENTRIES_LIMIT = 20000;
  const APP_RUNTIME_PICK_DIRECTORY_DEFAULT_MAX_DEPTH = 6;
  const APP_RUNTIME_PICK_DIRECTORY_MAX_DEPTH_LIMIT = 32;

  const appWindows = new Map();
  // Keyed by webContents id to validate runtime IPC calls from app windows only.
  const runtimeWindowStateByWebContentsId = new Map();

  function createContextDispatchRequestId(prefix = "ctx") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeCapabilityId(input) {
    return String(input ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeLaunchPayload(input) {
    if (input === undefined || input === null) {
      return { provided: input !== undefined, value: null };
    }
    const text = String(input).trim();
    return {
      provided: true,
      value: text ? text : null,
    };
  }

  function normalizeLaunchContextSource(input, fallback = "manual") {
    const normalized = String(input ?? "")
      .trim()
      .toLowerCase();
    if (
      normalized === CONTEXT_DISPATCH_SOURCE_EXPLORER ||
      normalized === "quick-launcher" ||
      normalized === "manual"
    ) {
      return normalized;
    }
    const normalizedFallback = String(fallback ?? "manual")
      .trim()
      .toLowerCase();
    if (
      normalizedFallback === CONTEXT_DISPATCH_SOURCE_EXPLORER ||
      normalizedFallback === "quick-launcher" ||
      normalizedFallback === "manual"
    ) {
      return normalizedFallback;
    }
    return "manual";
  }

  function normalizeLaunchContextTargetKind(input) {
    const normalized = String(input ?? "")
      .trim()
      .toLowerCase();
    if (!CONTEXT_TARGET_KINDS.has(normalized)) {
      return "unknown";
    }
    return normalized;
  }

  function normalizeLaunchContextTargets(input) {
    if (!Array.isArray(input)) {
      return [];
    }
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
      const text = String(sourcePath ?? "").trim();
      if (!text || text.includes("\0")) {
        continue;
      }
      const absolutePath = path.resolve(text);
      const uniqueKey =
        process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
      if (seen.has(uniqueKey)) {
        continue;
      }
      seen.add(uniqueKey);
      targets.push({
        path: absolutePath,
        kind: normalizeLaunchContextTargetKind(item?.kind),
      });
    }
    return targets;
  }

  function normalizeLaunchContextCapabilityTargets(input) {
    if (!Array.isArray(input)) {
      return [];
    }
    const seen = new Set();
    const targets = [];
    for (let i = 0; i < input.length; i += 1) {
      const normalized = String(input[i] ?? "")
        .trim()
        .toLowerCase();
      if (
        (normalized === "file" ||
          normalized === "folder" ||
          normalized === "any") &&
        !seen.has(normalized)
      ) {
        seen.add(normalized);
        targets.push(normalized);
      }
    }
    return targets;
  }

  function normalizeLaunchContext(input) {
    if (input === undefined) {
      return { provided: false, value: null };
    }
    if (input === null) {
      return { provided: true, value: null };
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { provided: true, value: null };
    }

    const source = normalizeLaunchContextSource(input.source, "manual");
    const requestedAtRaw = Number(input.requestedAt);
    const requestedAt = Number.isFinite(requestedAtRaw) && requestedAtRaw > 0
      ? Math.floor(requestedAtRaw)
      : Date.now();
    const requestId =
      String(input.requestId ?? "").trim() ||
      createContextDispatchRequestId("launch");
    const payload = normalizeLaunchPayload(input.payload);

    const capabilityInput =
      input.capability && typeof input.capability === "object"
        ? input.capability
        : null;
    const capabilityId = normalizeCapabilityId(capabilityInput?.id);
    const capabilityName = String(capabilityInput?.name ?? "").trim();
    const capabilityTargets = normalizeLaunchContextCapabilityTargets(
      capabilityInput?.targets,
    );
    const targets = normalizeLaunchContextTargets(input.targets);
    const value = {
      source,
      requestId,
      requestedAt,
    };
    if (payload.value) {
      value.payload = payload.value;
    }
    if (capabilityId) {
      value.capability = {
        id: capabilityId,
        name: capabilityName || capabilityId,
        targets: capabilityTargets,
      };
    }
    if (targets.length > 0) {
      value.targets = targets;
    }

    return {
      provided: true,
      value,
    };
  }

  function cloneLaunchContext(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return null;
    }

    const source = normalizeLaunchContextSource(input.source, "manual");
    const requestId =
      String(input.requestId ?? "").trim() ||
      createContextDispatchRequestId("launch");
    const requestedAtRaw = Number(input.requestedAt);
    const requestedAt = Number.isFinite(requestedAtRaw) && requestedAtRaw > 0
      ? Math.floor(requestedAtRaw)
      : Date.now();
    const payload = normalizeLaunchPayload(input.payload);
    const output = {
      source,
      requestId,
      requestedAt,
    };
    if (payload.value) {
      output.payload = payload.value;
    }

    const capabilityInput =
      input.capability && typeof input.capability === "object"
        ? input.capability
        : null;
    const capabilityId = normalizeCapabilityId(capabilityInput?.id);
    if (capabilityId) {
      output.capability = {
        id: capabilityId,
        name: String(capabilityInput?.name ?? "").trim() || capabilityId,
        targets: normalizeLaunchContextCapabilityTargets(capabilityInput?.targets),
      };
    }

    const targets = normalizeLaunchContextTargets(input.targets);
    if (targets.length > 0) {
      output.targets = targets;
    }

    return output;
  }

  function normalizeOpenAppWindowInput(input) {
    if (
      input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.prototype.hasOwnProperty.call(input, "launchContext")
    ) {
      return input.launchContext;
    }
    return input;
  }

  function getRuntimeStateByWebContents(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      return null;
    }
    return runtimeWindowStateByWebContentsId.get(webContents.id) ?? null;
  }

  function emitRuntimeLaunchContextUpdate(webContents, state) {
    if (!webContents || webContents.isDestroyed()) {
      return;
    }
    webContents.send(launchContextChannel, {
      launchContext: cloneLaunchContext(state.launchContext),
      launchContextUpdatedAt: state.launchContextUpdatedAt,
    });
  }

  function setRuntimeWindowLaunchState(win, appId, openInput, emitUpdate = false) {
    if (!win || win.isDestroyed()) {
      return;
    }

    const launchContextInput = normalizeOpenAppWindowInput(openInput);
    const webContents = win.webContents;
    const webContentsId = webContents.id;
    const previous = runtimeWindowStateByWebContentsId.get(webContentsId) ?? null;
    const normalizedContext = normalizeLaunchContext(launchContextInput);
    const next = previous
      ? { ...previous }
      : {
          appId,
          launchContext: null,
          launchContextUpdatedAt: Date.now(),
        };

    // Existing context is preserved unless caller explicitly provided launchContext.
    next.appId = appId;
    if (normalizedContext.provided || !previous) {
      next.launchContext = cloneLaunchContext(normalizedContext.value);
      next.launchContextUpdatedAt = Date.now();
    }

    runtimeWindowStateByWebContentsId.set(webContentsId, next);

    if (emitUpdate && normalizedContext.provided) {
      emitRuntimeLaunchContextUpdate(webContents, next);
    }
  }

  async function openAppWindowById(appId, openInput) {
    const existing = appWindows.get(appId);
    if (existing && !existing.isDestroyed()) {
      setRuntimeWindowLaunchState(existing, appId, openInput, true);
      if (existing.isMinimized()) {
        existing.restore();
      }
      existing.show();
      existing.focus();
      return true;
    }

    const appInfo = await getAppsManager().getAppById(appId);
    if (!appInfo) {
      throw new Error(`App not found: ${appId}`);
    }
    if (!appInfo.uiUrl) {
      throw new Error("App has no uiPath/uiUrl configured.");
    }

    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 900,
      minHeight: 560,
      backgroundColor: "#020617",
      icon: getAppIcon(),
      title: `${appInfo.name} - Tool Hub`,
      webPreferences: {
        preload: path.join(electronRootDir, "app-preload-bridge.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    appWindows.set(appId, win);
    setRuntimeWindowLaunchState(win, appId, openInput, false);
    stripWindowMenu(win);
    attachWindowKeyboardShortcuts(win);
    const webContentsId = win.webContents.id;
    win.on("closed", () => {
      appWindows.delete(appId);
      runtimeWindowStateByWebContentsId.delete(webContentsId);
    });
    win.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        if (level >= 2) {
          console.warn(
            `[app-window:${appId}] console(${level}) ${sourceId}:${line} ${message}`,
          );
        }
      },
    );
    win.webContents.on(
      "did-fail-load",
      (_event, code, description, validatedUrl) => {
        console.error(
          `[app-window:${appId}] did-fail-load code=${code} url=${validatedUrl} ${description}`,
        );
      },
    );
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error(
        `[app-window:${appId}] render-process-gone reason=${details?.reason ?? "unknown"} exitCode=${details?.exitCode ?? "unknown"}`,
      );
    });
    void win.loadURL(appInfo.uiUrl);
    return true;
  }

  function closeAppWindowById(appId) {
    const win = appWindows.get(appId);
    if (!win || win.isDestroyed()) {
      appWindows.delete(appId);
      return;
    }
    runtimeWindowStateByWebContentsId.delete(win.webContents.id);
    win.close();
    appWindows.delete(appId);
  }

  function closeAllAppWindows() {
    for (const [appId, win] of appWindows.entries()) {
      if (!win || win.isDestroyed()) {
        appWindows.delete(appId);
        continue;
      }
      runtimeWindowStateByWebContentsId.delete(win.webContents.id);
      win.close();
      appWindows.delete(appId);
    }
  }

  function getRuntimeAppIdByWebContents(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      return null;
    }
    const webContentsId = webContents.id;
    const runtimeState = runtimeWindowStateByWebContentsId.get(webContentsId);
    if (runtimeState?.appId) {
      return runtimeState.appId;
    }
    for (const [appId, win] of appWindows.entries()) {
      if (!win || win.isDestroyed()) {
        continue;
      }
      if (win.webContents.id === webContentsId) {
        return appId;
      }
    }
    return null;
  }

  function requireRuntimeAppId(event) {
    // Treat missing mapping as an authorization failure for runtime IPC.
    const appId = getRuntimeAppIdByWebContents(event.sender);
    if (!appId) {
      throw new Error("Unauthorized app runtime request.");
    }
    return appId;
  }

  function normalizeIntegerInRange(input, fallback, min, max) {
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(numeric)));
  }

  function normalizeRuntimeDirectoryPickerOptions(input) {
    const value = input && typeof input === "object" ? input : {};
    const titleText = String(value.title ?? "").trim();
    return {
      title: titleText || APP_RUNTIME_PICK_DIRECTORY_DEFAULT_TITLE,
      includeEntries: value.includeEntries === true,
      includeHidden: value.includeHidden === true,
      maxEntries: normalizeIntegerInRange(
        value.maxEntries,
        APP_RUNTIME_PICK_DIRECTORY_DEFAULT_MAX_ENTRIES,
        1,
        APP_RUNTIME_PICK_DIRECTORY_MAX_ENTRIES_LIMIT,
      ),
      maxDepth: normalizeIntegerInRange(
        value.maxDepth,
        APP_RUNTIME_PICK_DIRECTORY_DEFAULT_MAX_DEPTH,
        0,
        APP_RUNTIME_PICK_DIRECTORY_MAX_DEPTH_LIMIT,
      ),
    };
  }

  function shouldSkipHiddenEntry(entryName, includeHidden) {
    if (includeHidden) {
      return false;
    }
    return entryName.startsWith(".");
  }

  async function collectRuntimeDirectoryEntries(rootPath, optionsInput) {
    const entries = [];
    let truncated = false;
    const options = normalizeRuntimeDirectoryPickerOptions(optionsInput);

    // Traversal is bounded by maxEntries/maxDepth to prevent large directory explosions.
    async function visitDirectory(absolutePath, relativePathPrefix, depth) {
      if (truncated) {
        return;
      }

      let dirEntries = [];
      try {
        dirEntries = await fs.promises.readdir(absolutePath, {
          withFileTypes: true,
        });
      } catch {
        return;
      }

      dirEntries.sort((a, b) => a.name.localeCompare(b.name));

      for (let i = 0; i < dirEntries.length; i += 1) {
        if (truncated) {
          break;
        }

        const dirEntry = dirEntries[i];
        const entryName = String(dirEntry?.name ?? "");
        if (!entryName || entryName === "." || entryName === "..") {
          continue;
        }
        if (shouldSkipHiddenEntry(entryName, options.includeHidden)) {
          continue;
        }

        const currentAbsolutePath = path.join(absolutePath, entryName);
        const relativePath = relativePathPrefix
          ? `${relativePathPrefix}/${entryName}`
          : entryName;

        if (dirEntry.isDirectory()) {
          entries.push({
            relativePath,
            kind: "folder",
          });
          if (entries.length >= options.maxEntries) {
            truncated = true;
            break;
          }
          if (depth < options.maxDepth) {
            await visitDirectory(currentAbsolutePath, relativePath, depth + 1);
          }
          continue;
        }

        if (dirEntry.isFile()) {
          const item = {
            relativePath,
            kind: "file",
          };
          try {
            const stat = await fs.promises.stat(currentAbsolutePath);
            if (stat.isFile()) {
              item.size = stat.size;
            }
          } catch {
            // Ignore stat errors and return entry without size.
          }
          entries.push(item);
          if (entries.length >= options.maxEntries) {
            truncated = true;
            break;
          }
          continue;
        }

        if (!dirEntry.isSymbolicLink()) {
          continue;
        }

        let stat = null;
        try {
          stat = await fs.promises.stat(currentAbsolutePath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          entries.push({
            relativePath,
            kind: "folder",
          });
          if (entries.length >= options.maxEntries) {
            truncated = true;
            break;
          }
          continue;
        }
        if (stat.isFile()) {
          entries.push({
            relativePath,
            kind: "file",
            size: stat.size,
          });
          if (entries.length >= options.maxEntries) {
            truncated = true;
            break;
          }
        }
      }
    }

    await visitDirectory(rootPath, "", 0);
    return {
      entries,
      truncated,
    };
  }

  async function pickRuntimeDirectory(webContents, optionsInput) {
    const optionsInputValue = normalizeRuntimeDirectoryPickerOptions(optionsInput);
    const ownerWindow =
      BrowserWindow.fromWebContents(webContents) || getMainWindow() || undefined;
    const pickerResult = await dialog.showOpenDialog(ownerWindow, {
      title: optionsInputValue.title,
      properties: ["openDirectory", "dontAddToRecent"],
    });
    if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
      return null;
    }
    const selectedPath = path.resolve(pickerResult.filePaths[0]);
    if (!optionsInputValue.includeEntries) {
      return {
        path: selectedPath,
      };
    }
    const scanResult = await collectRuntimeDirectoryEntries(
      selectedPath,
      optionsInputValue,
    );
    return {
      path: selectedPath,
      entries: scanResult.entries,
      truncated: scanResult.truncated,
    };
  }

  function trimNotificationText(input, fallback = "", allowEmpty = false) {
    const text = String(input ?? "").trim();
    if (!text) {
      const fallbackText = String(fallback ?? "").trim();
      if (!fallbackText && allowEmpty) {
        return "";
      }
      return fallbackText || appName;
    }
    if (text.length <= NOTIFICATION_MAX_TEXT_LENGTH) {
      return text;
    }
    return `${text.slice(0, NOTIFICATION_MAX_TEXT_LENGTH - 1)}…`;
  }

  function showSystemNotification(titleInput, bodyInput, optionsInput = {}) {
    try {
      if (typeof Notification !== "function") {
        return false;
      }
      if (
        typeof Notification.isSupported === "function" &&
        !Notification.isSupported()
      ) {
        return false;
      }
      const title = trimNotificationText(titleInput, appName);
      const body = trimNotificationText(bodyInput, "", true);
      const notification = new Notification({
        title,
        body,
        silent: optionsInput.silent === true,
        icon: getAppIcon() || undefined,
      });
      notification.show();
      return true;
    } catch {
      return false;
    }
  }

  function getRuntimeInfo(event) {
    const appId = requireRuntimeAppId(event);
    const runtimeState = getRuntimeStateByWebContents(event.sender);
    return {
      appId,
      launchContext: cloneLaunchContext(runtimeState?.launchContext ?? null),
      launchContextUpdatedAt: runtimeState?.launchContextUpdatedAt ?? null,
    };
  }

  async function notify(event, titleInput, bodyInput, optionsInput) {
    const appId = requireRuntimeAppId(event);
    const appInfo = await getAppsManager().getAppById(appId);
    const title = trimNotificationText(titleInput, appInfo?.name || appName);
    const body = trimNotificationText(bodyInput, "", true);
    if (!body) {
      throw new Error("Notification body is required.");
    }
    showSystemNotification(title, body, {
      silent: optionsInput?.silent === true,
    });
    return true;
  }

  async function pickDirectoryForEvent(event, optionsInput) {
    requireRuntimeAppId(event);
    return pickRuntimeDirectory(event.sender, optionsInput);
  }

  return {
    openAppWindowById,
    closeAppWindowById,
    closeAllAppWindows,
    requireRuntimeAppId,
    getRuntimeInfo,
    notify,
    pickDirectoryForEvent,
    showSystemNotification,
  };
}

module.exports = {
  createAppRuntimeWindowsController,
};
