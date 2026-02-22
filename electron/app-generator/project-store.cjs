const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_FILE_READ_BYTES,
  METADATA_FILE_NAME,
  TEMPLATE_AGENTS_ASSET_FILE_NAME,
  TEMPLATE_AGENTS_FILE_NAME,
} = require("./constants.cjs");
const {
  defaultProjectMetadata,
  ensureDir,
  listProjectIds,
  normalizeAppId,
  normalizeProjectId,
  now,
  readJson,
  readProjectMetadata,
  resolveGeneratorRoot,
  resolveProjectDir,
  resolveProjectFile,
  resolveTemplateDir,
  resolveTemplateDirCandidates,
  sortDirentsByName,
  uniqueStrings,
  writeJson,
  writeProjectMetadata,
} = require("./fs-utils.cjs");
const { ensureTerminalState } = require("./terminal-runtime.cjs");

function readManifestSummary(projectDir) {
  const manifestPath = path.join(projectDir, "app.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      hasManifest: false,
      appId: null,
      appName: null,
      version: null,
    };
  }

  try {
    const manifest = readJson(manifestPath);
    return {
      hasManifest: true,
      appId: normalizeAppId(manifest.id, "") || null,
      appName: String(manifest.name ?? "").trim() || null,
      version: String(manifest.version ?? "").trim() || null,
    };
  } catch {
    return {
      hasManifest: true,
      appId: null,
      appName: null,
      version: null,
    };
  }
}

function createStarterManifest(projectDir, projectId) {
  const manifestPath = path.join(projectDir, "app.json");
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  let manifest = {};
  try {
    manifest = readJson(manifestPath);
  } catch {
    manifest = {};
  }

  const suffix = Date.now().toString(36);
  const appId = normalizeAppId(manifest.id, projectId) || `generated-${suffix}`;
  const next = {
    ...manifest,
    id: appId,
    name: String(manifest.name ?? `Generated App ${appId}`).trim() || `Generated App ${appId}`,
    version: String(manifest.version ?? "0.1.0").trim() || "0.1.0",
    entry: String(manifest.entry ?? "src/index.js").trim() || "src/index.js",
    uiPath: String(manifest.uiPath ?? "ui/index.html").trim() || "ui/index.html",
    env: manifest.env && typeof manifest.env === "object" ? manifest.env : {},
  };
  writeJson(manifestPath, next);
}

