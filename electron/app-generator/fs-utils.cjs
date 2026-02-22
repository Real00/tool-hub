const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const {
  DEFAULT_VERIFY_COMMAND,
  GENERATOR_DIR_NAME,
  LEGACY_VERIFY_COMMAND,
  METADATA_FILE_NAME,
  TEMPLATE_DIR_REL,
  TEMPLATE_DIR_RESOURCE_SEGMENTS,
  TOOL_HUB_ROOT_DIR,
} = require("./constants.cjs");

function uniqueStrings(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function now() {
  return Date.now();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveToolHubRoot() {
  return path.join(app.getPath("home"), TOOL_HUB_ROOT_DIR);
}

function resolveGeneratorRoot() {
  return path.join(resolveToolHubRoot(), GENERATOR_DIR_NAME);
}

function resolveTemplateDirCandidates() {
  // Keep both dev-time template path and packaged resources path.
  return uniqueStrings([
    path.resolve(__dirname, "..", TEMPLATE_DIR_REL),
    path.join(process.resourcesPath, ...TEMPLATE_DIR_RESOURCE_SEGMENTS),
  ]);
}

function resolveTemplateDir() {
  const candidates = resolveTemplateDirCandidates();
  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    if (fs.existsSync(item) && fs.statSync(item).isDirectory()) {
      return item;
    }
  }
  return candidates[0];
}

function resolveProjectMetadataPath(projectDir) {
  return path.join(projectDir, METADATA_FILE_NAME);
}

function normalizeAppId(value, fallback) {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  return source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeProjectId(value, fallback = "project") {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeTabId(value, fallback = "workspace") {
  const source = String(value ?? fallback ?? "").trim().toLowerCase();
  const normalized = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace";
}

function normalizeVerifyCommand(value) {
  const normalized = String(value ?? "").trim();
  return normalized || DEFAULT_VERIFY_COMMAND;
}

function hasPackageManifest(projectDir) {
  const manifestNames = [
    "package.json",
    "package.yaml",
    "package.yml",
    "package.json5",
  ];
  for (let i = 0; i < manifestNames.length; i += 1) {
    const manifestPath = path.join(projectDir, manifestNames[i]);
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
      return true;
    }
  }
  return false;
}

function isLegacyVerifyCommand(commandInput) {
  return String(commandInput ?? "").trim().toLowerCase() === LEGACY_VERIFY_COMMAND;
}

function normalizeProjectIdInput(projectIdInput) {
  const projectId = String(projectIdInput ?? "").trim();
  if (!projectId) {
    throw new Error("Project id is required.");
  }
  if (projectId.includes("/") || projectId.includes("\\")) {
    throw new Error(`Invalid project id: ${projectId}`);
  }
  return projectId;
}

function resolveProjectDir(projectIdInput) {
  const projectId = normalizeProjectIdInput(projectIdInput);
  const root = resolveGeneratorRoot();
  const projectDir = path.resolve(root, projectId);
  const relative = path.relative(root, projectDir);
  // Reject traversal/absolute escapes so all operations stay inside generator root.
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid project path: ${projectId}`);
  }
  return { projectId, projectDir };
}

function listProjectIds() {
  const root = resolveGeneratorRoot();
  ensureDir(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function sortDirentsByName(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeProjectFilePath(input) {
  const normalized = String(input ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    throw new Error("File path is required.");
  }
  if (normalized.includes("\0")) {
    throw new Error("Invalid file path.");
  }
  return normalized;
}

function resolveProjectFile(projectDir, filePathInput) {
  const filePath = normalizeProjectFilePath(filePathInput);
  const absolutePath = path.resolve(projectDir, filePath);
  const relative = path.relative(projectDir, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path is outside project directory.");
  }
  return {
    absolutePath,
    filePath: relative.replace(/\\/g, "/"),
  };
}

function resolveAutoVerifyCommand(projectDir) {
  // Derive a package-manager-free fallback verify command from app.json entry.
  const manifestPath = path.join(projectDir, "app.json");
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return null;
  }

  let manifest = null;
  try {
    manifest = readJson(manifestPath);
  } catch {
    return null;
  }

  const entryRel = String(manifest?.entry ?? "").trim();
  if (!entryRel) {
    return null;
  }

  let resolved = null;
  try {
    resolved = resolveProjectFile(projectDir, entryRel);
  } catch {
    return null;
  }

  if (
    !resolved?.absolutePath ||
    !fs.existsSync(resolved.absolutePath) ||
    !fs.statSync(resolved.absolutePath).isFile()
  ) {
    return null;
  }

  return `node --check "${resolved.filePath}"`;
}

function encodeErrorPayload(payload) {
  try {
    const json = JSON.stringify(payload ?? {});
    return Buffer.from(json, "utf8").toString("base64url");
  } catch {
    return "";
  }
}

function defaultProjectMetadata() {
  const t = now();
  return {
    createdAt: t,
    updatedAt: t,
  };
}

function readProjectMetadata(projectDir) {
  const metadataPath = resolveProjectMetadataPath(projectDir);
  if (!fs.existsSync(metadataPath)) {
    return defaultProjectMetadata();
  }

  try {
    const parsed = readJson(metadataPath);
    return {
      createdAt: Number(parsed.createdAt ?? now()),
      updatedAt: Number(parsed.updatedAt ?? now()),
    };
  } catch {
    return defaultProjectMetadata();
  }
}

function writeProjectMetadata(projectDir, metadata) {
  const next = {
    createdAt: Number(metadata.createdAt ?? now()),
    updatedAt: Number(metadata.updatedAt ?? now()),
  };
  writeJson(resolveProjectMetadataPath(projectDir), next);
}

function normalizeCapabilityId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCapabilityTarget(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "file" ||
    normalized === "folder" ||
    normalized === "any"
  ) {
    return normalized;
  }
  return "";
}

module.exports = {
  defaultProjectMetadata,
  encodeErrorPayload,
  ensureDir,
  hasPackageManifest,
  isLegacyVerifyCommand,
  listProjectIds,
  normalizeAppId,
  normalizeCapabilityId,
  normalizeCapabilityTarget,
  normalizeProjectId,
  normalizeProjectIdInput,
  normalizeProjectFilePath,
  normalizeTabId,
  normalizeVerifyCommand,
  now,
  readJson,
  readProjectMetadata,
  resolveAutoVerifyCommand,
  resolveGeneratorRoot,
  resolveProjectDir,
  resolveProjectFile,
  resolveProjectMetadataPath,
  resolveTemplateDir,
  resolveTemplateDirCandidates,
  resolveToolHubRoot,
  sortDirentsByName,
  uniqueStrings,
  writeJson,
  writeProjectMetadata,
};
