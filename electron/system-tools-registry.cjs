const path = require("node:path");

function getWindowsDir() {
  return process.env.WINDIR || "C:\\Windows";
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
