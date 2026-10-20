export type QuickAccessKind = "file" | "folder";
export type QuickAccessPreset = "downloads" | "desktop" | "documents" | "hosts";

export interface QuickAccessItem {
  id: string;
  name: string;
  path: string;
  kind: QuickAccessKind;
  pinned: boolean;
  preset?: QuickAccessPreset;
}

export interface QuickAccessEntry extends QuickAccessItem {
  availability: "available" | "missing" | "unavailable";
}

export interface QuickAccessSnapshot {
  items: QuickAccessEntry[];
  presets: Array<{ id: QuickAccessPreset; path: string; kind: QuickAccessKind }>;
}

export type QuickAccessMutation =
  | { type: "add"; path: string; name?: string }
  | { type: "update"; id: string; name?: string; path?: string; pinned?: boolean }
  | { type: "remove"; id: string }
  | { type: "reorder"; ids: string[] }
  | { type: "preset"; preset: QuickAccessPreset };

export interface QuickAccessBridge {
  list: () => Promise<QuickAccessSnapshot>;
  mutate: (mutation: QuickAccessMutation) => Promise<QuickAccessSnapshot>;
  pick: (kind: QuickAccessKind) => Promise<string | null>;
  open: (id: string, action?: "open" | "reveal" | "edit-admin" | "copy") => Promise<{ status: "opened" | "cancelled" }>;
  subscribe: (listener: () => void) => () => void;
}
