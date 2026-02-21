# Node Hello App Template

This is a minimal app template for Tool Hub runtime:

- `app.json`: app manifest
- app category tab is assigned at install time and stored in local SQLite
- `src/index.js`: Node entry process
- `ui/index.html`: interactive demo UI (counter/theme/message buttons)
- `window.toolHubAppApi.files`: host-provided app-directory file read/write API for app UI
- `window.toolHubAppApi.storage`: host-provided SQLite key/value persistence API for app UI
- `window.toolHubAppApi.systemFiles`: host-provided absolute-path file read/write API
- `window.toolHubAppApi.getRuntimeInfo()`: includes `appId` and structured `launchContext` (`source` distinguishes `quick-launcher` / `manual` / `explorer-context-menu`)
- `window.toolHubAppApi.subscribeLaunchContext(cb)`: receive structured context dispatch updates
- `window.toolHubAppApi.notify(title, body, options?)`: send Windows system notification from app UI
- `AGENTS.md`: complete guide (basic + advanced)

## Use this template

1. Copy this folder to your local work directory and rename `id`/`name` in `app.json`.
2. In Tool Hub Settings, pick source directory, choose target tab, then run **Install App**.
3. Open the generated app tab, click **Open/Open Window**, then try the demo buttons.
4. In top search or quick launcher, type `hello`, press `Space` to select, then input payload text and press `Enter`.
   - The Hello App **Launch Payload** panel reads `launchContext.payload`, and `launchContext.source` will be `quick-launcher`.
5. In the **Arbitrary Path File (Host System API)** panel, input an absolute path and test read/write.
   - For protected files (for example `hosts`), write operation may fail without admin rights.

## Capabilities in app.json

`capabilities` lets Tool Hub dispatch Explorer right-click targets to your app:

```json
{
  "capabilities": [
    {
      "id": "handle-files",
      "name": "Read File Content",
      "targets": ["file"]
    },
    {
      "id": "handle-any-target",
      "name": "Handle Files/Folders",
      "targets": ["any"]
    }
  ]
}
```

- `targets` supports: `file`, `folder`, `any`.
- Use `any` if one capability needs to handle mixed file/folder selections.
- Explorer context dispatch should read `launchContext.capability` + `launchContext.targets`.
- The template UI includes a **Capability Demo: Read File Content** panel. It auto-runs when `launchContext.source === "explorer-context-menu"` and `launchContext.capability.id === "handle-files"`.

Try it:
1. Install Hello App.
2. Right-click a file in Explorer and choose Tool Hub context dispatch.
3. Select `Hello App / Read File Content`.
4. The panel will auto-read selected file content and show a preview.

## Next step

Read `AGENTS.md` before implementing your own app logic.

