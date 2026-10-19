import type {
  AssistantChatMessage,
  AssistantRequest,
} from "../../shared/k-assistant";
import { assertAssistantImage } from "../../shared/assistant-image";
import type { Config } from "../../shared/types";
import { TranslateError, type TranslationService } from "./base";

const DEFAULT_ASSISTANT_INSTRUCTION =
  "请直接、准确地完成用户请求。保留事实、术语和必要格式，不添加无关说明。";

export function assistantInstruction(request: AssistantRequest): string {
  if (request.instruction?.trim()) return request.instruction.trim();
  if (request.kind === "translate") {
    if (request.image !== undefined) {
      return `识别图片中的文字，从 ${request.from ?? "自动检测"} 翻译为 ${request.to ?? "简体中文"}。只输出译文，不要添加解释或开场白。按阅读顺序保留段落、表格结构和公式，公式和符号保持原样。看不清的文字标注为“[无法辨认]”，不要猜测或补写。用户同时提供的文字是图片翻译的补充要求。`;
    }
    return `把用户文本从 ${request.from ?? "自动检测"} 翻译为 ${request.to ?? "简体中文"}。只输出译文，不要解释。`;
  }
  return DEFAULT_ASSISTANT_INSTRUCTION;
}

/** Check this before invoking any adapter, for both complete and stream paths. */
export function assertAssistantRequestSupported(
  request: AssistantRequest,
  service: Pick<TranslationService, "id">,
): void {
  if (request.image === undefined) return;
  assertAssistantImage(request.image);
  if (service.id !== "chatgpt") {
    throw new TranslateError(
      "invalid_config",
      "图片翻译目前支持 ChatGPT 账号（OAuth），请切换翻译服务。",
      { serviceId: service.id, retryable: false },
    );
  }
}

export async function completeAssistantRequest(
  request: AssistantRequest,
  service: TranslationService,
  config: Pick<Config, "sourceLanguage" | "targetLanguage" | "glossaries">,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  assertAssistantRequestSupported(request, service);
  if (request.kind === "translate" && request.image === undefined) {
    const result = await service.translate(
      {
        texts: [request.text],
        from: request.from ?? config.sourceLanguage,
        to: request.to ?? config.targetLanguage,
        glossary: config.glossaries,
        variant: "selection",
      },
      signal,
    );
    const error = result.errors?.[0];
    if (error) {
      throw new TranslateError("unknown", error.message, {
        serviceId: request.service,
        retryable: error.retryable,
      });
    }
    return result.texts[0] ?? "";
  }
  if (!service.completePrompt) {
    throw new TranslateError(
      "invalid_config",
      `Translation service ${request.service} does not support AI assistant actions.`,
      { serviceId: request.service, retryable: false },
    );
  }
  return service.completePrompt(
    request.image
      ? {
          ...request,
          from: request.from ?? config.sourceLanguage,
          to: request.to ?? config.targetLanguage,
        }
      : request,
    signal,
  );
}

export function assistantConversation(
  request: AssistantRequest,
): AssistantChatMessage[] {
  return [...(request.history ?? []), { role: "user", content: request.text }];
}
