// @ts-nocheck
// Public facade for generator runtime APIs.
// Keep this file stable so IPC callers do not depend on internal module layout.
const {
  createProject,
  getProject,
  listProjects,
  readProjectFile,
  updateProjectAgentsRules,
} = require("./app-generator/project-store");
const {
  getProjectTerminal,
  resizeProjectTerminal,
  sendProjectTerminalInput,
  startProjectTerminal,
  stopProjectTerminal,
  subscribeProjectTerminal,
} = require("./app-generator/terminal-runtime");
const { validateProject } = require("./app-generator/validation");
const {
  detectClaudeCli,
  getGeneratorSettings,
  saveGeneratorSettings,
} = require("./app-generator/claude-cli");
const {
  installProjectApp,
  runProjectVerify,
} = require("./app-generator/install-flow");

module.exports = {
  // Project store.
  createProject,
  getProject,
  listProjects,
  readProjectFile,
  updateProjectAgentsRules,

  // Validation and install flow.
  validateProject,
  runProjectVerify,
  installProjectApp,

  // Terminal lifecycle.
  getProjectTerminal,
  resizeProjectTerminal,
  sendProjectTerminalInput,
  subscribeProjectTerminal,
  startProjectTerminal,
  stopProjectTerminal,

  // Claude CLI settings and detection.
  getGeneratorSettings,
  saveGeneratorSettings,
  detectClaudeCli,
};
