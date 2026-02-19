export interface SystemAppEntry {
  id: string;
  name: string;
  source: string;
  launchType: "path" | "uwp" | "command";
  iconDataUrl?: string;
}
