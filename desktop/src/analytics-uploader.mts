import { randomInt, randomUUID, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hostname, userInfo } from "node:os";
import {
  AnalyticsStore,
  DEFAULT_ANALYTICS_POLICY,
  validateAnalyticsPolicy,
  type AnalyticsConfig,
  type AnalyticsPolicy,
} from "./analytics-store.mjs";
import {
  collectWindowsIdentity,
  type WindowsIdentity,
  type IdentityObservation,
} from "./analytics-windows-identity.mjs";
interface Credential {
  credential_id: string;
  secret: string;
  expires_at?: string;
}
interface Vault {
  registration: Record<string, unknown>;
  current: Credential;
  pending?: Credential;
  rotation_id?: string;
  recovery_pending?: {
    enrollment_key: string;
    body: {
      recovery_id: string;
      installation_id: string;
      previous_credential: Credential;
      next_credential: Credential;
    };
  };
  identity_pending?: { id: string; identity: WindowsIdentity };
}
interface SecureStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(text: string): Promise<Buffer>;
  decryptStringAsync(
    value: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
type Fetcher = typeof fetch;
class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number,
    readonly code?: string,
  ) {
    super("ANALYTICS_HTTP_" + status);
  }
}
export function jitterSeconds(min: number, max: number): number {
  return randomInt(Math.ceil(min), Math.floor(max) + 1);
}
export function retryDelay(failures: number, retryAfter = 0): number {
  return (
    Math.max(
      5,
      jitterSeconds(0, Math.min(1800, 30 * 2 ** Math.min(failures, 10))),
      retryAfter,
    ) + jitterSeconds(0, 30)
  );
}
export class AnalyticsUploader {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private stopped = false;
  private vault!: Vault;
  private failures = 0;
  private displayNameSupported = false;
  private identitySupported = false;
  private capabilityCheckedAt = 0;
  private constructor(
    readonly store: AnalyticsStore,
    private readonly config: AnalyticsConfig,
    private readonly secure: SecureStorage,
    private readonly fetcher: Fetcher = fetch,
    private readonly identityReader: () => Promise<IdentityObservation> = () =>
      collectWindowsIdentity(config.enabled),
    private readonly configReader: () => AnalyticsConfig | undefined = () =>
      config,
  ) {}
  static async create(
    store: AnalyticsStore,
    config: AnalyticsConfig,
    secure: SecureStorage,
    fetcher: Fetcher = fetch,
    identityReader?: () => Promise<IdentityObservation>,
    configReader?: () => AnalyticsConfig | undefined,
  ): Promise<AnalyticsUploader> {
    const uploader = new AnalyticsUploader(
      store,
      config,
      secure,
      fetcher,
      identityReader,
      configReader,
    );
    await uploader.initialize();
    return uploader;
  }
  private async initialize(): Promise<void> {
    const { store, secure } = this;
    if (!(await secure.isAsyncEncryptionAvailable()))
      throw new Error("ANALYTICS_DPAPI_UNAVAILABLE");
    const file = join(store.directory, "credentials.dpapi");
    if (existsSync(file)) {
      const decrypted = await secure.decryptStringAsync(readFileSync(file));
      this.vault = JSON.parse(decrypted.result) as Vault;
      if (decrypted.shouldReEncrypt) await this.saveVault();
    } else {
      const current = {
        credential_id: randomUUID(),
        secret: randomBytes(32).toString("base64url"),
      };
      this.vault = {
        current,
        registration: {
          registration_id: randomUUID(),
          installation_id: store.installationId,
          credential: current,
          windows_username: userInfo().username.slice(0, 128),
          device_label: hostname().slice(0, 128),
          app_version: store.get<string>("app_version") ?? "unknown",
          sdk_version: "pi-runtime",
          protocol_version: "1.0",
          capabilities: [
            "desktop_activity",
            "query",
            "model_usage",
            "file_write",
            "file_edit",
          ],
        },
      };
      await this.saveVault();
    }
  }
  private async saveVault(): Promise<void> {
    const file = join(this.store.directory, "credentials.dpapi"),
      temp = file + ".tmp";
    writeFileSync(
      temp,
      await this.secure.encryptStringAsync(JSON.stringify(this.vault)),
      { mode: 0o600, flush: true },
    );
    renameSync(temp, file);
  }
  private policy(): AnalyticsPolicy {
    return (
      this.store.get<AnalyticsPolicy>("policy") ?? DEFAULT_ANALYTICS_POLICY
    );
  }
  start(): void {
    const due = this.store.get<number>("next_due_at"),
      p = this.policy();
    this.schedule(
      due && due > Date.now()
        ? Math.ceil((due - Date.now()) / 1000)
        : jitterSeconds(
            p.initial_delay_min_seconds,
            p.initial_delay_max_seconds,
          ),
    );
  }
  reconnect(): void {
    if (this.stopped) return;
    const p = this.policy();
    this.schedule(
      jitterSeconds(p.reconnect_min_seconds, p.reconnect_max_seconds),
    );
  }
  private schedule(seconds: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped) return;
    const due = Date.now() + seconds * 1000;
    this.store.set("next_due_at", due);
    const arm = () => {
      if (this.stopped) return;
      // Node timers overflow above ~24.8 days. Keep the persisted deadline and
      // wait in bounded chunks instead of turning a long interval into a 1ms loop.
      this.timer = setTimeout(
        () => {
          if (Date.now() < due) arm();
          else void this.flush();
        },
        Math.min(2_147_483_647, Math.max(0, due - Date.now())),
      );
      this.timer.unref();
    };
    arm();
  }
  private async request(
    path: string,
    body: unknown,
    credential: string,
    idempotency?: string,
  ): Promise<Record<string, unknown>> {
    const started = Date.now(),
      response = await this.fetcher(this.config.backend_url + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Piora-Capabilities": "configurable-sync-interval",
          Authorization: "Bearer " + credential,
          ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      const code = [
        "ENROLLMENT_INVALID",
        "INSTALLATION_REVOKED",
        "CREDENTIAL_RECOVERY_NOT_ALLOWED",
      ].includes(errorBody?.error?.code ?? "")
        ? errorBody?.error?.code
        : undefined;
      throw new UploadError(
        response.status,
        Math.min(
          7200,
          Math.max(0, Number(response.headers.get("Retry-After")) || 0),
        ),
        code,
      );
    }
    const envelope = (await response.json()) as {
      data: Record<string, unknown>;
      meta: { server_time: string };
    };
    if (
      Date.now() - started < 5000 &&
      Number.isFinite(Date.parse(envelope.meta?.server_time))
    ) {
      const offset =
        Date.parse(envelope.meta.server_time) - (started + Date.now()) / 2;
      if (Math.abs(offset) <= 86400000) {
        this.store.set("clock_offset_ms", Math.round(offset));
        this.store.set("clock_sync_at", new Date().toISOString());
      }
    }
    if (envelope.data.policy)
      this.store.set("policy", validateAnalyticsPolicy(envelope.data.policy));
    return envelope.data;
  }
  private bearer(credential = this.vault.current): string {
    return "pa1." + credential.credential_id + "." + credential.secret;
  }
  private async register(): Promise<void> {
    if (this.store.get<boolean>("registered")) return;
    if (!this.config.enrollment_key)
      throw new Error("ANALYTICS_ENROLLMENT_REQUIRED");
    const registrationId = this.vault.registration.registration_id as string;
    const result = await this.request(
      "/v1/installations/register",
      this.vault.registration,
      this.config.enrollment_key,
      registrationId,
    );
    this.vault.current.expires_at = result.credential_expires_at as string;
    await this.saveVault();
    this.store.set("registered", true);
    this.store.set("organization_name", result.organization_name);
  }
  /** Identity is optional: no failure here may pause ordinary telemetry. */
  private async syncIdentity(): Promise<void> {
    if (!this.config.enabled || this.stopped) return;
    try {
      if (Date.now() - this.capabilityCheckedAt > 3600000) {
        this.capabilityCheckedAt = Date.now();
        this.identitySupported = false;
        const response = await this.fetcher(
          this.config.backend_url + "/v1/capabilities",
          {
            method: "GET",
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          },
        );
        if (response.ok) {
          const envelope = (await response.json()) as {
            data?: { capabilities?: unknown };
          };
          this.displayNameSupported =
            Array.isArray(envelope.data?.capabilities) &&
            envelope.data.capabilities.includes("windows-display-name-v1");
          this.identitySupported =
            Array.isArray(envelope.data?.capabilities) &&
            envelope.data.capabilities.includes("windows-domain-identity-v1");
        }
      }
      if (!this.identitySupported) {
        this.store.set("identity_status", "unsupported_backend");
        return;
      }
      if (
        this.vault.identity_pending?.identity.display_name &&
        !this.displayNameSupported
      ) {
        // A downgraded backend requires a new payload and idempotency key.
        delete this.vault.identity_pending.identity.display_name;
        this.vault.identity_pending.id = randomUUID();
      }
      const last = this.store.get<number>("identity_synced_at") ?? 0;
      if (!this.vault.identity_pending && Date.now() - last < 86400000) return;
      if (!this.vault.identity_pending) {
        const observation = await this.identityReader();
        this.store.set("identity_collection_status", observation.status);
        // Do not send the local diagnostic status: the server schema is strict.
        const { account_type, domain, account_name, source } = observation;
        this.vault.identity_pending = {
          id: randomUUID(),
          identity: {
            account_type,
            domain,
            account_name,
            source,
            ...(this.displayNameSupported && observation.display_name
              ? { display_name: observation.display_name }
              : {}),
          },
        };
      }
      // Persist the exact id/body before every attempt, including after a failed save.
      await this.saveVault();
      const pending = this.vault.identity_pending;
      const result = await this.request(
        "/v1/installations/identity",
        { identity: pending.identity },
        this.bearer(),
        pending.id,
      );
      delete this.vault.identity_pending;
      await this.saveVault();
      this.store.set(
        "identity_status",
        typeof result.state === "string" ? result.state : "reported",
      );
      // Refresh daily so policy changes are eventually applied.
      if (pending.identity.account_type !== "unknown")
        this.store.set("identity_synced_at", Date.now());
    } catch {
      this.store.set("identity_status", "retry_pending");
    }
  }
  private async rotate(): Promise<void> {
    if (!this.vault.pending) {
      this.vault.pending = {
        credential_id: randomUUID(),
        secret: randomBytes(32).toString("base64url"),
      };
      this.vault.rotation_id = randomUUID();
    }
    await this.saveVault();
    const body = {
      rotation_id: this.vault.rotation_id,
      next_credential: this.vault.pending,
    };
    let result: Record<string, unknown>;
    try {
      result = await this.request(
        "/v1/installations/credentials/rotate",
        body,
        this.bearer(),
        this.vault.rotation_id,
      );
    } catch (error) {
      if (!(error instanceof UploadError) || error.status !== 401) throw error;
      result = await this.request(
        "/v1/installations/credentials/rotate",
        body,
        this.bearer(this.vault.pending),
        this.vault.rotation_id,
      );
    }
    this.vault.current = {
      ...this.vault.pending,
      expires_at: result.expires_at as string,
    };
    delete this.vault.pending;
    delete this.vault.rotation_id;
    await this.saveVault();
  }
  private async recover(): Promise<void> {
    const config = this.configReader();
    if (!config?.enabled || config.backend_url !== this.config.backend_url)
      throw new Error("ANALYTICS_RECOVERY_CONFIG_INVALID");
    if (!this.vault.recovery_pending) {
      if (!config.enrollment_key)
        throw new Error("ANALYTICS_ENROLLMENT_REQUIRED");
      const { credential_id, secret } = this.vault.current;
      this.vault.recovery_pending = {
        enrollment_key: config.enrollment_key,
        body: {
          recovery_id: randomUUID(),
          installation_id: this.store.installationId,
          previous_credential: { credential_id, secret },
          next_credential: {
            credential_id: randomUUID(),
            secret: randomBytes(32).toString("base64url"),
          },
        },
      };
    }
    // Persist before every attempt. Keep authorization stable across lost responses.
    await this.saveVault();
    const pending = this.vault.recovery_pending;
    this.store.set("recovery_status", "pending");
    let result: Record<string, unknown>;
    try {
      result = await this.request(
        "/v1/installations/credentials/recover",
        pending.body,
        pending.enrollment_key,
        pending.body.recovery_id,
      );
    } catch (error) {
      this.store.set(
        "recovery_status",
        error instanceof UploadError
          ? (error.code ?? "HTTP_" + error.status)
          : "retry_pending",
      );
      // A definite authorization rejection cannot have committed this recovery.
      if (error instanceof UploadError && error.code === "ENROLLMENT_INVALID") {
        delete this.vault.recovery_pending;
        await this.saveVault();
      }
      throw error;
    }
    if (
      result.installation_id !== this.store.installationId ||
      result.credential_id !== pending.body.next_credential.credential_id ||
      typeof result.expires_at !== "string" ||
      !Number.isFinite(Date.parse(result.expires_at))
    )
      throw new Error("ANALYTICS_RECOVERY_RESPONSE_INVALID");
    const original = this.vault;
    this.vault = {
      ...original,
      current: {
        ...pending.body.next_credential,
        expires_at: result.expires_at,
      },
    };
    delete this.vault.recovery_pending;
    delete this.vault.pending;
    delete this.vault.rotation_id;
    try {
      await this.saveVault();
    } catch (error) {
      this.vault = original;
      throw error;
    }
    this.store.set("recovery_status", "recovered");
  }
  private async refreshCredential(): Promise<void> {
    if (this.vault.recovery_pending) return this.recover();
    const expires = Date.parse(this.vault.current.expires_at ?? "");
    if (!this.vault.pending && !(expires - Date.now() < 7 * 86400000)) return;
    try {
      await this.rotate();
    } catch (error) {
      // First try pending rotation material: a lost rotation reply may already
      // have issued a usable credential. Only the server can authorize recovery.
      if (
        !(error instanceof UploadError) ||
        error.status !== 401 ||
        !(expires <= Date.now())
      )
        throw error;
      await this.recover();
    }
  }
  async flush(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      await this.register();
      await this.refreshCredential();
      await this.syncIdentity();
      let policy = this.policy();
      this.store.prune(policy);
      const health = this.store.health(),
        dropped = this.store.get<number>("dropped_total") ?? 0,
        quarantined = this.store.get<number>("quarantined_total") ?? 0;
      let pendingHealth = this.store.get<{
        id: string;
        dropped: number;
        quarantined: number;
      }>("pending_health");
      if (
        !pendingHealth ||
        !this.store.db
          .prepare("SELECT 1 FROM outbox WHERE event_id=?")
          .get(pendingHealth.id)
      ) {
        const id = this.store.record(
          "client.health",
          "health:" + randomUUID(),
          {
            queue_events: String(health.events),
            queue_bytes: String(health.bytes),
            dropped_events: String(
              Math.max(
                0,
                dropped - (this.store.get<number>("reported_dropped") ?? 0),
              ),
            ),
            quarantined_events: String(
              Math.max(
                0,
                quarantined -
                  (this.store.get<number>("reported_quarantined") ?? 0),
              ),
            ),
            clock_offset_ms: this.store.get<number>("clock_offset_ms") ?? 0,
            clock_sync_at: this.store.get<string>("clock_sync_at") ?? null,
            codes: this.store.get<string[]>("health_codes") ?? [],
          },
          this.now(),
        )!;
        pendingHealth = { id, dropped, quarantined };
        this.store.set("pending_health", pendingHealth);
      }
      let sentBatches = 0;
      while (sentBatches < 5 && !this.stopped) {
        policy = this.policy();
        const events = this.store.batch(policy);
        if (!events.length) break;
        const result = await this.request(
          "/v1/telemetry/batches",
          {
            batch_id: randomUUID(),
            protocol_version: "1.0",
            client_sent_at: this.now(),
            policy_version: policy.version,
            events,
          },
          this.bearer(),
        );
        this.store.acknowledge(
          events.map((e) => e.event_id),
          result as {
            accepted_event_ids: string[];
            duplicate_event_ids: string[];
            rejected_events: { event_id: string; code: string }[];
          },
        );
        const confirmed = [
          ...(result.accepted_event_ids as string[]),
          ...(result.duplicate_event_ids as string[]),
        ];
        if (confirmed.includes(pendingHealth.id)) {
          this.store.set("reported_dropped", pendingHealth.dropped);
          this.store.set("reported_quarantined", pendingHealth.quarantined);
          this.store.set("pending_health", null);
        }
        this.store.set("last_success_at", Date.now());
        this.store.set("last_error", null);
        this.store.set("upload_paused", false);
        sentBatches++;
        this.failures = 0;
        if (result.credential_rotation_due) await this.rotate();
        if (
          typeof result.retry_after_seconds === "number" &&
          result.retry_after_seconds > 0
        ) {
          this.schedule(result.retry_after_seconds + jitterSeconds(0, 30));
          return;
        }
        if (this.store.health().events && sentBatches < 5)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, jitterSeconds(10, 30) * 1000);
            timer.unref();
          });
      }
      policy = this.policy();
      this.schedule(
        policy.enabled && this.store.health().events
          ? jitterSeconds(300, 600)
          : jitterSeconds(
              policy.interval_min_seconds,
              policy.interval_max_seconds,
            ),
      );
    } catch (error) {
      const auth =
        error instanceof UploadError && [401, 403].includes(error.status);
      try {
        this.store.set(
          "last_error",
          error instanceof UploadError
            ? "HTTP_" + error.status
            : "UPLOAD_FAILED",
        );
        if (auth) {
          this.store.set("upload_paused", true);
          return;
        }
        this.schedule(
          retryDelay(
            this.failures++,
            error instanceof UploadError ? error.retryAfter : 0,
          ),
        );
      } catch {
        /* A failed SQLite disk must not reject into the desktop event loop. */
      }
    } finally {
      this.busy = false;
    }
  }
  now(): string {
    return new Date(
      Date.now() + (this.store.get<number>("clock_offset_ms") ?? 0),
    ).toISOString();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
