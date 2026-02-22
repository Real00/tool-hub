# Changelog

## [0.2.2] - 2026-02-22

### Added
- 新增应用 Runtime 目录选择 API：`window.toolHubAppApi.pickDirectory(...)`，支持可选目录条目扫描（`includeEntries`、`maxEntries`、`maxDepth`、`includeHidden`）。

### Fixed
- 修复应用覆盖安装时丢失应用级 key/value 存储数据的问题，覆盖安装默认保留原有数据。
- 修复 Generator 终端输出闪烁问题，改为增量输出同步策略。
- 增强 Generator 安装前校验与覆盖安装处理流程，降低安装失败和误覆盖风险。

### Changed
- 将 `electron/main-process.cjs` 拆分为 `electron/main-process/` 下多个职责模块（`auto-update`、`window-manager`、`app-runtime-windows`、`context-dispatch`、`config-restore`），提升主进程可维护性。
- 将 `electron/app-generator.cjs` 拆分为 `electron/app-generator/` 下的多模块结构，明确职责边界并便于后续扩展。
- README 统一调整为英文，消除中英文混写。
- 发布流程技能文档更新为更严格的命令时序约束，降低发版过程中的操作风险。

## [0.2.1] - 2026-02-21

### Fixed
- 修复安装版创建 Generator 项目失败问题：模板目录解析增加 `resources/templates/node-hello-app` 回退，避免仅按 `app.asar` 路径查找导致 `Template directory not found`。

### Changed
- 打包配置调整为将 `templates/node-hello-app` 全量包含到 `extraResources`，确保发布版可复制完整模板项目文件。

## [0.2.0] - 2026-02-21

### Added
- 新增 Windows 资源管理器右键分发能力：主进程聚合上下文目标、渲染端分发请求订阅与能力选择弹窗，支持按 `capabilities` 精准分发到应用。
- 新增应用能力分发与结构化启动上下文协议：`apps:dispatch-capability`、`launchContext.capability`、`launchContext.targets`。
- Generator 页面新增“更新 AGENTS.md”能力，可一键将最新模板规则同步到当前开发项目。
- 模板 `node-hello-app` 新增 capability demo、`notify` 示例与更完整的 `launchContext` 使用示例。

### Fixed
- 修复打包版本执行“更新 AGENTS.md”时模板文件缺失问题：增加多路径回退读取与内置模板资源兜底。

### Changed
- 运行时启动协议统一为 `launchContext`，移除 `launchPayload` 及其订阅通道；`openAppWindow` 改为接收结构化 `launchContext`。
- `ToolHubApi`、preload bridge、类型定义与模板文档同步升级到新协议。
- 打包配置补充 `templates/node-hello-app/AGENTS.md` 到 `extraResources`，确保发布版可用。

## [0.1.3] - 2026-02-21

### Added
- 新增 Runtime 管理页与路由入口（`RuntimePage`），支持在设置页查看运行时状态。
- 快捷启动器新增最近历史记录与收藏能力（Top Menu / Quick Launcher）。
- Generator 新增安装前校验与自动 Verify 工作流（含可配置 `verifyCommand`）。
- 新增 `.no-scrollbar` 样式工具类，用于面板滚动区域简化视觉干扰。

### Fixed
- Generator 的 **Start Claude** 默认优先恢复最近会话（`--continue`），恢复失败时自动回退为新会话启动。

### Changed
- `GeneratorPanel` 信息架构与布局优化：状态徽标、折叠详情、项目快照与终端区域可读性提升。
- 应用管理与运行时管理相关主流程改造（`apps-manager` / `main-process` / `preload` / bridge / state 同步更新）。
- 文档与许可证声明更新为 noncommercial 约束（`LICENSE`、`README.md`、`package.json`）。

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
