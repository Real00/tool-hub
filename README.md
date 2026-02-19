# Electron Tool Hub UI

UI shell built with Vue 3 + Tailwind CSS for an Electron desktop toolbox.

## Start

```bash
pnpm install
pnpm dev
```

## Run with Electron

Commands:

```bash
pnpm install
pnpm electron:dev
```

- `pnpm electron:dev`: development mode with hot reload, no build required after each change.

## Build

```bash
pnpm build
```

## Run built app with Electron

```bash
pnpm electron:start
```

- `pnpm electron:start`: start Electron directly (fast, no forced build).
- `pnpm electron:start:build`: build first, then start Electron.

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
- In development, data is stored in `data/settings.sqlite`.
- In packaged builds, data is stored under Electron `userData` path.

## Node app runtime (fixed user directory)

- Apps root is fixed to: `%USERPROFILE%\\.tool-hub\\apps`
- Apps registry DB is: `%USERPROFILE%\\.tool-hub\\apps.sqlite`
- Drop an app folder into the apps root, or use **Select Dir** + choose **Target Tab** + **Install App** in Settings.
- Use **Init DB** in apps section to initialize/check apps DB and rescan app folders.
- Use **Remove** to uninstall an app (deletes app folder + DB records).
- Each app runs in an isolated Node process with its own cwd/env.
- Apps are grouped under top tabs by `apps.tab_id` in SQLite.
- App UI opens in a separate Electron window (not embedded in main page).
- A runnable template is available at `templates/node-hello-app`.

### App UI host API

When an app UI window is opened by Tool Hub, the host injects `window.toolHubAppApi` in that window:

- `getRuntimeInfo()` -> returns `{ appId }`
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
- Electron process files use explicit role names (`main-process.cjs`, `preload-bridge.cjs`)

## Current Electron bridge

- Frontend bridge: `src/platform/electron-bridge.ts`
- SQLite stores: `electron/settings-store.cjs`, `electron/apps-manager.cjs`
- Electron IPC handlers: `electron/main-process.cjs`, `electron/preload-bridge.cjs`
- API methods:
  - `ping`
  - `getSettingsTabs`
  - `saveSettingsTabs`
  - `getAppsRoot`
  - `listApps`
  - `installAppFromDirectory`
  - `startApp`
  - `stopApp`
  - `getAppLogs`
  - `openAppWindow`
  - `pickInstallDirectory`
- IPC channels:
  - `tool-hub:ping`
  - `settings:get-tabs`
  - `settings:save-tabs`
  - `apps:get-root`
  - `apps:list`
  - `apps:install-from-directory`
  - `apps:start`
  - `apps:stop`
  - `apps:get-logs`
  - `apps:open-window`
  - `apps:pick-install-directory`
