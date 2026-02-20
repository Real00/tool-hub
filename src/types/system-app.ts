export interface SystemAppEntry {
  id: string;
  name: string;
  source: string;
  launchType: "path" | "uwp" | "command";
  acceptsLaunchPayload?: boolean;
  iconDataUrl?: string;
}
