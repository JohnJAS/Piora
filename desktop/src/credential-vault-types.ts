export interface VaultEntry { id: string; name: string; url: string; username: string; password: string; notes: string; group: string; autoLogin?: boolean }
export type VaultMetadata = Omit<VaultEntry, "password">;
export interface RememberedLoginState { enabled: boolean; entries: Array<{ id: string; url: string; enabled: boolean }> }
export interface VaultSnapshot { remembered?: RememberedLoginState; available: boolean; initialized: boolean; unlocked: boolean; autofill: boolean; entries: VaultMetadata[]; audit: Array<{ id: string; name: string; origin: string; at: number }> }
export interface VaultRequest { action: "remember-configure" | "remember-remove" | "remember-toggle" | "status" | "initialize" | "unlock" | "lock" | "save" | "remove" | "configure" | "export" | "import" | "fill" | "release"; password?: string; enabled?: boolean; id?: string; entry?: Partial<VaultEntry> }
export interface VaultBridge { request(input: VaultRequest): Promise<VaultSnapshot> }
