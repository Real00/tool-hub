// @ts-nocheck
const path = require("node:path");

function getWindowsDir() {
  return process.env.WINDIR || "C:\\Windows";
}

function makeSvgDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createRecorderIconDataUrl(mode) {
  const accent = mode === "window" ? "#38bdf8" : "#22d3ee";
  const label = mode === "window" ? "APP" : "REC";
  return makeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#0f172a"/>
      <rect x="10" y="14" width="44" height="28" rx="6" fill="#111827" stroke="${accent}" stroke-width="3"/>
      <circle cx="22" cy="50" r="6" fill="#ef4444"/>
      <rect x="32" y="46" width="18" height="8" rx="4" fill="${accent}"/>
      <text x="32" y="34" fill="${accent}" font-size="10" font-family="Segoe UI, Arial, sans-serif" text-anchor="middle">${label}</text>
    </svg>
  `);
}

function createAiIconDataUrl() {
  return makeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#0f172a"/>
      <rect x="10" y="10" width="44" height="44" rx="12" fill="#111827" stroke="#34d399" stroke-width="3"/>
      <path d="M22 38 L26 24 L32 36 L38 20 L42 38" fill="none" stroke="#34d399" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="24" cy="44" r="2.5" fill="#f8fafc"/>
      <circle cx="40" cy="44" r="2.5" fill="#f8fafc"/>
    </svg>
  `);
}

function resolveSystem32Path(fileName) {
  return path.join(getWindowsDir(), "System32", fileName);
}

