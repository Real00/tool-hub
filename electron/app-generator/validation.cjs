const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeAppId,
  normalizeCapabilityId,
  normalizeCapabilityTarget,
  normalizeTabId,
  now,
  readJson,
  resolveProjectDir,
  resolveProjectFile,
} = require("./fs-utils.cjs");

function createValidationIssue(level, code, message, filePath = undefined) {
  const issue = {
    code: String(code),
    level: level === "warning" ? "warning" : "error",
    message: String(message),
  };
  if (filePath) {
    issue.path = String(filePath);
  }
  return issue;
}

function createValidationCheck(code, status, message, filePath = undefined) {
  const check = {
    code: String(code),
    status:
      status === "warning" || status === "error"
        ? status
        : "pass",
    message: String(message),
  };
  if (filePath) {
    check.path = String(filePath);
  }
  return check;
}

function validateProject(projectIdInput, requestedTabId) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  const errors = [];
  const warnings = [];
  const checks = [];
  const validatedAt = now();
  const manifestPath = "app.json";
  const manifestAbsPath = path.join(projectDir, manifestPath);
  const requestedTabText = String(requestedTabId ?? "").trim();
  const targetTabId = requestedTabText
    ? normalizeTabId(requestedTabText, "workspace")
    : null;

  function addError(code, message, filePath) {
    const issue = createValidationIssue("error", code, message, filePath);
    errors.push(issue);
    checks.push(createValidationCheck(code, "error", message, filePath));
  }

  function addWarning(code, message, filePath) {
    const issue = createValidationIssue("warning", code, message, filePath);
    warnings.push(issue);
    checks.push(createValidationCheck(code, "warning", message, filePath));
  }

  function addPass(code, message, filePath) {
    checks.push(createValidationCheck(code, "pass", message, filePath));
  }

  // Missing project/manifest are hard-stop errors; return immediately.
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    addError("PROJECT_DIRECTORY_MISSING", "Project directory does not exist.");
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }

  if (!fs.existsSync(manifestAbsPath) || !fs.statSync(manifestAbsPath).isFile()) {
    addError(
      "MANIFEST_NOT_FOUND",
      "app.json is required before install.",
      manifestPath,
    );
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }
  addPass("MANIFEST_EXISTS", "app.json found.", manifestPath);

  let manifest = null;
  try {
    manifest = readJson(manifestAbsPath);
    addPass("MANIFEST_JSON_VALID", "app.json is valid JSON.", manifestPath);
  } catch (error) {
    addError(
      "MANIFEST_JSON_INVALID",
      `app.json cannot be parsed: ${error instanceof Error ? error.message : String(error)}`,
      manifestPath,
    );
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    addError("MANIFEST_OBJECT_REQUIRED", "app.json root must be an object.", manifestPath);
    return {
      projectId,
      validatedAt,
      ok: false,
      errors,
      warnings,
      checks,
      manifestPath,
      normalizedAppId: null,
      targetTabId,
    };
  }

  const normalizedAppId = normalizeAppId(manifest.id, "");
  if (!normalizedAppId) {
    addError("APP_ID_INVALID", "app.json field `id` is required and must be valid.", manifestPath);
  } else {
    addPass("APP_ID_VALID", `App id: ${normalizedAppId}`, manifestPath);
  }

  const appName = String(manifest.name ?? "").trim();
  if (!appName) {
    addError("APP_NAME_REQUIRED", "app.json field `name` is required.", manifestPath);
  } else {
    addPass("APP_NAME_VALID", `App name: ${appName}`, manifestPath);
  }

  const version = String(manifest.version ?? "").trim();
  if (!version) {
    addWarning("APP_VERSION_MISSING", "app.json field `version` is missing.");
  } else {
    addPass("APP_VERSION_PRESENT", `App version: ${version}`, manifestPath);
  }

  const entryRel = String(manifest.entry ?? "").trim();
  if (!entryRel) {
    addError("APP_ENTRY_MISSING", "app.json field `entry` is required.", manifestPath);
  } else {
    try {
      const { absolutePath, filePath } = resolveProjectFile(projectDir, entryRel);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        addError("APP_ENTRY_NOT_FOUND", `Entry file not found: ${filePath}`, filePath);
      } else {
        addPass("APP_ENTRY_OK", `Entry file found: ${filePath}`, filePath);
      }
    } catch (error) {
      addError(
        "APP_ENTRY_INVALID",
        `Invalid entry path: ${error instanceof Error ? error.message : String(error)}`,
        manifestPath,
      );
    }
  }

  const uiPathRaw = manifest.uiPath;
  const uiPath = typeof uiPathRaw === "string" ? uiPathRaw.trim() : "";
  if (typeof uiPathRaw !== "undefined" && typeof uiPathRaw !== "string") {
    addError("UI_PATH_INVALID_TYPE", "`uiPath` must be a string when provided.", manifestPath);
  } else if (uiPath) {
    try {
      const { absolutePath, filePath } = resolveProjectFile(projectDir, uiPath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        addError("UI_PATH_NOT_FOUND", `uiPath file not found: ${filePath}`, filePath);
      } else {
        addPass("UI_PATH_OK", `uiPath file found: ${filePath}`, filePath);
      }
    } catch (error) {
      addError(
        "UI_PATH_INVALID",
        `Invalid uiPath: ${error instanceof Error ? error.message : String(error)}`,
        manifestPath,
      );
    }
  } else {
    addPass("UI_PATH_OPTIONAL", "uiPath is optional.");
  }

  const uiUrlRaw = manifest.uiUrl;
  const uiUrl = typeof uiUrlRaw === "string" ? uiUrlRaw.trim() : "";
  if (typeof uiUrlRaw !== "undefined" && typeof uiUrlRaw !== "string") {
    addError("UI_URL_INVALID_TYPE", "`uiUrl` must be a string when provided.", manifestPath);
  } else if (uiUrl) {
    if (!/^https?:\/\//i.test(uiUrl)) {
      addError("UI_URL_INVALID", "uiUrl must start with http:// or https://.", manifestPath);
    } else {
      addPass("UI_URL_OK", `uiUrl is valid: ${uiUrl}`, manifestPath);
    }
  } else {
    addPass("UI_URL_OPTIONAL", "uiUrl is optional.");
  }

  if (uiPath && uiUrl) {
    addWarning(
      "UI_PATH_AND_URL_BOTH_SET",
      "Both uiPath and uiUrl are set; uiUrl takes precedence when app opens.",
      manifestPath,
    );
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "env")) {
    if (
      manifest.env &&
      typeof manifest.env === "object" &&
      !Array.isArray(manifest.env)
    ) {
      addPass("ENV_OBJECT_OK", "`env` is an object.", manifestPath);
    } else {
      addWarning("ENV_NOT_OBJECT", "`env` should be an object.", manifestPath);
    }
  } else {
    addPass("ENV_OPTIONAL", "`env` is optional.");
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "capabilities")) {
    if (!Array.isArray(manifest.capabilities)) {
      addError(
        "CAPABILITIES_NOT_ARRAY",
        "`capabilities` must be an array when provided.",
        manifestPath,
      );
    } else {
      const seenCapabilityIds = new Set();
      let hasCapabilityError = false;
      for (let i = 0; i < manifest.capabilities.length; i += 1) {
        const item = manifest.capabilities[i];
        const itemPath = `${manifestPath}#capabilities[${i}]`;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          hasCapabilityError = true;
          addError(
            "CAPABILITY_ITEM_INVALID",
            "Each capability must be an object.",
            itemPath,
          );
          continue;
        }

        const capabilityId = normalizeCapabilityId(item.id);
        const capabilityName = String(item.name ?? "").trim();
        if (!capabilityId) {
          hasCapabilityError = true;
          addError(
            "CAPABILITY_ID_INVALID",
            "Capability `id` is required and must be valid.",
            itemPath,
          );
        } else if (seenCapabilityIds.has(capabilityId)) {
          hasCapabilityError = true;
          addError(
            "CAPABILITY_ID_DUPLICATE",
            `Duplicate capability id: ${capabilityId}`,
            itemPath,
          );
        } else {
          seenCapabilityIds.add(capabilityId);
        }

        if (!capabilityName) {
          hasCapabilityError = true;
          addError(
            "CAPABILITY_NAME_REQUIRED",
            "Capability `name` is required.",
            itemPath,
          );
        }

        if (!Array.isArray(item.targets)) {
          hasCapabilityError = true;
          addError(
            "CAPABILITY_TARGETS_NOT_ARRAY",
            "Capability `targets` must be an array.",
            itemPath,
          );
          continue;
        }
        const parsedTargets = [];
        const seenTargets = new Set();
        // Normalize and de-duplicate targets while preserving input order.
        for (let j = 0; j < item.targets.length; j += 1) {
          const normalizedTarget = normalizeCapabilityTarget(item.targets[j]);
          if (!normalizedTarget || seenTargets.has(normalizedTarget)) {
            continue;
          }
          seenTargets.add(normalizedTarget);
          parsedTargets.push(normalizedTarget);
        }
        if (parsedTargets.length === 0) {
          hasCapabilityError = true;
          addError(
            "CAPABILITY_TARGETS_EMPTY",
            "Capability `targets` must contain file/folder/any.",
            itemPath,
          );
          continue;
        }
      }
      if (!hasCapabilityError) {
        addPass(
          "CAPABILITIES_OK",
          `Capabilities validated (${manifest.capabilities.length} item(s)).`,
          manifestPath,
        );
      }
    }
  } else {
    addPass("CAPABILITIES_OPTIONAL", "`capabilities` is optional.");
  }

  if (!requestedTabText) {
    addWarning(
      "TARGET_TAB_EMPTY",
      "Target tab is empty; install flow will fallback to workspace.",
    );
  } else {
    addPass(
      "TARGET_TAB_SET",
      `Target tab: ${targetTabId}`,
    );
  }

  return {
    projectId,
    validatedAt,
    ok: errors.length === 0,
    errors,
    warnings,
    checks,
    manifestPath,
    normalizedAppId: normalizedAppId || null,
    targetTabId,
  };
}

module.exports = {
  createValidationCheck,
  createValidationIssue,
  validateProject,
};
