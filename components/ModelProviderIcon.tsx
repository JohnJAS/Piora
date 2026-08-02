"use client";

import type { ComponentType, CSSProperties } from "react";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AntGroupColorIcon from "@lobehub/icons/es/AntGroup/components/Color";
import AwsColorIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureColorIcon from "@lobehub/icons/es/Azure/components/Color";
import BaiduColorIcon from "@lobehub/icons/es/Baidu/components/Color";
import CerebrasColorIcon from "@lobehub/icons/es/Cerebras/components/Color";
import CloudflareColorIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import CohereColorIcon from "@lobehub/icons/es/Cohere/components/Color";
import DeepSeekColorIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoColorIcon from "@lobehub/icons/es/Doubao/components/Color";
import FireworksColorIcon from "@lobehub/icons/es/Fireworks/components/Color";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import GoogleColorIcon from "@lobehub/icons/es/Google/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import HuggingFaceColorIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import KimiColorIcon from "@lobehub/icons/es/Kimi/components/Color";
import MetaColorIcon from "@lobehub/icons/es/Meta/components/Color";
import MinimaxColorIcon from "@lobehub/icons/es/Minimax/components/Color";
import MistralColorIcon from "@lobehub/icons/es/Mistral/components/Color";
import ModelScopeIcon from "@lobehub/icons/es/ModelScope/components/Mono";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import NvidiaColorIcon from "@lobehub/icons/es/Nvidia/components/Color";
import OllamaIcon from "@lobehub/icons/es/Ollama/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import PerplexityColorIcon from "@lobehub/icons/es/Perplexity/components/Color";
import QwenColorIcon from "@lobehub/icons/es/Qwen/components/Color";
import SiliconCloudColorIcon from "@lobehub/icons/es/SiliconCloud/components/Color";
import StepfunColorIcon from "@lobehub/icons/es/Stepfun/components/Color";
import TencentCloudColorIcon from "@lobehub/icons/es/TencentCloud/components/Color";
import TogetherColorIcon from "@lobehub/icons/es/Together/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import YiColorIcon from "@lobehub/icons/es/Yi/components/Color";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";
import ZhipuColorIcon from "@lobehub/icons/es/Zhipu/components/Color";

type IconComponent = ComponentType<{ size?: number | string; style?: CSSProperties }>;
type ModelBrand = keyof typeof MODEL_BRAND_ICONS | "custom";

const MODEL_BRAND_ICONS = {
  anthropic: { Icon: AnthropicIcon, hasColor: false },
  openai: { Icon: OpenAIIcon, hasColor: false },
  google: { Icon: GoogleColorIcon, hasColor: true },
  "ant-ling": { Icon: AntGroupColorIcon, hasColor: true },
  deepseek: { Icon: DeepSeekColorIcon, hasColor: true },
  groq: { Icon: GroqIcon, hasColor: false },
  mistral: { Icon: MistralColorIcon, hasColor: true },
  moonshot: { Icon: MoonshotIcon, hasColor: false },
  kimi: { Icon: KimiColorIcon, hasColor: true },
  minimax: { Icon: MinimaxColorIcon, hasColor: true },
  fireworks: { Icon: FireworksColorIcon, hasColor: true },
  huggingface: { Icon: HuggingFaceColorIcon, hasColor: true },
  cerebras: { Icon: CerebrasColorIcon, hasColor: true },
  openrouter: { Icon: OpenRouterIcon, hasColor: false },
  xai: { Icon: XAIIcon, hasColor: false },
  cloudflare: { Icon: CloudflareColorIcon, hasColor: true },
  vercel: { Icon: VercelIcon, hasColor: false },
  "github-copilot": { Icon: GithubCopilotIcon, hasColor: false },
  aws: { Icon: AwsColorIcon, hasColor: true },
  azure: { Icon: AzureColorIcon, hasColor: true },
  nvidia: { Icon: NvidiaColorIcon, hasColor: true },
  opencode: { Icon: OpenCodeIcon, hasColor: false },
  qwen: { Icon: QwenColorIcon, hasColor: true },
  xiaomi: { Icon: XiaomiMiMoIcon, hasColor: false },
  zai: { Icon: ZAIIcon, hasColor: false },
  zhipu: { Icon: ZhipuColorIcon, hasColor: true },
  cohere: { Icon: CohereColorIcon, hasColor: true },
  perplexity: { Icon: PerplexityColorIcon, hasColor: true },
  together: { Icon: TogetherColorIcon, hasColor: true },
  grok: { Icon: GrokIcon, hasColor: false },
  meta: { Icon: MetaColorIcon, hasColor: true },
  ollama: { Icon: OllamaIcon, hasColor: false },
  baidu: { Icon: BaiduColorIcon, hasColor: true },
  doubao: { Icon: DoubaoColorIcon, hasColor: true },
  siliconcloud: { Icon: SiliconCloudColorIcon, hasColor: true },
  stepfun: { Icon: StepfunColorIcon, hasColor: true },
  tencent: { Icon: TencentCloudColorIcon, hasColor: true },
  yi: { Icon: YiColorIcon, hasColor: true },
} satisfies Record<string, { Icon: IconComponent; hasColor: boolean }>;

