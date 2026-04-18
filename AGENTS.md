# Repository Guidelines

## Project Structure & Module Organization
This project is a desktop application built with Vue 3.

- `src/app/`: app shell and top-level page composition.
- `src/components/`: reusable Vue components (`PascalCase.vue`).
- `src/config/`: static app settings and registries (for example `settings.ts`).
- `src/platform/`: runtime bridge/adapters (for example `electron-bridge.ts`).
- `src/styles/`: global styles.
- `src/types/`: shared TypeScript types.
- `electron/`: Electron source modules (`main-process.ts`, `preload-bridge.ts`, `apps-manager.ts`, `settings-store.ts`).
- `build-electron/`: compiled Electron runtime output (generated; do not edit manually).
- `templates/node-hello-app/`: installable Node app template and developer guide.
- `dist/`: build output (generated; do not edit manually).

## Build, Test, and Development Commands
Use `pnpm` for all workflows.

- `pnpm install`: install dependencies.
- `pnpm dev`: run Vite web dev server only.
- `pnpm electron:dev`: run Vite + desktop runtime together for development.
- `pnpm typecheck`: run TypeScript checks (`vue-tsc`).
- `pnpm electron:typecheck`: run Electron TypeScript checks (`tsc -p tsconfig.electron.json --noEmit`).
- `pnpm electron:build`: compile Electron TypeScript sources to `build-electron/`.
- `pnpm build`: run type-check and production build.
- `pnpm preview`: preview built web assets.
- `pnpm electron:start`: launch application directly (fast start, no forced build).
- `pnpm electron:start:build`: build first, then launch application.

## Agent Operation Rule
- Do not run dependency installation commands automatically (for example `pnpm install`, `npm install`, `yarn install`, `pnpm add`).
- Dependency changes should be updated in code/config only, and the user will run installation manually.

## Coding Style & Naming Conventions
- Language: TypeScript + Vue SFC (`<script setup lang="ts">`).
- Indentation: 2 spaces; keep semicolons and double quotes consistent with existing files.
- Components: `PascalCase.vue` (example: `AppTopMenu.vue`).
- Non-component files: `kebab-case` (example: `settings.ts`).
- Keep security defaults: `contextIsolation: true`, `nodeIntegration: false`.
- Add new native capabilities via preload bridge, not direct renderer Node access.
- App category mapping is DB-driven (`apps.tab_id` in SQLite), not `app.json`.

## System App Development Requirements
- System apps are built-in host capabilities, not user-installed apps. Do not put them into the install/start/stop/remove flow used by `apps-manager.ts`, and do not model them as entries from `app.json`.
- Built-in system app metadata is registered in `electron/system-tools-registry.ts`. Use stable ids with the `builtin:` prefix, and fill in `name`, `description`, `category`, icon, keywords, and `matchBoost`.
- If a system app uses `launchType: "internal"`, the main process must handle it explicitly in `ipcMain.handle("system-apps:open")`. `electron/system-apps-manager.ts` intentionally throws for internal apps that are not host-handled.
- Renderer code must access system app capabilities only through `electron/preload-bridge.ts` and `src/platform/electron-bridge.ts`. Do not introduce direct renderer-side Node access.
- If a system app needs its own window, add a dedicated route in `src/router/index.ts`, keep the isolated shell handling in `src/app/App.vue`, and create/show the window in `electron/main-process/window-manager.ts`.
- Preserve Electron security defaults for every system app window: `contextIsolation: true`, `nodeIntegration: false`. Any native integration should stay in main/preload, not inside Vue pages.
- If a system app should appear in the Settings "System Apps" panel, also update the allowlist in `electron/system-apps-manager.ts:listSystemApps()`. Registering an app in the system tools registry alone is not enough.
- If a system app needs launch payload support from quick launcher or other entry points, declare `acceptsLaunchPayload` in the registry and add the corresponding host-side state handoff logic.
- System apps must degrade clearly outside supported runtime. Current implementation expects Electron runtime, and recorder flows additionally require Windows support.
- Changes to system apps should be smoke-tested in `pnpm electron:dev`, including window open flow, renderer/main IPC, and failure states when runtime requirements are missing.

### Current System Apps
- `builtin:ai-chat`: independent AI window at `/system-ai`, opened by the host window manager instead of the generic app runtime. It supports launch payloads from quick launcher, and its settings/session/message persistence lives in `settings-store.ts`.
- `builtin:screen-recorder`: independent recorder window at `/system-recorder`, backed by `electron/system-recorder-manager.ts` plus the renderer `SystemRecorderPanel.vue`. It uses Electron `desktopCapturer` and browser `MediaRecorder`, with optional MP4 transcoding via configured `ffmpeg`.
- `builtin:window-recorder`: this is an internal recorder mode sharing the same recorder page/manager as screen recording. It is fetched by id inside the recorder UI, but it is not currently exposed as a separate entry in the Settings "System Apps" list.

## Testing Guidelines
No dedicated unit-test framework is configured yet. Minimum quality gate before PR:

1. `pnpm typecheck`
2. `pnpm build` (when validating release output)
3. Manual smoke test in `pnpm electron:dev`:
   - tab CRUD in Settings
   - app install (directory picker + target tab)
   - app open/start/stop/logs/remove
   - `Init DB` actions for settings/apps

If you add tests later, place them near source (`src/**`) with clear `*.test.ts` naming.

## Runtime Data & Safety
- Settings DB:
  - dev: `data/settings.sqlite`
  - packaged: `userData/settings.sqlite`
- Apps root (fixed): `%USERPROFILE%\\.tool-hub\\apps`
- Apps DB (fixed): `%USERPROFILE%\\.tool-hub\\apps.sqlite`
- `Remove` deletes the installed app directory and DB records. Do not use this flow for source directories you want to keep.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so follow Conventional Commits:

- `feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...`, `chore: ...`

PRs should include:

1. What changed and why.
2. Affected paths (for example `src/platform/electron-bridge.ts`).
3. Validation steps/commands run.
4. Screenshots or short recording for UI changes.

## Skills
- `tool-hub-release-workflow`: Tool Hub 版本发布流程技能，用于整理版本范围、更新 `package.json` + `CHANGELOG.md`、执行发布前校验、打标签并触发 CI 发布。（file: `skills/tool-hub-release-workflow/SKILL.md`）
