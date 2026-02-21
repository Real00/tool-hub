# Repository Guidelines

## Project Structure & Module Organization
This project is a desktop application built with Vue 3.

- `src/app/`: app shell and top-level page composition.
- `src/components/`: reusable Vue components (`PascalCase.vue`).
- `src/config/`: static app settings and registries (for example `settings.ts`).
- `src/platform/`: runtime bridge/adapters (for example `electron-bridge.ts`).
- `src/styles/`: global styles.
- `src/types/`: shared TypeScript types.
- `electron/`: main/preload/runtime modules (`main-process.cjs`, `preload-bridge.cjs`, `apps-manager.cjs`, `settings-store.cjs`).
- `templates/node-hello-app/`: installable Node app template and developer guide.
- `dist/`: build output (generated; do not edit manually).

## Build, Test, and Development Commands
Use `pnpm` for all workflows.

- `pnpm install`: install dependencies.
- `pnpm dev`: run Vite web dev server only.
- `pnpm electron:dev`: run Vite + desktop runtime together for development.
- `pnpm typecheck`: run TypeScript checks (`vue-tsc`).
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
