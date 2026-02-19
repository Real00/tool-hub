# Node Hello App 二次开发指南（基础 + 进阶）

本文档合并了基础与进阶内容，目标是让你从模板快速走到可维护、可扩展的业务应用。

## 1. 运行模型（先理解这个）

Tool Hub 中一个应用由两部分组成：

- Node 进程：由 `entry` 指向的 JS 文件启动（本模板是 `src/index.js`）
- UI 窗口：由 `uiPath` 或 `uiUrl` 指向（本模板是 `ui/index.html`）

重要约束：

- 应用安装后会被复制到用户目录：`%USERPROFILE%\.tool-hub\apps\<app-id>`
- 应用分类（Tab）不在 `app.json` 里，保存在 SQLite 的 `apps.tab_id`
- UI 在独立 Electron 窗口打开，不是嵌入主页面

## 2. 模板目录说明

```txt
node-hello-app/
  app.json          # 应用清单（元信息 + 启动入口）
  src/index.js      # Node 入口，负责后台逻辑
  ui/index.html     # 前端页面，负责交互展示
```

## 3. `app.json` 字段说明

```json
{
  "id": "hello-app",
  "name": "Hello App",
  "version": "0.1.0",
  "entry": "src/index.js",
  "uiPath": "ui/index.html",
  "env": {
    "APP_GREETING": "Hello from user app",
    "TICK_INTERVAL_MS": "3000"
  }
}
```

字段建议：

- `id`: 全局唯一，建议小写短横线（如 `order-center`）
- `name`: 展示名称，可读性优先
- `version`: 语义化版本（`major.minor.patch`）
- `entry`: Node 入口相对路径
- `uiPath`: 本地 UI 文件相对路径（或用 `uiUrl`）
- `env`: 运行时环境变量（字符串键值）

## 4. 开发与安装流程（推荐）

1. 复制模板到工作目录，修改 `id/name/version`
2. 开发 `src/index.js` 与 `ui/index.html`
3. Tool Hub -> Settings -> Node apps management
4. `Select Dir` 选目录，选目标 Tab，点 `Install App`
5. 在对应 Tab 用 `Open Window` 查看 UI，用 `Start` 跑 Node

注意：`Install App` 是复制安装。源码目录变更不会自动同步到已安装目录。  
更新建议流程：`Remove` 旧版本 -> `Install App` 新版本。

## 5. Node 侧开发建议（`src/index.js`）

模板已演示：

- 读取 `process.env`
- 定时写 `runtime/heartbeat.json`
- 输出 stdout/stderr 日志
- 处理 `SIGINT`/`SIGTERM`

建议：

- 入口只做启动编排，业务拆到 `src/` 子模块
- 外部资源路径基于 `process.cwd()` 解析
- 退出前清理定时器、句柄、子进程

## 6. UI 侧开发建议（`ui/index.html`）

当前示例包含按钮交互（计数、主题切换、提示消息、动效），可直接改造成业务页面。

建议：

- UI 保持纯前端能力（HTML/CSS/JS）
- 事件与状态集中管理，减少全局变量污染
- 页面复杂时用独立前端工程，构建产物输出到 `ui/`

## 7. 进阶：多页面 UI 组织

```txt
ui/
  index.html
  pages/
    dashboard.html
    settings.html
  assets/
    app.css
    app.js
```

建议：

- 共享逻辑放 `assets/app.js`
- 页面跳转优先相对路径
- 静态资源路径保持稳定，避免安装后失效

如果使用 Vue/React：

1. 新建前端工程（如 `ui-src/`）
2. 构建输出到 `ui/`
3. `app.json` 继续使用 `uiPath: "ui/index.html"`

## 8. 进阶：Node 与 UI 通信

推荐优先级：

1. 本地 HTTP API（推荐）
2. 文件轮询（轻量）
3. WebSocket（实时）

### 8.1 本地 HTTP API（推荐）

- Node 启本地服务（如 `127.0.0.1:4310`）
- UI 用 `fetch` 调用
- 端口放到 `env`，返回统一 JSON

### 8.2 文件轮询

- Node 写 `runtime/state.json`
- UI 周期读取

适合低频状态，不适合高频实时交互。

### 8.3 WebSocket

- Node 提供 ws
- UI 建立长连接接收推送

适合日志流、进度、监控场景。

## 9. 进阶：应用配置持久化

### 9.1 JSON（起步快）

```txt
runtime/
  config.json
  state.json
```

建议：

- 启动时加载默认配置并合并 `env`
- 写入前做字段校验
- 用“临时文件 + 覆盖”避免损坏

### 9.2 SQLite（可维护）

```txt
runtime/
  app.sqlite
```

示例表：

```sql
CREATE TABLE IF NOT EXISTS kv_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

建议：

- DB 初始化放启动阶段一次完成
- 高频写入做节流
- 升级使用 migration，不直接删库

## 10. 推荐工程结构（进阶）

```txt
src/
  index.js
  server.js
  services/
  storage/
  utils/
ui/
  index.html
  pages/
  assets/
runtime/
  logs/
  app.sqlite
  config.json
```

## 11. 调试与排错

- Tool Hub 点击 `Logs` 查看运行日志
- 检查 `runtime/heartbeat.json` 是否持续更新
- 常见问题：
  - `App not found`: `id` 与安装状态不一致，重新安装
  - `Entry file not found`: `entry` 路径错误
  - UI 空白：`uiPath` 路径错误或文件不存在

## 12. 发布与升级建议

- `version` 使用语义化版本
- 发布前检查：`entry`/`uiPath`/默认配置/首次启动初始化
- 升级流程建议：备份 `runtime` -> Remove -> Install -> 首启 migration

## 13. 二次开发最小清单

- 改唯一 `id`
- 更新 `version`
- 确认 `entry` 与 `uiPath/uiUrl`
- `env` 放可配置项（端口、开关、URL）
- 启动日志输出版本、配置、关键状态

按这份清单实施，通常可以稳定从示例演进到生产可维护应用。