function collectProjectFiles(projectDir) {
  const results = [];
  // Skip heavy/generated/internal files when building project tree for UI.
  const excludedNames = new Set(["node_modules", ".git", METADATA_FILE_NAME]);

  function walk(relativeDir) {
    const absoluteDir = relativeDir ? path.join(projectDir, relativeDir) : projectDir;
    const dirents = sortDirentsByName(fs.readdirSync(absoluteDir, { withFileTypes: true }));

    for (let i = 0; i < dirents.length; i += 1) {
      const dirent = dirents[i];
      if (excludedNames.has(dirent.name)) {
        continue;
      }

      const relativePath = relativeDir
        ? `${relativeDir.replace(/\\/g, "/")}/${dirent.name}`
        : dirent.name;
      const absolutePath = path.join(projectDir, relativePath);
      const stat = fs.statSync(absolutePath);
      if (dirent.isDirectory()) {
        results.push({
          path: relativePath.replace(/\\/g, "/"),
          type: "directory",
          size: 0,
          modifiedAt: stat.mtimeMs,
        });
        walk(relativePath);
      } else if (dirent.isFile()) {
        results.push({
          path: relativePath.replace(/\\/g, "/"),
          type: "file",
          size: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      }
    }
  }

  walk("");
  return results;
}

function buildProjectSummary(projectId) {
  const { projectDir } = resolveProjectDir(projectId);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Project directory not found: ${projectDir}`);
  }

  const metadata = readProjectMetadata(projectDir);
  const terminal = ensureTerminalState(projectId, {
    updatedAt: metadata.updatedAt,
  });
  const files = collectProjectFiles(projectDir);
  const manifest = readManifestSummary(projectDir);

  return {
    projectId,
    projectDir,
    createdAt: metadata.createdAt,
    updatedAt: Math.max(metadata.updatedAt, terminal.updatedAt),
    running: Boolean(terminal.running),
    fileCount: files.filter((item) => item.type === "file").length,
    ...manifest,
  };
}

function buildProjectDetail(projectId) {
  const summary = buildProjectSummary(projectId);
  const files = collectProjectFiles(summary.projectDir);

  return {
    ...summary,
    files,
  };
}

function listProjects() {
  return listProjectIds()
    .map((projectId) => buildProjectSummary(projectId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function ensureUniqueProjectId(baseId) {
  const root = resolveGeneratorRoot();
  let candidate = baseId;
  let index = 2;

  while (fs.existsSync(path.join(root, candidate))) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }

  return candidate;
}

function createProject(projectName) {
  const templateCandidates = resolveTemplateDirCandidates();
  const templateDir = resolveTemplateDir();
  if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
    throw new Error(
      `Template directory not found. Checked: ${templateCandidates.join(" | ")}`,
    );
  }

  const root = resolveGeneratorRoot();
  ensureDir(root);
  const rawName = String(projectName ?? "").trim();
  const baseId = normalizeProjectId(rawName, `project-${Date.now().toString(36)}`);
  const projectId = ensureUniqueProjectId(baseId);
  const projectDir = path.join(root, projectId);

  // Bootstrap from the shipped template directory.
  fs.cpSync(templateDir, projectDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  createStarterManifest(projectDir, projectId);

  const metadata = defaultProjectMetadata();
  writeProjectMetadata(projectDir, metadata);
  ensureTerminalState(projectId);

  return buildProjectDetail(projectId);
}

function getProject(projectId) {
  return buildProjectDetail(projectId);
}

function readProjectFile(projectIdInput, filePathInput) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  const { absolutePath, filePath } = resolveProjectFile(projectDir, filePathInput);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const truncated = buffer.byteLength > MAX_FILE_READ_BYTES;
  const content = truncated
    ? buffer.subarray(0, MAX_FILE_READ_BYTES).toString("utf8")
    : buffer.toString("utf8");

  return {
    projectId,
    filePath,
    content,
    truncated,
  };
}

function resolveTemplateAgentsSourcePath() {
  const templateCandidates = resolveTemplateDirCandidates().map((templateDir) =>
    path.join(templateDir, TEMPLATE_AGENTS_FILE_NAME),
  );
  const candidates = uniqueStrings([
    ...templateCandidates,
    path.join(__dirname, "..", "assets", TEMPLATE_AGENTS_ASSET_FILE_NAME),
    path.join(process.resourcesPath, "assets", TEMPLATE_AGENTS_ASSET_FILE_NAME),
  ]);

  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    if (fs.existsSync(item) && fs.statSync(item).isFile()) {
      return item;
    }
  }

  throw new Error(
    `Template AGENTS.md not found. Checked: ${candidates.join(" | ")}`,
  );
}

function updateProjectAgentsRules(projectIdInput) {
  const { projectId, projectDir } = resolveProjectDir(projectIdInput);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const templateAgentsPath = resolveTemplateAgentsSourcePath();

  const targetPath = path.join(projectDir, TEMPLATE_AGENTS_FILE_NAME);
  fs.copyFileSync(templateAgentsPath, targetPath);

  const metadata = readProjectMetadata(projectDir);
  metadata.updatedAt = now();
  writeProjectMetadata(projectDir, metadata);

  const terminal = ensureTerminalState(projectId);
  terminal.updatedAt = metadata.updatedAt;

  return {
    projectId,
    filePath: TEMPLATE_AGENTS_FILE_NAME,
    updatedAt: metadata.updatedAt,
    project: buildProjectDetail(projectId),
  };
}

module.exports = {
  buildProjectDetail,
  buildProjectSummary,
  collectProjectFiles,
  createProject,
  getProject,
  listProjects,
  readProjectFile,
  readManifestSummary,
  updateProjectAgentsRules,
};
