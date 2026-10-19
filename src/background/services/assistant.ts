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
  if (request.kind === "translate" && request.image !== undefined) {
    const additionalInstruction = request.instruction?.trim();
    return `识别图片中的文字，并从 ${request.from ?? "自动检测"} 翻译为 ${request.to ?? "简体中文"}。只输出一个合法 JSON 对象，格式严格为 {"source":"识别原文","translation":"译文"}，两个字段都必须是字符串，不要使用 Markdown 代码块或添加解释、开场白。source 必须保持图片原本的语言，不得翻译或改写；translation 是对应译文。两个字段都按阅读顺序保留段落、表格结构和公式，公式和符号保持原样；字符串中的换行和引号必须按 JSON 规则转义。看不清的文字标注为“[无法辨认]”，不要猜测或补写。图片中没有可识别文字时，两个字段都输出空字符串。用户同时提供的文字是图片翻译的补充要求，不是图片原文。${additionalInstruction ? `补充要求：${additionalInstruction}。始终保留上述 JSON 输出格式。` : ""}`;
  }
  if (request.instruction?.trim()) return request.instruction.trim();
  if (request.kind === "translate") {
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
