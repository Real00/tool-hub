// Provides backup/restore flows and a restore lock used by lazy-loaded stores.
function createConfigRestoreController(options = {}) {
  const app = options.app;
  const dialog = options.dialog;
  const fs = options.fs;
  const path = options.path;
  const spawn = options.spawn;
  const getMainWindow =
    typeof options.getMainWindow === "function"
      ? options.getMainWindow
      : () => null;
  const getAppsManager = options.getAppsManager;
  const getSettingsStore = options.getSettingsStore;
  const closeQuickLauncherWindow =
    typeof options.closeQuickLauncherWindow === "function"
      ? options.closeQuickLauncherWindow
      : () => {};
  const closeAllAppWindows =
    typeof options.closeAllAppWindows === "function"
      ? options.closeAllAppWindows
      : () => {};

  let isConfigRestoreInProgress = false;

  // Guard reads/writes from modules that are unsafe during live restore.
  function assertRestoreAccessAllowed(allowOptions = {}) {
    if (allowOptions.allowDuringRestore === true) {
      return;
    }
    if (isConfigRestoreInProgress) {
      throw new Error(
        "Configuration restore is in progress. Please retry after restore completes.",
      );
    }
  }

  function isRestoreInProgress() {
    return isConfigRestoreInProgress;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function buildBackupTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hour = pad2(date.getHours());
    const minute = pad2(date.getMinutes());
    const second = pad2(date.getSeconds());
    return `${year}${month}${day}-${hour}${minute}${second}`;
  }

  function resolveUniquePath(basePath) {
    let resolvedPath = basePath;
    let suffix = 2;
    while (fs.existsSync(resolvedPath)) {
      resolvedPath = `${basePath}-${suffix}`;
      suffix += 1;
    }
    return resolvedPath;
  }

  function isPathInside(parentPath, targetPath) {
    const relative = path.relative(parentPath, targetPath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  function ensureZipExtension(filePathInput) {
    if (/\.zip$/i.test(filePathInput)) {
      return filePathInput;
    }
    return `${filePathInput}.zip`;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function escapePowerShellSingleQuoted(value) {
    return String(value).replace(/'/g, "''");
  }

  function runPowerShellWithExecutable(executable, script) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          script,
        ],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        reject(new Error(`PowerShell command timed out (${executable}).`));
      }, 300000);
      child.stdout.on("data", () => {
        // Drain stdout to avoid pipe backpressure causing hangs.
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `PowerShell command failed (${executable}, code=${code}): ${stderr.trim() || "unknown error"}`,
          ),
        );
      });
    });
  }

  async function runPowerShell(script) {
    // Prefer pwsh, fallback to Windows PowerShell for older environments.
    const executables =
      process.platform === "win32"
        ? ["pwsh.exe", "pwsh", "powershell.exe", "powershell"]
        : ["pwsh", "powershell"];
    let lastError = null;

    for (const executable of executables) {
      try {
        await runPowerShellWithExecutable(executable, script);
        return;
      } catch (error) {
        if (error?.code === "ENOENT") {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ??
      new Error("No PowerShell executable found to process zip archive.")
    );
  }

  async function compressDirectoryToZip(sourceDir, archivePath) {
    const escapedSource = escapePowerShellSingleQuoted(path.resolve(sourceDir));
    const escapedArchive = escapePowerShellSingleQuoted(path.resolve(archivePath));
    const script =
      `$ErrorActionPreference = 'Stop'; ` +
      `Compress-Archive -Path '${escapedSource}\\*' -DestinationPath '${escapedArchive}' -CompressionLevel Optimal -Force`;
    await runPowerShell(script);
  }

  async function expandZipArchive(archivePath, destinationDir) {
    const escapedArchive = escapePowerShellSingleQuoted(path.resolve(archivePath));
    const escapedDestination = escapePowerShellSingleQuoted(
      path.resolve(destinationDir),
    );
    const script =
      `$ErrorActionPreference = 'Stop'; ` +
      `Expand-Archive -Path '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`;
    await runPowerShell(script);
  }

  async function removePathIfExists(targetPath) {
    const maxAttempts = 10;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await fs.promises.rm(targetPath, {
          recursive: true,
          force: true,
          maxRetries: 4,
          retryDelay: 120,
        });
        return;
      } catch (error) {
        const code = String(error?.code ?? "");
        // Windows file handles can linger briefly; retry common transient codes.
        const retryable =
          code === "ENOTEMPTY" ||
          code === "EPERM" ||
          code === "EBUSY" ||
          code === "EACCES";
        if (!retryable || attempt === maxAttempts) {
          throw error;
        }
        lastError = error;
        await sleep(attempt * 180);
      }
    }
    if (lastError) {
      throw lastError;
    }
  }

  function copyDirectoryIfExists(sourceDir, destinationDir, includedPaths) {
    if (!fs.existsSync(sourceDir)) {
      return;
    }
    const stat = fs.statSync(sourceDir);
    if (!stat.isDirectory()) {
      return;
    }
    fs.cpSync(sourceDir, destinationDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    includedPaths.push(destinationDir);
  }

  function copyFileIfExists(sourceFile, destinationFile, includedPaths) {
    if (!fs.existsSync(sourceFile)) {
      return false;
    }
    const stat = fs.statSync(sourceFile);
    if (!stat.isFile()) {
      return false;
    }
    fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
    fs.copyFileSync(sourceFile, destinationFile);
    includedPaths.push(destinationFile);
    return true;
  }

  function copySqliteBundleIfExists(sourceDbPath, targetDir, includedPaths) {
    const dbName = path.basename(sourceDbPath);
    const targetDbPath = path.join(targetDir, dbName);
    const copiedMainDb = copyFileIfExists(
      sourceDbPath,
      targetDbPath,
      includedPaths,
    );
    if (!copiedMainDb) {
      return;
    }

    copyFileIfExists(
      `${sourceDbPath}-wal`,
      path.join(targetDir, `${dbName}-wal`),
      includedPaths,
    );
    copyFileIfExists(
      `${sourceDbPath}-shm`,
      path.join(targetDir, `${dbName}-shm`),
      includedPaths,
    );
  }

  function createBackupSnapshot(snapshotDir) {
    const appsRoot = getAppsManager().resolveAppsRoot();
    const toolHubRoot = path.resolve(path.dirname(appsRoot));
    const settingsDbPath = path.resolve(getSettingsStore().resolveDatabasePath());
    const includedPaths = [];

    fs.mkdirSync(snapshotDir, { recursive: true });
    copyDirectoryIfExists(
      toolHubRoot,
      path.join(snapshotDir, path.basename(toolHubRoot)),
      includedPaths,
    );
    copySqliteBundleIfExists(
      settingsDbPath,
      path.join(snapshotDir, "settings-db"),
      includedPaths,
    );

    const metadataPath = path.join(snapshotDir, "backup-metadata.json");
    fs.writeFileSync(
      metadataPath,
      `${JSON.stringify(
        {
          formatVersion: 2,
          type: "zip-archive",
          createdAt: new Date().toISOString(),
          source: {
            toolHubRoot,
            settingsDbPath,
          },
          includedPaths,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    includedPaths.push(metadataPath);

    return {
      includedPaths,
    };
  }

  async function backupConfigurationData() {
    assertRestoreAccessAllowed();
    const defaultArchiveName = `tool-hub-backup-${buildBackupTimestamp()}.zip`;
    const suggestedDir = app.getPath("documents");
    const pickerResult = await dialog.showSaveDialog(getMainWindow() ?? undefined, {
      title: "保存备份压缩包",
      defaultPath: path.join(suggestedDir, defaultArchiveName),
      buttonLabel: "保存备份",
      filters: [{ name: "Zip Archive", extensions: ["zip"] }],
    });

    if (pickerResult.canceled || !pickerResult.filePath) {
      return {
        canceled: true,
        archivePath: null,
        includedPaths: [],
      };
    }

    const archivePath = ensureZipExtension(path.resolve(pickerResult.filePath));
    const appsRoot = getAppsManager().resolveAppsRoot();
    const toolHubRoot = path.resolve(path.dirname(appsRoot));
    if (isPathInside(toolHubRoot, archivePath)) {
      throw new Error("Backup archive cannot be saved inside .tool-hub directory.");
    }

    const tempRoot = resolveUniquePath(
      path.join(app.getPath("temp"), `tool-hub-backup-${Date.now().toString(36)}`),
    );
    const snapshotDir = path.join(tempRoot, "snapshot");
    let includedPaths = [];

    try {
      const snapshot = createBackupSnapshot(snapshotDir);
      includedPaths = snapshot.includedPaths;
      await removePathIfExists(archivePath);
      await compressDirectoryToZip(snapshotDir, archivePath);
    } finally {
      await removePathIfExists(tempRoot);
    }

    return {
      canceled: false,
      archivePath,
      includedPaths,
    };
  }

  async function closeStoresForRestore() {
    const appsManager = getAppsManager();
    if (typeof appsManager.closeAppsManager === "function") {
      await appsManager.closeAppsManager();
    }

    const settingsStore = getSettingsStore();
    if (typeof settingsStore.closeSettingsStore === "function") {
      await settingsStore.closeSettingsStore();
    }
  }

  async function restoreConfigurationFromArchive() {
    if (isConfigRestoreInProgress) {
      throw new Error("Another configuration restore is already in progress.");
    }

    const pickerResult = await dialog.showOpenDialog(getMainWindow() ?? undefined, {
      title: "选择备份压缩包",
      properties: ["openFile", "dontAddToRecent"],
      filters: [{ name: "Zip Archive", extensions: ["zip"] }],
    });

    if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
      return {
        canceled: true,
        restored: false,
        archivePath: null,
        restoredPaths: [],
        restartRecommended: false,
      };
    }

    const archivePath = path.resolve(pickerResult.filePaths[0]);
    const tempRoot = resolveUniquePath(
      path.join(
        app.getPath("temp"),
        `tool-hub-restore-${Date.now().toString(36)}`,
      ),
    );
    const extractDir = path.join(tempRoot, "extract");
    const restoredPaths = [];
    isConfigRestoreInProgress = true;

    try {
      fs.mkdirSync(extractDir, { recursive: true });
      await expandZipArchive(archivePath, extractDir);

      const extractedToolHubRoot = path.join(extractDir, ".tool-hub");
      if (
        !fs.existsSync(extractedToolHubRoot) ||
        !fs.statSync(extractedToolHubRoot).isDirectory()
      ) {
        throw new Error(
          "Invalid backup archive: missing .tool-hub directory in archive root.",
        );
      }

      // Shutdown app-owned windows/stores before replacing on-disk state.
      closeQuickLauncherWindow();
      closeAllAppWindows();
      await closeStoresForRestore();
      await sleep(350);

      const appsManager = getAppsManager();
      const settingsStore = getSettingsStore();
      const liveToolHubRoot = path.resolve(path.dirname(appsManager.resolveAppsRoot()));
      const liveSettingsDbPath = path.resolve(settingsStore.resolveDatabasePath());
      const liveSettingsDbName = path.basename(liveSettingsDbPath);

      await removePathIfExists(liveToolHubRoot);
      fs.mkdirSync(path.dirname(liveToolHubRoot), { recursive: true });
      fs.cpSync(extractedToolHubRoot, liveToolHubRoot, {
        recursive: true,
        force: true,
      });
      restoredPaths.push(liveToolHubRoot);

      const extractedSettingsDbDir = path.join(extractDir, "settings-db");
      const extractedSettingsDbPath = path.join(
        extractedSettingsDbDir,
        liveSettingsDbName,
      );
      if (fs.existsSync(extractedSettingsDbPath)) {
        await removePathIfExists(liveSettingsDbPath);
        await removePathIfExists(`${liveSettingsDbPath}-wal`);
        await removePathIfExists(`${liveSettingsDbPath}-shm`);
        copyFileIfExists(extractedSettingsDbPath, liveSettingsDbPath, restoredPaths);
        copyFileIfExists(
          path.join(extractedSettingsDbDir, `${liveSettingsDbName}-wal`),
          `${liveSettingsDbPath}-wal`,
          restoredPaths,
        );
        copyFileIfExists(
          path.join(extractedSettingsDbDir, `${liveSettingsDbName}-shm`),
          `${liveSettingsDbPath}-shm`,
          restoredPaths,
        );
      }

      await Promise.allSettled([
        appsManager.initializeAppsManager(),
        settingsStore.initializeSettingsStore(),
      ]);

      return {
        canceled: false,
        restored: true,
        archivePath,
        restoredPaths,
        restartRecommended: true,
      };
    } finally {
      try {
        await removePathIfExists(tempRoot);
      } finally {
        isConfigRestoreInProgress = false;
      }
    }
  }

  return {
    assertRestoreAccessAllowed,
    isRestoreInProgress,
    backupConfigurationData,
    restoreConfigurationFromArchive,
  };
}

module.exports = {
  createConfigRestoreController,
};
