const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CONTEXT_MENU_SWITCH = "--th-context";
const CONTEXT_MENU_LABEL = "用 Tool Hub 处理...";
const FILE_CONTEXT_MENU_KEY = "HKCU\\Software\\Classes\\*\\shell\\ToolHub.Dispatch";
const DIRECTORY_CONTEXT_MENU_KEY =
  "HKCU\\Software\\Classes\\Directory\\shell\\ToolHub.Dispatch";

function isWindows() {
  return process.platform === "win32";
}

function quoteCommandPart(part) {
  return `"${String(part ?? "").replace(/"/g, '\\"')}"`;
}

function buildContextMenuCommand() {
  if (process.defaultApp) {
    const appEntry = String(process.argv[1] ?? "").trim();
    if (!appEntry) {
      return `${quoteCommandPart(process.execPath)} ${CONTEXT_MENU_SWITCH} "%1"`;
    }
    const resolvedEntry = path.resolve(appEntry);
    return `${quoteCommandPart(process.execPath)} ${quoteCommandPart(resolvedEntry)} ${CONTEXT_MENU_SWITCH} "%1"`;
  }
  return `${quoteCommandPart(process.execPath)} ${CONTEXT_MENU_SWITCH} "%1"`;
}

function runRegAdd(args) {
  execFileSync("reg.exe", ["add", ...args], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function registerContextMenuForKey(key, command) {
  runRegAdd([key, "/ve", "/t", "REG_SZ", "/d", CONTEXT_MENU_LABEL, "/f"]);
  runRegAdd([key, "/v", "Icon", "/t", "REG_SZ", "/d", process.execPath, "/f"]);
  runRegAdd([
    `${key}\\command`,
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    command,
    "/f",
  ]);
}

function registerWindowsContextMenu() {
  if (!isWindows()) {
    return {
      registered: false,
      reason: "non-windows",
    };
  }
  const command = buildContextMenuCommand();
  registerContextMenuForKey(FILE_CONTEXT_MENU_KEY, command);
  registerContextMenuForKey(DIRECTORY_CONTEXT_MENU_KEY, command);
  return {
    registered: true,
    command,
    switchName: CONTEXT_MENU_SWITCH,
  };
}

function collectContextTargetsFromArgv(argvInput) {
  const argv = Array.isArray(argvInput) ? argvInput : [];
  const targets = [];

  function stripWrappedQuotes(input) {
    let value = String(input ?? "").trim();
    for (let i = 0; i < 3; i += 1) {
      if (value.length < 2) {
        break;
      }
      const first = value[0];
      const last = value[value.length - 1];
      if (
        (first === "\"" && last === "\"") ||
        (first === "'" && last === "'")
      ) {
        value = value.slice(1, -1).trim();
        continue;
      }
      break;
    }
    return value;
  }

  function normalizePathToken(rawInput) {
    const text = String(rawInput ?? "").trim();
    if (!text) {
      return "";
    }
    const unquoted = stripWrappedQuotes(text);
    if (!unquoted || unquoted.startsWith("-")) {
      return "";
    }
    if (!path.win32.isAbsolute(unquoted)) {
      return "";
    }
    return path.win32.normalize(unquoted);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token) {
      continue;
    }
    if (token === CONTEXT_MENU_SWITCH) {
      // Some Electron/Chromium flags can appear between switch and payload.
      for (let j = i + 1; j < Math.min(argv.length, i + 6); j += 1) {
        const next = normalizePathToken(argv[j]);
        if (!next) {
          continue;
        }
        targets.push(next);
        i = j;
        break;
      }
      continue;
    }
    if (token.startsWith(`${CONTEXT_MENU_SWITCH}=`)) {
      const inlineValue = normalizePathToken(
        token.slice(CONTEXT_MENU_SWITCH.length + 1),
      );
      if (inlineValue) {
        targets.push(inlineValue);
      }
    }
  }
  return targets;
}

module.exports = {
  collectContextTargetsFromArgv,
  registerWindowsContextMenu,
};