function getBuiltinSystemTools() {
  const controlExe = resolveSystem32Path("control.exe");
  const mmcExe = resolveSystem32Path("mmc.exe");
  const taskMgrExe = resolveSystem32Path("Taskmgr.exe");
  const regeditExe = resolveSystem32Path("regedit.exe");
  const servicesMsc = resolveSystem32Path("services.msc");
  const devMgmtMsc = resolveSystem32Path("devmgmt.msc");
  const diskMgmtMsc = resolveSystem32Path("diskmgmt.msc");
  const computerMgmtMsc = resolveSystem32Path("compmgmt.msc");
  const cmdExe = resolveSystem32Path("cmd.exe");
  const powerShellExe = path.join(
    getWindowsDir(),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const msInfoExe = resolveSystem32Path("msinfo32.exe");
  const explorerExe = path.join(getWindowsDir(), "explorer.exe");

  return [
    {
      id: "builtin:ai-chat",
      name: "AI",
      source: "System Tool",
      launchType: "internal",
      category: "launcher",
      description: "内置 AI 对话面板，支持 OpenAI 兼容接口和多轮流式对话。",
      iconDataUrl: createAiIconDataUrl(),
      keywords: ["ai", "chat", "assistant", "llm", "对话", "模型", "智能助手"],
      matchBoost: 420,
      acceptsLaunchPayload: true,
    },
    {
      id: "builtin:developer-tools",
      name: "开发者工具",
      source: "System Tool",
      launchType: "internal",
      category: "tool",
      description: "内置文本转换工具，支持 JSON、URL、Unicode、Base64、随机字符与时间戳转换。",
      iconDataUrl: createAiIconDataUrl(),
      keywords: [
        "developer tools",
        "dev tools",
        "md5",
        "hash",
        "摘要",
        "random",
        "random string",
        "随机",
        "随机字符",
        "随机字符串",
        "urlencode",
        "urldecode",
        "json",
        "json format",
        "json formatter",
        "格式化json",
        "json压缩",
        "unicode",
        "base64",
        "timestamp",
        "时间戳",
        "编码转换",
      ],
      matchBoost: 360,
      acceptsLaunchPayload: true,
    },
    {
      id: "builtin:screen-recorder",
      name: "屏幕录像",
      source: "System Tool",
      launchType: "internal",
      category: "recorder",
      description: "使用 ffmpeg 录制指定屏幕。",
      iconDataUrl: createRecorderIconDataUrl("screen"),
      keywords: ["screen recorder", "record screen", "录屏", "屏幕录制", "录像", "luping"],
      matchBoost: 320,
    },
    {
      id: "builtin:window-recorder",
      name: "应用录像",
      source: "System Tool",
      launchType: "internal",
      category: "recorder",
      description: "使用 ffmpeg 录制指定应用窗口。",
      iconDataUrl: createRecorderIconDataUrl("window"),
      keywords: ["window recorder", "app recorder", "应用录制", "窗口录制", "录像", "yylx"],
      matchBoost: 300,
    },
    {
      id: "builtin:control-panel",
      name: "控制面板",
      source: "System Tool",
      launchType: "command",
      launchTarget: controlExe,
      launchArgs: [],
      iconPath: controlExe,
      keywords: ["control panel", "classic settings", "系统控制面板", "控制中心", "kzmb"],
      matchBoost: 180,
    },
    {
      id: "builtin:device-manager",
      name: "设备管理器",
      source: "System Tool",
      launchType: "command",
      launchTarget: mmcExe,
      launchArgs: [devMgmtMsc],
      iconPath: mmcExe,
      keywords: ["device manager", "devmgmt", "驱动管理", "硬件管理", "sbglq"],
      matchBoost: 220,
    },
    {
      id: "builtin:programs-features",
      name: "卸载或更改程序",
      source: "System Tool",
      launchType: "command",
      launchTarget: controlExe,
      launchArgs: ["appwiz.cpl"],
      iconPath: controlExe,
      keywords: [
        "卸载与更改程序",
        "卸载程序",
        "程序和功能",
        "添加或删除程序",
        "appwiz",
        "programs and features",
        "uninstall programs",
        "xzhggcx",
        "xzbcx",
      ],
      matchBoost: 240,
    },
    {
      id: "builtin:services",
      name: "服务",
      source: "System Tool",
      launchType: "command",
      launchTarget: mmcExe,
      launchArgs: [servicesMsc],
      iconPath: mmcExe,
      keywords: ["services", "services.msc", "系统服务", "fw"],
      matchBoost: 140,
    },
    {
      id: "builtin:disk-management",
      name: "磁盘管理",
      source: "System Tool",
      launchType: "command",
      launchTarget: mmcExe,
      launchArgs: [diskMgmtMsc],
      iconPath: mmcExe,
      keywords: ["disk management", "diskmgmt", "分区管理", "cpgl"],
      matchBoost: 140,
    },
    {
      id: "builtin:computer-management",
      name: "计算机管理",
      source: "System Tool",
      launchType: "command",
      launchTarget: mmcExe,
      launchArgs: [computerMgmtMsc],
      iconPath: mmcExe,
      keywords: ["computer management", "compmgmt", "管理工具", "jsjgl"],
      matchBoost: 120,
    },
    {
      id: "builtin:task-manager",
      name: "任务管理器",
      source: "System Tool",
      launchType: "command",
      launchTarget: taskMgrExe,
      launchArgs: [],
      iconPath: taskMgrExe,
      keywords: ["task manager", "taskmgr", "进程管理", "rwglq"],
      matchBoost: 120,
    },
    {
      id: "builtin:registry-editor",
      name: "注册表编辑器",
      source: "System Tool",
      launchType: "command",
      launchTarget: regeditExe,
      launchArgs: [],
      iconPath: regeditExe,
      keywords: ["registry editor", "regedit", "注册表", "zcbbjq"],
      matchBoost: 120,
    },
    {
      id: "builtin:command-prompt",
      name: "命令提示符",
      source: "System Tool",
      launchType: "command",
      launchTarget: cmdExe,
      launchArgs: [],
      iconPath: cmdExe,
      keywords: ["cmd", "command prompt", "终端", "控制台", "mltsf"],
      matchBoost: 120,
    },
    {
      id: "builtin:powershell",
      name: "PowerShell",
      source: "System Tool",
      launchType: "command",
      launchTarget: powerShellExe,
      launchArgs: [],
      iconPath: powerShellExe,
      keywords: ["powershell", "pwsh", "终端"],
      matchBoost: 120,
    },
    {
      id: "builtin:system-info",
      name: "系统信息",
      source: "System Tool",
      launchType: "command",
      launchTarget: msInfoExe,
      launchArgs: [],
      iconPath: msInfoExe,
      keywords: ["msinfo32", "system information", "xtxx"],
      matchBoost: 120,
    },
    {
      id: "builtin:windows-settings",
      name: "设置",
      source: "System Tool",
      launchType: "command",
      launchTarget: explorerExe,
      launchArgs: ["ms-settings:"],
      iconPath: explorerExe,
      keywords: ["settings", "windows settings", "系统设置", "ms-settings", "sz"],
      matchBoost: 120,
    },
  ];
}

module.exports = {
  getBuiltinSystemTools,
};
