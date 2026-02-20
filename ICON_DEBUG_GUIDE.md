# 图标显示问题调试指南

## 问题描述
搜索功能中 Start Menu 和 UWP 应用的图标显示不正常。

## 已添加的调试日志

我在 `electron/system-apps-manager.cjs` 中添加了详细的调试日志，涵盖以下关键环节：

### 1. Start Menu 图标解析
- `[StartMenu] No shortcut metadata` - PowerShell 未返回快捷方式元数据
- `[StartMenu] Icon resolved` - 图标路径解析成功
- `[StartMenu] No icon path` - 图标路径解析失败
- `[StartMenu] PowerShell error` - PowerShell 执行错误

### 2. UWP 图标解析
- `[UWP] Icon resolved` - UWP 图标路径解析成功
- `[UWP] No icon path found` - 未找到 UWP 图标路径
- `[UWP] Empty PowerShell output` - PowerShell 返回空结果
- `[UWP] PowerShell error` - PowerShell 执行错误

### 3. 图标加载
- `[Icon] Successfully loaded image file` - 直接读取图片文件成功
- `[Icon] Failed to read image file` - 读取图片文件失败
- `[Icon] Attempting getFileIcon` - 尝试使用 Electron API
- `[Icon] Successfully loaded via getFileIcon` - Electron API 加载成功
- `[Icon] getFileIcon returned empty` - Electron API 返回空图标
- `[Icon] Failed to load icon` - 图标加载失败

### 4. 公共入口
- `[toPublicEntry] Processing` - 开始处理应用条目
- `[toPublicEntry] Result` - 处理结果（是否有图标）

## 调试步骤

### 步骤 1：重启应用并查看日志

```bash
# 重新构建并启动应用
pnpm run dev
```

### 步骤 2：触发搜索

1. 按 `Alt + Space` 打开快速搜索
2. 搜索一些常见应用，例如：
   - "notepad"（记事本 - Start Menu）
   - "calculator"（计算器 - UWP）
   - "settings"（设置 - UWP）
   - "chrome"（如果已安装 - Start Menu）

### 步骤 3：分析日志输出

查看控制台输出，重点关注：

#### 场景 A：PowerShell 执行失败
```
[StartMenu] PowerShell error for batch: ...
[UWP] PowerShell error for batch: ...
```
**可能原因：**
- PowerShell 执行策略限制
- 脚本语法错误
- 权限不足

**解决方案：**
- 检查 PowerShell 执行策略：`Get-ExecutionPolicy`
- 尝试手动运行 PowerShell 脚本测试

#### 场景 B：图标路径为空
```
[StartMenu] No icon path for XXX, iconLocation: , targetPath:
[UWP] No icon path found for XXX
```
**可能原因：**
- .lnk 文件没有设置图标
- UWP 应用的 Logo 使用了 `ms-resource:` 协议
- AppxManifest.xml 解析失败

**解决方案：**
- 检查具体应用的快捷方式属性
- 对于 UWP，检查是否使用了资源协议

#### 场景 C：图标加载失败
```
[Icon] Failed to read image file: XXX
[Icon] getFileIcon returned empty for: XXX
```
**可能原因：**
- 文件不存在
- 文件权限问题
- 图标格式不支持

**解决方案：**
- 检查文件是否存在：`Test-Path "路径"`
- 检查文件权限
- 尝试使用其他图标提取工具

## 常见问题和解决方案

### 问题 1：所有图标都不显示

**检查：**
1. Electron 的 `app.getFileIcon()` API 是否正常工作
2. 运行测试脚本：
   ```javascript
   // 在主进程中
   const { testIconLoading } = require('./test-icon-debug.js');
   testIconLoading();
   ```

### 问题 2：只有 Start Menu 图标不显示

**检查：**
1. PowerShell 脚本是否能正确解析 .lnk 文件
2. 手动测试：
   ```powershell
   $shell = New-Object -ComObject WScript.Shell
   $shortcut = $shell.CreateShortcut("C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Notepad.lnk")
   $shortcut.IconLocation
   $shortcut.TargetPath
   ```

### 问题 3：只有 UWP 图标不显示

**检查：**
1. PowerShell 脚本是否能访问 AppxPackage
2. 手动测试：
   ```powershell
   Get-AppxPackage | Select-Object Name, PackageFamilyName, InstallLocation | Format-Table
   ```

### 问题 4：图标路径正确但加载失败

**可能原因：**
- 图标文件是 .ico 格式但包含多个尺寸，Electron 可能无法正确处理
- 文件被系统保护，需要管理员权限

**解决方案：**
- 尝试使用 `{ size: 'normal' }` 或 `{ size: 'large' }` 参数
- 以管理员权限运行应用

## 性能优化建议

如果图标加载很慢：

1. **增加缓存**：当前已有缓存机制，但可以考虑持久化缓存
2. **并行加载**：当前是串行加载，可以改为并行
3. **延迟加载**：只加载可见的图标，滚动时再加载其他

## 下一步

1. 运行应用并收集日志
2. 根据日志输出确定具体问题
3. 如果需要，可以：
   - 调整 PowerShell 脚本
   - 修改图标加载逻辑
   - 添加降级方案（使用默认图标）

## 临时解决方案

如果图标加载一直有问题，可以考虑：

1. **使用默认图标**：为不同类型的应用显示不同的默认图标
2. **禁用图标**：只显示应用名称
3. **使用第三方图标库**：例如从 Windows 图标缓存中提取

## 联系信息

如果问题持续存在，请提供：
1. 完整的控制台日志输出
2. 具体哪些应用的图标不显示
3. Windows 版本和 Electron 版本
