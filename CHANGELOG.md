# Changelog

## [Unreleased]

### Added
- 新增内置 `开发者工具` 系统应用与独立窗口，支持从 Settings 的 System Apps 面板和 quick launcher 直接打开。
- 新增开发者工具的转换能力：`JSON Format`、`MD5 Hash`、`Random Generate`、URL 编解码、Unicode 编解码、Base64 编解码与时间戳转换。
- 新增 quick launcher 剪切板开发者动作，能在高置信度命中 JSON、URL、Unicode、Base64、时间戳时直接打开开发者工具并切到对应面板。
- 新增 Settings 页面内置 System Apps 面板，可浏览并直接打开内置系统应用。

### Changed
- 开发者工具面板布局调整为更紧凑的双区域结构，JSON 输入移到左侧小卡片，时间戳结果与当前时间改为结构化列表展示。
- JSON 结果面板升级为支持展开/折叠的树视图，并增加 `Expand All` / `Collapse All` 控制。
- quick launcher 现在支持通过关键词直达开发者工具模式，例如 `随机`、`json`、`md5`。

## [0.4.0] - 2026-04-10

### Added
- 新增内置 `AI` 系统应用与独立窗口路由，支持从 quick launcher 通过 payload 直接发起对话。
- 新增 OpenAI SDK 与 Anthropic SDK provider 接入，支持 `Chat Completions`、`Responses` 与 Claude Messages 流式对话。
- 新增 AI 设置持久化、会话历史持久化、模型列表刷新、调试日志开关与 `previous_response_id` 驱动的 Responses 多轮会话。
- 新增 AI 消息 Markdown 渲染链，支持代码高亮、表格、引用、链接与代码块复制按钮。
- 新增图片粘贴参与对话能力，支持图片预览、删除待发送图片，以及历史消息中的图片回显。

### Fixed
- 修复 quick launcher recent 列表来源文案重复叠加、剪切板路径结果过期、目录路径重复动作等问题。
- 修复 AI 流式请求在窗口重开、取消、异常退出后的状态恢复与清理问题，避免残留 `streaming` 状态或丢失 Stop 按钮。
- 修复 OpenAI / Anthropic SDK 请求取消、Responses JSON 回退解析、请求调试输出与图片附件跨 IPC 传输问题。
- 修复代码块复制按钮在 Markdown 安全净化后被过滤的问题，并修复粘贴单张图片出现双缩略图的问题。

### Changed
- AI 面板布局升级为桌面双栏 + 小屏抽屉式历史列表，左右区域独立滚动并支持桌面端历史栏收起。
- AI 页面与消息气泡样式整体收紧：顶部栏更紧凑、正文颜色更柔和、Markdown 行距和列表间距更密实。
- 开发服务器端口从 `5173` 调整为 `5273`，并同步更新 Electron 开发启动流程。

## [0.3.0] - 2026-04-08

### Added
- 新增系统录像器独立窗口与系统应用入口，支持屏幕录像、应用窗口录像、实时预览、分辨率设置、帧率设置与系统音频开关。
- 新增录制后可选转码为 MP4 的能力，支持配置 `ffmpeg` 路径、实时转码进度显示以及转码失败时保留原始 WebM 文件。
- 新增系统录像相关 Electron bridge / preload / IPC 接口与类型定义，支持录制、预览、源枚举和转码状态查询。

### Fixed
- 修复系统录像在浏览器模式下误触发 Electron API 的问题，避免 `pnpm dev` / `preview` 工作流报错。
- 修复系统录像源切换、停止录制、防重复停止、窗口关闭清理、预览与正式录制竞争同一采集请求等稳定性问题。
- 修复 MP4 转码状态反馈不准确、转码失败后输出文件路径丢失、关闭窗口后录制会话残留等问题。

### Changed
- 系统录像实现从主进程直接调用 FFmpeg 采屏切换为 Electron 官方 `desktopCapturer` + 浏览器 `MediaRecorder` 录制链路。
- 系统录像页面布局压缩为更紧凑的双栏结构，并将 Source Preview 升级为实时视频预览。

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
