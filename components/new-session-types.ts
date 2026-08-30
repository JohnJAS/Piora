import type { AttachedFile } from "@/hooks/useAgentSession";
import type { AttachedImage, PromptRunOptions } from "./ChatInput";

export interface NewSessionInitialPrompt {
  id: string;
  message: string;
  images?: AttachedImage[];
  files?: AttachedFile[];
  options?: PromptRunOptions;
}

export interface NewSessionLaunch {
  cwd: string;
  projectRoot: string;
  model: { provider: string; modelId: string };
  prompt: NewSessionInitialPrompt;
}
