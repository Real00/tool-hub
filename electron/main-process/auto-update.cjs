// Encapsulates the electron-updater lifecycle and exposes a small
// command-style API for main-process IPC handlers.
function createAutoUpdateController(options = {}) {
  const app = options.app;
  const isDev = options.isDev === true;
  const eventChannel = String(options.eventChannel || "update:state");
  const startupDelayMs = Number.isFinite(Number(options.startupDelayMs))
    ? Math.max(0, Math.floor(Number(options.startupDelayMs)))
    : 15000;
  const onBeforeInstall =
    typeof options.onBeforeInstall === "function"
      ? options.onBeforeInstall
      : () => {};

  let autoUpdaterInstance = null;
  let autoUpdaterLoadAttempted = false;
  let autoUpdateInitialized = false;
  let autoUpdateCheckInFlight = false;
  let autoUpdateDownloadInFlight = false;
  let startupTimer = null;
  const subscribers = new Set();

  function buildInitialAutoUpdateState() {
    if (process.platform !== "win32") {
      return {
        status: "disabled",
        currentVersion: app.getVersion(),
        availableVersion: null,
        downloadedVersion: null,
        releaseName: null,
        releaseDate: null,
        releaseNotes: null,
        lastCheckedAt: null,
        downloadedAt: null,
        progress: null,
        message: "Automatic updates are enabled for Windows builds only.",
      };
    }
    if (isDev) {
      return {
        status: "disabled",
        currentVersion: app.getVersion(),
        availableVersion: null,
        downloadedVersion: null,
        releaseName: null,
        releaseDate: null,
        releaseNotes: null,
        lastCheckedAt: null,
        downloadedAt: null,
        progress: null,
        message: "Automatic updates are disabled in development mode.",
      };
    }
    return {
      status: "idle",
      currentVersion: app.getVersion(),
      availableVersion: null,
      downloadedVersion: null,
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      lastCheckedAt: null,
      downloadedAt: null,
      progress: null,
      message: "Waiting for update check.",
    };
  }

  let autoUpdateState = buildInitialAutoUpdateState();

  function getAutoUpdater() {
    if (autoUpdaterLoadAttempted) {
      return autoUpdaterInstance;
    }
    autoUpdaterLoadAttempted = true;

    if (process.platform !== "win32" || isDev) {
      autoUpdaterInstance = null;
      return autoUpdaterInstance;
    }

    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdaterInstance = autoUpdater;
      return autoUpdaterInstance;
    } catch (error) {
      autoUpdaterInstance = null;
      console.warn(
        "electron-updater is unavailable. Update checks will be disabled.",
        error,
      );
      return autoUpdaterInstance;
    }
  }

  function formatUpdateError(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return String(error);
  }

  function normalizeReleaseNotes(value) {
    if (!value) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      const notes = value
        .map((item) => {
          if (typeof item === "string") {
            return item.trim();
          }
          if (item && typeof item.note === "string") {
            return item.note.trim();
          }
          return "";
        })
        .filter(Boolean);
      return notes.length > 0 ? notes.join("\n\n") : null;
    }
    return null;
  }

  function formatReleaseDate(value) {
    if (!value) {
      return null;
    }
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    return new Date(timestamp).toISOString();
  }

  function cloneState() {
    return {
      ...autoUpdateState,
      progress: autoUpdateState.progress ? { ...autoUpdateState.progress } : null,
    };
  }

  function emitState() {
    const payload = cloneState();
    for (const webContents of subscribers) {
      if (!webContents || webContents.isDestroyed()) {
        subscribers.delete(webContents);
        continue;
      }
      webContents.send(eventChannel, payload);
    }
  }

  function patchState(partial) {
    autoUpdateState = {
      ...autoUpdateState,
      ...partial,
      currentVersion: app.getVersion(),
    };
    emitState();
  }

  function ensureDisabledState(message) {
    patchState({
      status: "disabled",
      message,
      progress: null,
    });
    return cloneState();
  }

  async function checkForUpdates(trigger = "manual") {
    const updater = getAutoUpdater();
    if (!updater) {
      if (process.platform !== "win32") {
        return ensureDisabledState(
          "Automatic updates are enabled for Windows builds only.",
        );
      }
      if (isDev) {
        return ensureDisabledState(
          "Automatic updates are disabled in development mode.",
        );
      }
      return ensureDisabledState(
        "electron-updater is unavailable in current runtime.",
      );
    }

    // Keep update checks single-flight to avoid interleaving state writes
    // from repeated manual clicks / startup timers.
    if (autoUpdateCheckInFlight) {
      return cloneState();
    }
    autoUpdateCheckInFlight = true;
    if (trigger === "manual") {
      patchState({
        status: "checking",
        message: "Checking for updates...",
        lastCheckedAt: new Date().toISOString(),
        progress: null,
      });
    }

    try {
      await updater.checkForUpdates();
    } catch (error) {
      patchState({
        status: "error",
        message: `Update check failed: ${formatUpdateError(error)}`,
        progress: null,
      });
    } finally {
      autoUpdateCheckInFlight = false;
    }

    return cloneState();
  }

  async function downloadUpdate() {
    const updater = getAutoUpdater();
    if (!updater) {
      return ensureDisabledState(
        "Automatic updates are unavailable in current runtime.",
      );
    }
    // Download is also single-flight because progress events mutate shared state.
    if (autoUpdateState.status === "downloaded") {
      return cloneState();
    }
    if (autoUpdateDownloadInFlight) {
      return cloneState();
    }

    autoUpdateDownloadInFlight = true;
    patchState({
      status: "downloading",
      message: "Downloading update package...",
      progress: null,
    });

    try {
      await updater.downloadUpdate();
    } catch (error) {
      patchState({
        status: "error",
        message: `Update download failed: ${formatUpdateError(error)}`,
        progress: null,
      });
    } finally {
      autoUpdateDownloadInFlight = false;
    }

    return cloneState();
  }

  function installAndRestart() {
    const updater = getAutoUpdater();
    if (!updater || autoUpdateState.status !== "downloaded") {
      return false;
    }
    onBeforeInstall();
    setImmediate(() => {
      updater.quitAndInstall(false, true);
    });
    return true;
  }

  function initialize() {
    if (autoUpdateInitialized) {
      return;
    }
    autoUpdateInitialized = true;

    const updater = getAutoUpdater();
    if (!updater) {
      ensureDisabledState(
        process.platform !== "win32"
          ? "Automatic updates are enabled for Windows builds only."
          : isDev
            ? "Automatic updates are disabled in development mode."
            : "electron-updater is unavailable in current runtime.",
      );
      return;
    }

    // All state transitions after this point are driven by updater events.
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;

    updater.on("checking-for-update", () => {
      patchState({
        status: "checking",
        message: "Checking for updates...",
        lastCheckedAt: new Date().toISOString(),
        progress: null,
      });
    });

    updater.on("update-available", (info) => {
      const nextVersion =
        info && typeof info.version === "string" ? info.version : null;
      patchState({
        status: "available",
        availableVersion: nextVersion,
        downloadedVersion: null,
        downloadedAt: null,
        releaseName:
          info && typeof info.releaseName === "string" ? info.releaseName : null,
        releaseDate: formatReleaseDate(info?.releaseDate),
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
        message: nextVersion
          ? `Update ${nextVersion} available. Downloading in background...`
          : "Update available. Downloading in background...",
        progress: null,
      });
    });

    updater.on("update-not-available", () => {
      patchState({
        status: "up-to-date",
        availableVersion: null,
        downloadedVersion: null,
        downloadedAt: null,
        releaseName: null,
        releaseDate: null,
        releaseNotes: null,
        message: "You are already on the latest version.",
        progress: null,
      });
    });

    updater.on("download-progress", (progress) => {
      const nextProgress = {
        percent: Number(progress?.percent ?? 0),
        transferred: Number(progress?.transferred ?? 0),
        total: Number(progress?.total ?? 0),
        bytesPerSecond: Number(progress?.bytesPerSecond ?? 0),
      };
      patchState({
        status: "downloading",
        message: `Downloading update: ${nextProgress.percent.toFixed(1)}%`,
        progress: nextProgress,
      });
    });

    updater.on("update-downloaded", (info) => {
      const nextVersion =
        info && typeof info.version === "string" ? info.version : null;
      patchState({
        status: "downloaded",
        availableVersion: nextVersion,
        downloadedVersion: nextVersion,
        downloadedAt: new Date().toISOString(),
        releaseName:
          info && typeof info.releaseName === "string" ? info.releaseName : null,
        releaseDate: formatReleaseDate(info?.releaseDate),
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
        message: nextVersion
          ? `Update ${nextVersion} downloaded. Restart to install.`
          : "Update downloaded. Restart to install.",
        progress: null,
      });
    });

    updater.on("error", (error) => {
      autoUpdateCheckInFlight = false;
      autoUpdateDownloadInFlight = false;
      patchState({
        status: "error",
        message: `Updater error: ${formatUpdateError(error)}`,
        progress: null,
      });
    });
  }

  function scheduleStartupCheck() {
    // Startup checks are debounced by replacing any previous timer.
    cancelStartupCheck();
    startupTimer = setTimeout(() => {
      startupTimer = null;
      void checkForUpdates("startup");
    }, startupDelayMs);
  }

  function cancelStartupCheck() {
    if (!startupTimer) {
      return;
    }
    clearTimeout(startupTimer);
    startupTimer = null;
  }

  function subscribe(webContents) {
    subscribers.add(webContents);
    webContents.once("destroyed", () => {
      subscribers.delete(webContents);
    });
    webContents.send(eventChannel, cloneState());
  }

  function unsubscribe(webContents) {
    subscribers.delete(webContents);
  }

  function dispose() {
    cancelStartupCheck();
    subscribers.clear();
  }

  return {
    initialize,
    checkForUpdates,
    downloadUpdate,
    installAndRestart,
    getState: cloneState,
    subscribe,
    unsubscribe,
    scheduleStartupCheck,
    cancelStartupCheck,
    dispose,
  };
}

module.exports = {
  createAutoUpdateController,
};
