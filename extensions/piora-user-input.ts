import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  normalizeUserInputAnswers,
  normalizeUserInputQuestions,
  type UserInputQuestion,
  type UserInputResult,
} from "../lib/user-input.ts";

type PioraUi = ExtensionContext["ui"] & {
  requestUserInput?: (
    title: string,
    description: string | undefined,
    questions: UserInputQuestion[],
    options?: { signal?: AbortSignal },
  ) => Promise<UserInputResult>;
};

async function fallbackRequest(
  ctx: ExtensionContext,
  questions: UserInputQuestion[],
  signal?: AbortSignal,
): Promise<UserInputResult> {
  const answers: Record<string, string[]> = {};
  for (const question of questions) {
    if (signal?.aborted) return { cancelled: true };
    const title = question.header || question.question;
    if (question.kind === "single_select") {
      const value = await ctx.ui.select(title, question.options!.map((option) => option.label), { signal });
      if (value === undefined) return { cancelled: true };
      answers[question.id] = [value];
      continue;
    }
    if (question.kind === "multi_select") {
      const labels = question.options!.map((option) => option.label);
      const value = await ctx.ui.input(`${title} (${labels.join(", ")})`, "Enter one or more labels separated by commas", { signal });
      if (value === undefined) return { cancelled: true };
      answers[question.id] = value.split(",").map((item) => item.trim()).filter(Boolean);
      continue;
    }
    const value = question.multiline
      ? await ctx.ui.editor(title, "")
      : await ctx.ui.input(title, question.placeholder, { signal });
    if (value === undefined) return { cancelled: true };
    answers[question.id] = value.trim() ? [value.trim()] : [];
  }
  return { answers };
}

export default function pioraUserInput(api: ExtensionAPI) {
  api.registerTool(defineTool({
    name: "piora_request_user_input",
    label: "Ask User",
    description: "Show a native Piora question card and wait for the user's structured response. Supports up to three single-choice, multiple-choice, or text questions in one call. Use this when a user decision or missing answer is genuinely required to continue.",
    promptSnippet: "Ask focused questions through Piora's native user-input card instead of burying choices in ordinary chat text",
    promptGuidelines: [
      "Use this tool when the user's answer changes the implementation, scope, preference, or next action and cannot be safely inferred.",
      "Prefer one call with all closely related questions (maximum three). Keep headers short, questions concrete, and options mutually distinct.",
      "Use single_select for one decision, multi_select when several choices may apply, and text only when predefined options would be misleading.",
      "Do not request passwords, API keys, tokens, payment details, or other secrets.",
      "Do not use this tool for rhetorical questions, routine progress updates, or confirmations that are already explicit in the user's request.",
      "Wait for the tool result before continuing. If the user cancels, do not invent an answer.",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ maxLength: 120, description: "Short title for the card." })),
      description: Type.Optional(Type.String({ maxLength: 500, description: "Why this input is needed." })),
      questions: Type.Array(Type.Object({
        id: Type.String({ maxLength: 64, description: "Stable identifier used in the returned answers." }),
        header: Type.Optional(Type.String({ maxLength: 40, description: "Short section label." })),
        question: Type.String({ maxLength: 500 }),
        kind: Type.Union([Type.Literal("single_select"), Type.Literal("multi_select"), Type.Literal("text")]),
        options: Type.Optional(Type.Array(Type.Object({
          label: Type.String({ maxLength: 100 }),
          description: Type.Optional(Type.String({ maxLength: 300 })),
        }), { minItems: 2, maxItems: 6 })),
        placeholder: Type.Optional(Type.String({ maxLength: 240 })),
        multiline: Type.Optional(Type.Boolean()),
        required: Type.Optional(Type.Boolean()),
      }), { minItems: 1, maxItems: 3 }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const questions = normalizeUserInputQuestions(params.questions);
      const ui = ctx.ui as PioraUi;
      const result = ui.requestUserInput
        ? await ui.requestUserInput(
          params.title?.trim() || "Your input is needed",
          params.description?.trim() || undefined,
          questions,
          { signal },
        )
        : await fallbackRequest(ctx, questions, signal);
      if ("cancelled" in result) {
        return {
          content: [{ type: "text" as const, text: "The user cancelled the question card without submitting answers. Do not infer their choices." }],
          details: { cancelled: true },
        };
      }
      const answers = normalizeUserInputAnswers(questions, result.answers);
      const lines = questions.map((question) => {
        const values = answers[question.id] ?? [];
        return `- ${question.id}: ${values.length > 0 ? values.join(", ") : "(skipped)"}`;
      });
      return {
        content: [{ type: "text" as const, text: `The user submitted the question card:\n${lines.join("\n")}` }],
        details: { cancelled: false, answers },
      };
    },
  }));

  api.on?.("before_agent_start", (event) => {
    if (!event.systemPromptOptions.selectedTools?.includes("piora_request_user_input")) return;
    if (event.systemPrompt.includes('<piora_runtime_capability name="user_input_card"')) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n<piora_runtime_capability name="user_input_card" availability="active">
Piora can display a native interactive question card through the \`piora_request_user_input\` tool and return the user's structured answers. When you genuinely need the user to choose among options, select multiple applicable items, or provide missing text before continuing, prefer this tool over an unstructured list of questions in ordinary chat. Ask no more than three focused questions per call, do not request secrets, wait for the result, and never invent an answer after cancellation.
</piora_runtime_capability>`,
    };
  });
}
