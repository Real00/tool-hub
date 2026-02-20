# Node Hello App Template

This is a minimal app template for Tool Hub runtime:

- `app.json`: app manifest
- app category tab is assigned at install time and stored in local SQLite
- `src/index.js`: Node entry process
- `ui/index.html`: interactive demo UI (counter/theme/message buttons)
- `window.toolHubAppApi.files`: host-provided app-directory file read/write API for app UI
- `window.toolHubAppApi.storage`: host-provided SQLite key/value persistence API for app UI
- `window.toolHubAppApi.systemFiles`: host-provided absolute-path file read/write API
- `window.toolHubAppApi.getRuntimeInfo()`: includes `appId` and latest `launchPayload`
- `window.toolHubAppApi.subscribeLaunchPayload(cb)`: receive payload updates when app window is already open
- `AGENTS.md`: complete guide (basic + advanced)

## Use this template

1. Copy this folder to your local work directory and rename `id`/`name` in `app.json`.
2. In Tool Hub Settings, pick source directory, choose target tab, then run **Install App**.
3. Open the generated app tab, click **Open/Open Window**, then try the demo buttons.
4. In top search or quick launcher, type `hello`, press `Space` to select, then input payload text and press `Enter`.
   - The Hello App **Launch Payload** panel will show the received payload.
5. In the **Arbitrary Path File (Host System API)** panel, input an absolute path and test read/write.
   - For protected files (for example `hosts`), write operation may fail without admin rights.

## Next step

Read `AGENTS.md` before implementing your own app logic.

