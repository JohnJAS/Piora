"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { useLaboratorySettings } from "@/hooks/useLaboratorySettings";
import { useDefaultToolPermission } from "@/hooks/useDefaultToolPermission";
import { useCharacterDirectorState } from "@/hooks/useCharacterDirectorState";
import type { AttachedFile } from "@/hooks/useAgentSession";
import { fetchModelCatalog, type ModelCatalogEntry } from "@/lib/model-catalog-client";
import { buildSessionProjectGroups } from "@/lib/session-project-groups";
import type { SessionInfo } from "@/lib/types";
import type { SystemPromptSelection } from "@/lib/system-prompt-types";
import { AliIcon } from "./AliIcon";
import {
  ChatInput,
  type AttachedImage,
  type ChatInputHandle,
} from "./ChatInput";
import { DirectoryPicker } from "./DirectoryPicker";
import { NewSessionLauncher } from "./NewSessionLauncher";
import { NewSessionContextMenu, type ProjectChoice, type WorktreeChoice } from "./new-session/NewSessionContextMenu";
import { HIDDEN_PROJECTS_STORAGE_KEY, REMEMBERED_PROJECTS_STORAGE_KEY, loadStoredStringSet } from "./sidebar/sidebar-utils";
import type { NewSessionLaunch } from "./new-session-types";
import styles from "./NewSessionProjectPicker.module.css";
import { SystemPromptSelector } from "./SystemPromptSelector";
import { savePendingPrompt } from "@/lib/prompt-recovery";
import type { ChatInputOptions } from "@/lib/chat-command-types";
import { persistentChatInputOptions } from "@/lib/chat-command-input";
import { DEFAULT_WORKFLOW_TURN_BUDGET } from "@/lib/workflow-types";

