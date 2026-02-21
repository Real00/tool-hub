# Changelog

## [0.1.3] - 2026-02-21

### Added
- 新增 `.no-scrollbar` 样式工具类，用于面板滚动区域简化视觉干扰。

### Fixed
- Generator 的 **Start Claude** 默认优先恢复最近会话（`--continue`），恢复失败时自动回退为新会话启动。

### Changed
- `GeneratorPanel` 信息架构与布局优化：状态徽标、折叠详情、项目快照与终端区域可读性提升。

## [0.1.2] - 2026-02-20

### Added
- 新增 `electron-builder.publish.yml`，用于发布到 GitHub Releases。
- 新增应用图标资源：`electron/assets/app-icon.ico`、`electron/assets/app-icon.png`。
- 打包配置新增 `extraResources`，将 `electron/assets` 一并带入产物。

### Changed
- `electron-builder.yml` 拆分发布配置，默认配置不再直接包含 `publish` 段。
- `package.json` 的 `electron:pack:win`、`electron:dist:win`、`electron:dist:win:dry` 改为显式指定配置文件。
- Electron 主进程改为单实例运行；二次启动时聚焦主窗口并刷新托盘菜单。
- 应用运行时从 `spawn --run-as-node` 切换为 `utilityProcess.fork`，并增强日志与异常处理。
- 停止应用时增加窗口关闭、优雅退出超时与强制结束进程树逻辑。
- `vite.config.ts` 生产构建 `base` 调整为 `./`，提升本地文件场景兼容性。
- `.gitignore` 新增 `release/`。
- `README.md` 增加发布专用配置说明。
