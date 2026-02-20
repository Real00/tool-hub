# Tool Hub

桌面工具集应用，使用 Vue 3 + Tailwind CSS 构建。

## Start

```bash
pnpm install
pnpm dev
```

## 运行应用

开发模式：

```bash
pnpm install
pnpm electron:dev
```

- `pnpm electron:dev`: 开发模式，支持热重载。

## Build

```bash
pnpm build
```

## 运行构建后的应用

```bash
pnpm electron:start
```

- `pnpm electron:start`: 直接启动应用（快速启动）。
- `pnpm electron:start:build`: 先构建再启动。

## Define tabs in settings

Edit `src/config/settings.ts` and maintain:

- `defaultTabs`: fallback tab definitions (used when DB is empty/unavailable)
- `id`: unique, stable key
- `label`: text shown in the top tab bar

Example:

```ts
defaultTabs: [
  { id: "workspace", label: "Workspace" },
  { id: "projects", label: "Projects" },
];
```

## Edit settings in-app + local SQLite

- Open **Settings** in the top bar.
- Edit tab labels/ids and click **Save**.
- Use **Init DB** in settings tabs section to initialize/check settings DB schema.
- 在开发环境中，数据存储在 `data/settings.sqlite`。
- 在打包后的应用中，数据存储在用户数据目录。

## Node app runtime (fixed user directory)

- Apps root is fixed to: `%USERPROFILE%\\.tool-hub\\apps`
- Apps registry DB is: `%USERPROFILE%\\.tool-hub\\apps.sqlite`
- Drop an app folder into the apps root, or use **Select Dir** + choose **Target Tab** + **Install App** in Settings.
- Use **Init DB** in apps section to initialize/check apps DB and rescan app folders.
- Use **Remove** to uninstall an app (deletes app folder + DB records).
- Each app runs in an isolated Node process with its own cwd/env.
- Apps are grouped under top tabs by `apps.tab_id` in SQLite.
- 应用 UI 在独立窗口中打开（不嵌入主页面）。
- A runnable template is available at `templates/node-hello-app`.

### App UI host API

When an app UI window is opened by Tool Hub, the host injects `window.toolHubAppApi` in that window:

- `getRuntimeInfo()` -> returns `{ appId, launchPayload, launchPayloadUpdatedAt }`
- `subscribeLaunchPayload(callback)` -> receive payload updates while window is open
- `storage.get(key)`
- `storage.set(key, value)`
- `storage.delete(key)`
- `storage.list(prefix?)`
- `storage.clear()`
- `files.read(path, options?)`
- `files.write(path, content, options?)`
- `systemFiles.read(absPath, options?)`
- `systemFiles.write(absPath, content, options?)`

All storage entries are persisted in host SQLite and scoped by app id.
`files.*` paths are constrained inside the current app directory.
`systemFiles.*` supports absolute paths and may require elevated OS permissions for protected files.

## Generator (terminal-first)

- Generator page uses embedded terminal as the primary workflow.
- Start Claude CLI from **Start Claude** and drive file edits directly in terminal.
- Project summary no longer exposes chat-message metrics.
- Removed legacy chat IPC endpoint: `generator:chat-project`.

### `app.json` (minimum)

```json
{
  "id": "hello-app",
  "name": "Hello App",
  "version": "0.1.0",
  "entry": "src/index.js",
  "uiPath": "ui/index.html",
  "env": {
    "PORT": "4310"
  }
}
```

- `tab_id` (SQLite): category tab id defined in settings and chosen at install time
- `entry`: JavaScript entry relative to app folder (runs with `--run-as-node`)
- `uiPath` (optional): local UI file opened in a new window (`file://...`)
- `uiUrl` (optional): URL opened in a new window (`http://...`)

### Quick start from template (PowerShell)

```powershell
$src = "D:\code\tools\templates\node-hello-app"
$dst = "$env:USERPROFILE\Desktop\my-hello-app"
Copy-Item -Recurse -Force $src $dst
```

Then install `"$env:USERPROFILE\Desktop\my-hello-app"` from the Settings panel.

## Folder conventions

```txt
src/
  app/         # App shell and page composition
  components/  # Reusable UI components (PascalCase)
  config/      # Static config/registry files (kebab-case)
  platform/    # Runtime bridge and platform adapters (kebab-case)
  styles/      # Global styles
  types/       # Domain type definitions
```

## Naming rules

- Vue components use `PascalCase.vue` (example: `AppTopMenu.vue`)
- Non-component source files use `kebab-case` (example: `settings.ts`)
- 进程文件使用明确的角色命名（`main-process.cjs`、`preload-bridge.cjs`）

## 技术架构

- 前端桥接：`src/platform/electron-bridge.ts`
- SQLite 存储：`electron/settings-store.cjs`、`electron/apps-manager.cjs`
- IPC 处理器：`electron/main-process.cjs`、`electron/preload-bridge.cjs`
- API methods（renderer -> preload）:
  - `ping`
  - settings: `getSettingsTabs` `saveSettingsTabs` `initializeSettingsDatabase` `backupConfiguration` `restoreConfigurationFromArchive`
  - generator: `getGeneratorSettings` `saveGeneratorSettings` `detectClaudeCli` `createGeneratorProject` `getGeneratorProject` `listGeneratorProjects` `readGeneratorProjectFile`
  - generator terminal: `getGeneratorProjectTerminal` `startGeneratorProjectTerminal` `sendGeneratorProjectTerminalInput` `stopGeneratorProjectTerminal` `resizeGeneratorProjectTerminal` `subscribeGeneratorProjectTerminal`
  - apps: `getAppsRoot` `listApps` `initializeAppsDatabase` `installAppFromDirectory` `startApp` `stopApp` `getAppLogs` `removeApp` `openAppWindow` `pickInstallDirectory`
  - system apps: `refreshSystemAppsIndex` `searchSystemApps` `openSystemApp`
  - quick launcher: `closeQuickLauncherWindow` `setQuickLauncherWindowSize` `subscribeQuickLauncherRequest`
- IPC channels（main handlers/events）:
  - `tool-hub:ping`
  - settings: `settings:get-tabs` `settings:save-tabs` `settings:initialize-db` `settings:backup-config` `settings:restore-config`
  - generator: `generator:get-settings` `generator:save-settings` `generator:detect-claude-cli` `generator:create-project` `generator:get-project` `generator:list-projects` `generator:read-project-file` `generator:install-project`
  - generator terminal: `generator:get-terminal` `generator:start-terminal` `generator:terminal-input` `generator:stop-terminal` `generator:resize-terminal` `generator:terminal-subscribe` `generator:terminal-unsubscribe` `generator:terminal-output`
  - apps: `apps:get-root` `apps:list` `apps:initialize-db` `apps:install-from-directory` `apps:start` `apps:stop` `apps:get-logs` `apps:remove` `apps:open-window` `apps:pick-install-directory`
  - app runtime: `app-runtime:get-info` `app-runtime:launch-payload` `app-runtime:kv-get` `app-runtime:kv-set` `app-runtime:kv-delete` `app-runtime:kv-list` `app-runtime:kv-clear` `app-runtime:file-read` `app-runtime:file-write` `app-runtime:system-file-read` `app-runtime:system-file-write`
  - system apps: `system-apps:refresh` `system-apps:search` `system-apps:open`
  - quick launcher: `quick-launcher:open` `quick-launcher:close` `quick-launcher:set-size`