function createLaunchId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function NewSessionProjectPicker({
  activeCwd,
  activeProjectRoot,
  chatInputRef,
  onLaunch,
  onProjectSelected,
  projectPickerRequestKey = 0,
}: {
  activeCwd?: string | null;
  activeProjectRoot?: string | null;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  onLaunch: (request: NewSessionLaunch) => void;
  onProjectSelected?: (cwd: string | null) => void;
  projectPickerRequestKey?: number;
}) {
  const { t } = useI18n();
  const publishCharacterComposer = useCharacterDirectorState(true, "idle");
  const laboratory = useLaboratorySettings();
  const { state: toolPermission, saving: permissionSaving, savingRef: permissionSavingRef, error: permissionError, save: handleToolPermission } = useDefaultToolPermission();
  const localChatInputRef = useRef<ChatInputHandle>(null);
  const effectiveChatInputRef = chatInputRef ?? localChatInputRef;
  const draftKey = useRef(`new-task:${createLaunchId()}`).current;
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsReloadKey, setModelsReloadKey] = useState(0);
  const [loadedModelCwd, setLoadedModelCwd] = useState<string | null | undefined>(undefined);
  const [projectlessCwd, setProjectlessCwd] = useState<string | null>(null);
  const [projectlessError, setProjectlessError] = useState<string | null>(null);
  const [projectlessReloadKey, setProjectlessReloadKey] = useState(0);
  const [selectedProject, setSelectedProject] = useState<ProjectChoice | null>(null);
  const [addedProjects, setAddedProjects] = useState<ProjectChoice[]>([]);
  const [worktree, setWorktree] = useState<WorktreeChoice | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const gitBusyRef = useRef(false);
  const worktreeAttempt = useRef<{ cwd: string; startBranch: string | null; branch: string } | null>(null);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [projectValidating, setProjectValidating] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [systemPromptSelection, setSystemPromptSelection] = useState<SystemPromptSelection>({ mode: "default" });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/sessions?view=metadata", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { sessions?: SessionInfo[] };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!cancelled) setSessions(data.sessions ?? []);
      })
      .catch(() => { /* An empty recent-project list is still usable. */ })
      .finally(() => { if (!cancelled) setSessionsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setProjectlessCwd(null);
    setProjectlessError(null);
    void fetch("/api/chat-workspace", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setProjectlessCwd(data.cwd);
      })
      .catch((error) => {
        if (controller.signal.aborted || cancelled) return;
        setProjectlessError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; controller.abort(); };
  }, [projectlessReloadKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const requestCwd = selectedProject?.cwd;
    setModelsLoading(true);
    setModelsError(null);
    setLoadedModelCwd(undefined);
    void fetchModelCatalog({
      cwd: requestCwd,
      forceRefresh: modelsReloadKey > 0,
      signal: controller.signal,
    })
      .then((data) => {
        if (cancelled) return;
        const nextModels = data.modelList ?? [];
        setModels(nextModels);
        setModelsError(data.modelError ?? null);
        setSelectedModelKey((current) => {
          if (nextModels.some((model) => `${model.provider}/${model.id}` === current)) return current;
          const preferred = data.defaultModel
            ? `${data.defaultModel.provider}/${data.defaultModel.modelId}`
            : "";
          if (preferred && nextModels.some((model) => `${model.provider}/${model.id}` === preferred)) return preferred;
          const first = nextModels[0];
          return first ? `${first.provider}/${first.id}` : "";
        });
        setLoadedModelCwd(requestCwd ?? null);
      })
      .catch((error) => {
        if (controller.signal.aborted || cancelled) return;
        setModels([]);
        setSelectedModelKey("");
        setModelsError(error instanceof Error ? error.message : String(error));
        setLoadedModelCwd(requestCwd ?? null);
      })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [modelsReloadKey, selectedProject?.cwd]);

  const [projectRegistry, setProjectRegistry] = useState(() => ({
    remembered: new Set<string>(),
    hidden: new Set<string>(),
  }));
  useEffect(() => {
    setProjectRegistry({
      remembered: loadStoredStringSet(REMEMBERED_PROJECTS_STORAGE_KEY),
      hidden: loadStoredStringSet(HIDDEN_PROJECTS_STORAGE_KEY),
    });
  }, []);

  const projects = useMemo<ProjectChoice[]>(() => {
    const { hidden, remembered } = projectRegistry;
    const groups = buildSessionProjectGroups(
      sessions.filter((session) => !session.projectless),
      activeCwd ? { cwd: activeCwd, projectRoot: activeProjectRoot } : null,
      [...remembered].map((cwd) => ({ cwd })),
    );
    const choices = new Map(groups.filter((group) => !hidden.has(group.projectRoot))
      .map((group) => [group.projectRoot, { root: group.projectRoot, cwd: group.preferredCwd }]));
    for (const project of addedProjects) choices.set(project.root, project);
    return [...choices.values()];
  }, [activeCwd, activeProjectRoot, addedProjects, projectRegistry, sessions]);

  const selectedModel = useMemo(() => {
    const match = models.find((model) => `${model.provider}/${model.id}` === selectedModelKey);
    return match ? { provider: match.provider, modelId: match.id } : null;
  }, [models, selectedModelKey]);

  const launchReady = Boolean(
    selectedModel
    && !modelsLoading
    && loadedModelCwd === (selectedProject?.cwd ?? null)
    && (selectedProject || projectlessCwd),
  );

  const changeWorktree = useCallback((choice: WorktreeChoice | null) => {
    setWorktree(choice);
    setProjectError(null);
  }, []);

  const changeGitBusy = useCallback((busy: boolean) => {
    gitBusyRef.current = busy;
    setGitBusy(busy);
  }, []);

  const chooseProject = useCallback((project: ProjectChoice | null) => {
    setSelectedProject(project);
    onProjectSelected?.(project?.cwd ?? null);
    changeWorktree(null);
    window.requestAnimationFrame(() => effectiveChatInputRef.current?.focus());
  }, [changeWorktree, effectiveChatInputRef, onProjectSelected]);

  const validateAndChooseProject = useCallback(async (candidate: string) => {
    if (projectValidating) return;
    setProjectValidating(true);
    setProjectError(null);
    try {
      const response = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: candidate }),
      });
      const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!response.ok || !data.cwd) throw new Error(data.error ?? `HTTP ${response.status}`);
      const project = { root: data.cwd, cwd: data.cwd };
      setAddedProjects((previous) => [...previous.filter((entry) => entry.root !== project.root), project]);
      chooseProject(project);
      setDirectoryPickerOpen(false);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectValidating(false);
    }
  }, [chooseProject, projectValidating]);

  const browseForProject = useCallback(async () => {
    setProjectError(null);
    const selectDirectory = window.piDesktop?.selectDirectory;
    if (!selectDirectory) {
      setDirectoryPickerOpen(true);
      return;
    }
    try {
      const selected = await selectDirectory();
      if (selected) await validateAndChooseProject(selected);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  }, [validateAndChooseProject]);

  const handleLandingSend = useCallback(async (
    message: string,
    images?: AttachedImage[],
    files?: AttachedFile[],
    onDurable?: (clientPromptId?: string) => void,
    retryOfPromptIds?: string[],
    commandInput?: ChatInputOptions,
  ): Promise<boolean> => {
    if (permissionSavingRef.current || gitBusyRef.current) return false;
    const cwd = selectedProject?.cwd ?? projectlessCwd;
    const commandSubmission = commandInput?.inputMode !== "text" && message.trimStart().startsWith("/");
    if (!cwd || !commandSubmission && (!selectedModel || !launchReady)) return false;
    let launchCwd = cwd;
    let projectRoot = selectedProject?.root ?? null;
    if (selectedProject && worktree) {
      setProjectError(null);
      changeGitBusy(true);
      try {
        const previous = worktreeAttempt.current;
        const branch = previous?.cwd === cwd && previous.startBranch === worktree.branch
          ? previous.branch : "piora/chat-" + createLaunchId();
        worktreeAttempt.current = { cwd, startBranch: worktree.branch, branch };
        const response = await fetch("/api/worktrees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, branch, startBranch: worktree.branch }),
        });
        const data = await response.json() as { path?: string; projectRoot?: string; error?: string };
        if (!response.ok || !data.path || !data.projectRoot) throw new Error(data.error ?? "HTTP " + response.status);
        launchCwd = data.path;
        projectRoot = data.projectRoot;
      } catch (error) {
        setProjectError(t("newSession.worktreeFailed", { error: error instanceof Error ? error.message : String(error) }));
        return false;
      } finally {
        changeGitBusy(false);
      }
    }
    const id = createLaunchId();
    const shell = !images?.length && !files?.length && message.trimStart().startsWith("!");
    if (!shell) {
      const draft = { value: message, images: (images ?? []).map(({ data, mimeType }) => ({ data, mimeType })), files: (files ?? []).map(file => ({ ...file })), commandInput: persistentChatInputOptions(commandInput), ...(retryOfPromptIds?.length ? { retryOfPromptIds } : {}) };
      await savePendingPrompt({ id, scope: `new:${launchCwd}`, draft, message: { role: "user", content: message, timestamp: Date.now(), clientPromptId: id, ...(commandSubmission ? { commandSubmission: true } : {}), recoveryDraft: draft } });
      onDurable?.(id);
    }
    onLaunch({
      cwd: launchCwd,
      projectRoot,
      model: selectedModel ?? undefined,
      prompt: {
        id,
        message,
        images,
        files,
        systemPromptSelection,
        permissionMode: toolPermission?.mode,
        commandInput: { ...persistentChatInputOptions(commandInput), ...(!shell ? { submissionId: id } : {}) },
        retryOfPromptIds,
      },
    });
    return true;
  }, [changeGitBusy, launchReady, onLaunch, projectlessCwd, selectedModel, selectedProject, systemPromptSelection, t, toolPermission, permissionSavingRef, worktree]);

  const modelsUnavailable = !modelsLoading && models.length === 0;
  const modelSelectionBlocked = modelsLoading
    || !selectedModel
    || loadedModelCwd !== (selectedProject?.cwd ?? null);

  return (
    <>
      {permissionError && <p role="alert">{permissionError}</p>}
      <NewSessionLauncher>
        {!laboratory.ready && laboratory.error && <div className={styles.statusRow} role="alert">{t("laboratory.error")} <button type="button" onClick={() => { void laboratory.refresh(); }}>{t("workflow.refresh")}</button></div>}
        <ChatInput
          ref={effectiveChatInputRef}
          variant="launcher"
          onSend={handleLandingSend}
          onCharacterActivity={publishCharacterComposer}
          onAbort={() => {}}
          isStreaming={false}
          workflow={laboratory.planGoalEnabled ? { mode: "agent", turnBudget: DEFAULT_WORKFLOW_TURN_BUDGET } : undefined}
          workflowEnabled={laboratory.ready ? laboratory.planGoalEnabled : undefined}
          sendDisabled={!laboratory.ready || gitBusy || !selectedProject && !projectlessCwd}
          toolPermission={toolPermission}
          permissionSaving={permissionSaving}
          onToolPermissionChange={handleToolPermission}
          model={selectedModel}
          isAutoModelSelection={modelSelectionBlocked}
          modelList={models}
          modelError={models.length > 0 ? modelsError : null}
          onModelChange={async (provider, modelId) => {
            setSelectedModelKey(`${provider}/${modelId}`);
            return true;
          }}
          draftKey={draftKey}
          cwd={selectedProject?.cwd ?? null}
          placeholder={selectedProject ? t("newSession.placeholder") : t("newSession.placeholderWithoutProject")}
          contextControl={(
            <NewSessionContextMenu
              projects={projects}
              project={selectedProject}
              loadingProjects={sessionsLoading}
              requestKey={projectPickerRequestKey}
              disabled={gitBusy || projectValidating || directoryPickerOpen}
              worktree={worktree}
              onProject={chooseProject}
              onBrowse={() => void browseForProject()}
              onWorktree={changeWorktree}
              onGitBusyChange={changeGitBusy}
            />
          )}
          toolbarControl={(
            <SystemPromptSelector
              selection={systemPromptSelection}
              onChange={setSystemPromptSelection}
            />
          )}
        />
        {worktree && gitBusy && <p className={styles.statusRow} role="status">{t("newSession.preparingWorktree")}</p>}
        {(projectError || (!selectedProject && projectlessError) || modelsUnavailable) ? (
          <div className={styles.statusRow} role="alert">
            <span>{projectError ?? (!selectedProject ? projectlessError : null) ?? modelsError ?? t("newSession.modelsUnavailable")}</span>
            {!projectError && !selectedProject && projectlessError ? (
              <button type="button" onClick={() => setProjectlessReloadKey((key) => key + 1)}>
                <AliIcon name="reload" size={12} />
                {t("newSession.retryModels")}
              </button>
            ) : !projectError && modelsUnavailable ? (
              <button type="button" disabled={modelsLoading} onClick={() => setModelsReloadKey((key) => key + 1)}>
                <AliIcon name="reload" size={12} />
                {t("newSession.retryModels")}
              </button>
            ) : null}
          </div>
        ) : null}
      </NewSessionLauncher>
      {directoryPickerOpen ? (
        <DirectoryPicker
          busy={projectValidating}
          error={projectError}
          onCancel={() => {
            setDirectoryPickerOpen(false);
            setProjectError(null);
          }}
          onSelect={(path) => void validateAndChooseProject(path)}
        />
      ) : null}
    </>
  );
}
