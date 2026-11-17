import type { SsoRule } from "./credential-sso.js";
export interface VaultEntry { id: string; name: string; url: string; username: string; password: string; notes: string; group: string; autoLogin?: boolean; insecure?: boolean }
export type VaultMetadata = Omit<VaultEntry, "password">;
export interface RememberedLoginState { enabled: boolean; entries: Array<{ id: string; url: string; enabled: boolean; insecure?: boolean; name?: string; username?: string; group?: string; notes?: string }> }
export interface VaultSnapshot { httpOrigins?: string[]; ssoRules?: SsoRule[]; remembered?: RememberedLoginState; available: boolean; initialized: boolean; unlocked: boolean; autofill: boolean; entries: VaultMetadata[]; audit: Array<{ id: string; name: string; origin: string; at: number }> }
export interface VaultRequest { action: "http-allow" | "http-remove" | "sso-save" | "sso-remove" | "remember-promote" | "remember-configure" | "remember-remove" | "remember-toggle" | "status" | "initialize" | "unlock" | "lock" | "save" | "remove" | "configure" | "export" | "import" | "fill" | "release"; password?: string; enabled?: boolean; id?: string; url?: string; rule?: Partial<SsoRule>; entry?: Partial<VaultEntry> }
export interface VaultBridge { request(input: VaultRequest): Promise<VaultSnapshot> }
