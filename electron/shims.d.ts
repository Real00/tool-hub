declare function require(name: string): any;

declare const __dirname: string;
declare const __filename: string;
declare const module: any;
declare const process: any;
declare const Buffer: any;

declare module "electron" {
  const electron: any;
  export = electron;
}

declare module "sqlite" {
  const sqlite: any;
  export = sqlite;
}

declare module "sqlite3" {
  const sqlite3: any;
  export = sqlite3;
}

declare module "node-pty" {
  const nodePty: any;
  export = nodePty;
}

declare module "openai" {
  const openai: any;
  export = openai;
}

declare module "@anthropic-ai/sdk" {
  const anthropic: any;
  export = anthropic;
}

declare module "electron-updater" {
  const electronUpdater: any;
  export = electronUpdater;
}

declare module "node:*" {
  const nodeBuiltin: any;
  export = nodeBuiltin;
}
