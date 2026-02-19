# Node Hello App Template

This is a minimal app template for Tool Hub runtime:

- `app.json`: app manifest
- app category tab is assigned at install time and stored in local SQLite
- `src/index.js`: Node entry process
- `ui/index.html`: interactive demo UI (counter/theme/message buttons)
- `DEVELOPMENT_GUIDE.md`: complete guide (basic + advanced)

## Use this template

1. Copy this folder to your local work directory and rename `id`/`name` in `app.json`.
2. In Tool Hub Settings, pick source directory, choose target tab, then run **Install App**.
3. Open the generated app tab, click **Open Window**, then try the demo buttons.

## Next step

Read `DEVELOPMENT_GUIDE.md` before implementing your own app logic.