const PROVIDER_BRANDS: Record<string, keyof typeof MODEL_BRAND_ICONS> = {
  anthropic: "anthropic",
  openai: "openai",
  "openai-codex": "openai",
  google: "google",
  "google-vertex": "google",
  "ant-ling": "ant-ling",
  deepseek: "deepseek",
  groq: "groq",
  mistral: "mistral",
  moonshot: "moonshot",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  "kimi-coding": "kimi",
  minimax: "minimax",
  "minimax-cn": "minimax",
  fireworks: "fireworks",
  huggingface: "huggingface",
  cerebras: "cerebras",
  openrouter: "openrouter",
  xai: "xai",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  "vercel-ai-gateway": "vercel",
  "github-copilot": "github-copilot",
  "amazon-bedrock": "aws",
  "azure-openai-responses": "azure",
  nvidia: "nvidia",
  opencode: "opencode",
  "opencode-go": "opencode",
  qwen: "qwen",
  dashscope: "qwen",
  bailian: "qwen",
  xiaomi: "xiaomi",
  "xiaomi-token-plan-ams": "xiaomi",
  "xiaomi-token-plan-cn": "xiaomi",
  "xiaomi-token-plan-sgp": "xiaomi",
  zai: "zai",
  "zai-coding-cn": "zai",
  zhipu: "zhipu",
  cohere: "cohere",
  perplexity: "perplexity",
  together: "together",
  grok: "grok",
  meta: "meta",
  "meta-ai": "meta",
  ollama: "ollama",
  baidu: "baidu",
  "baidu-cloud": "baidu",
  doubao: "doubao",
  volcengine: "doubao",
  siliconcloud: "siliconcloud",
  siliconflow: "siliconcloud",
  stepfun: "stepfun",
  tencent: "tencent",
  "tencent-cloud": "tencent",
  yi: "yi",
};

const MODEL_BRAND_HINTS: ReadonlyArray<{
  brand: keyof typeof MODEL_BRAND_ICONS;
  pattern: RegExp;
}> = [
  { brand: "deepseek", pattern: /deep[\s._-]*seek/i },
  { brand: "anthropic", pattern: /(?:^|[\s/._-])(?:claude|anthropic)(?:$|[\s/._-])/i },
  { brand: "openai", pattern: /(?:^|[\s/._-])(?:gpt|chatgpt|codex|openai|o[134])(?:$|[\s/._-]|\d)/i },
  { brand: "google", pattern: /(?:^|[\s/._-])(?:gemini|gemma)(?:$|[\s/._-]|\d)/i },
  { brand: "qwen", pattern: /(?:^|[\s/._-])(?:qwen|tongyi)(?:$|[\s/._-]|\d)/i },
  { brand: "kimi", pattern: /(?:^|[\s/._-])kimi(?:$|[\s/._-]|\d)/i },
  { brand: "moonshot", pattern: /moonshot/i },
  { brand: "mistral", pattern: /(?:mistral|mixtral|codestral|pixtral)/i },
  { brand: "minimax", pattern: /mini[\s._-]*max/i },
  { brand: "xai", pattern: /(?:^|[\s/._-])grok(?:$|[\s/._-]|\d)/i },
  { brand: "meta", pattern: /(?:^|[\s/._-])llama(?:$|[\s/._-]|\d)/i },
  { brand: "zhipu", pattern: /(?:^|[\s/._-])glm(?:$|[\s/._-]|\d)/i },
  { brand: "baidu", pattern: /(?:ernie|wenxin)/i },
  { brand: "doubao", pattern: /doubao/i },
  { brand: "stepfun", pattern: /stepfun|step[-._]?\d/i },
  { brand: "yi", pattern: /(?:^|[\s/._-])yi(?:$|[\s/._-]|\d)/i },
  { brand: "cohere", pattern: /(?:cohere|command[-._\s]?r)/i },
  { brand: "perplexity", pattern: /(?:perplexity|(?:^|[\s/._-])sonar(?:$|[\s/._-]))/i },
];

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function resolveModelBrand(
  provider?: string | null,
  modelId?: string | null,
  modelName?: string | null,
): ModelBrand {
  const modelIdentity = `${normalized(modelId)} ${normalized(modelName)}`.trim();
  for (const hint of MODEL_BRAND_HINTS) {
    if (hint.pattern.test(modelIdentity)) return hint.brand;
  }

  const providerId = normalized(provider);
  const exactProviderBrand = PROVIDER_BRANDS[providerId];
  if (exactProviderBrand) return exactProviderBrand;

  for (const hint of MODEL_BRAND_HINTS) {
    if (hint.pattern.test(providerId)) return hint.brand;
  }
  return "custom";
}

interface ModelProviderIconProps {
  provider?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function ModelProviderIcon({
  provider,
  modelId,
  modelName,
  size = 16,
  className,
  style,
}: ModelProviderIconProps) {
  const brand = resolveModelBrand(provider, modelId, modelName);
  const iconDefinition = brand === "custom"
    ? { Icon: ModelScopeIcon, hasColor: false }
    : MODEL_BRAND_ICONS[brand];
  const iconSize = brand === "custom" ? Math.max(10, Math.round(size * 0.72)) : size;

  return (
    <span
      aria-hidden="true"
      className={className}
      data-model-brand={brand}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderRadius: brand === "custom" ? Math.max(4, Math.round(size * 0.28)) : undefined,
        background: brand === "custom"
          ? "color-mix(in srgb, var(--accent) 11%, var(--bg-panel))"
          : undefined,
        color: brand === "custom" ? "var(--accent)" : "currentColor",
        ...style,
      }}
    >
      <iconDefinition.Icon
        size={iconSize}
        style={iconDefinition.hasColor ? undefined : { color: "currentColor" }}
      />
    </span>
  );
}
