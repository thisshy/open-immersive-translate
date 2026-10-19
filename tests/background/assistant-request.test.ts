import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { AssistantRequest } from "../../src/shared/k-assistant";
import type { TranslationService } from "../../src/background/services/base";
import {
  assistantInstruction,
  assertAssistantRequestSupported,
  completeAssistantRequest,
} from "../../src/background/services/assistant";

const image = { dataUrl: "data:image/png;base64,aGVsbG8=" };
const request: AssistantRequest = {
  kind: "translate",
  text: "",
  service: "chatgpt",
  image,
};

function mockService(id = "chatgpt"): TranslationService {
  return {
    id,
    name: id,
    maxBatchSize: 20,
    maxBatchChars: 12_000,
    placeholder: { open: "{", close: "}" },
    rateLimit: { rps: 2, concurrency: 2 },
    translate: vi.fn().mockResolvedValue({ texts: ["文字译文"] }),
    completePrompt: vi.fn().mockResolvedValue("图片译文"),
  };
}

describe("assistant request routing", () => {
  it("routes a non-streaming image through the multimodal assistant, without YAML translation", async () => {
    const service = mockService();
    const signal = new AbortController().signal;
    await expect(
      completeAssistantRequest(request, service, DEFAULT_CONFIG, signal),
    ).resolves.toBe("图片译文");
    expect(service.translate).not.toHaveBeenCalled();
    expect(service.completePrompt).toHaveBeenCalledWith(
      {
        ...request,
        from: DEFAULT_CONFIG.sourceLanguage,
        to: DEFAULT_CONFIG.targetLanguage,
      },
      signal,
    );
  });

  it("preserves the existing text translation route", async () => {
    const service = mockService();
    const signal = new AbortController().signal;
    const textRequest = { ...request, text: "hello", image: undefined };
    await expect(
      completeAssistantRequest(textRequest, service, DEFAULT_CONFIG, signal),
    ).resolves.toBe("文字译文");
    expect(service.translate).toHaveBeenCalledWith(
      expect.objectContaining({ texts: ["hello"], variant: "selection" }),
      signal,
    );
    expect(service.completePrompt).not.toHaveBeenCalled();
  });

  it("rejects unsupported image services before invoking either adapter route", async () => {
    const service = mockService("openai-compatible");
    expect(() => assertAssistantRequestSupported(request, service)).toThrow(
      "图片翻译目前支持 ChatGPT 账号（OAuth），请切换翻译服务。",
    );
    await expect(
      completeAssistantRequest(
        request,
        service,
        DEFAULT_CONFIG,
        new AbortController().signal,
      ),
    ).rejects.toThrow("图片翻译目前支持 ChatGPT 账号（OAuth）");
    expect(service.translate).not.toHaveBeenCalled();
    expect(service.completePrompt).not.toHaveBeenCalled();
  });

  it("rejects malformed image data and cancelled requests before an adapter call", async () => {
    const service = mockService();
    await expect(
      completeAssistantRequest(
        { ...request, image: { dataUrl: "https://example.com/image.png" } },
        service,
        DEFAULT_CONFIG,
        new AbortController().signal,
      ),
    ).rejects.toThrow("图片仅支持");
    const controller = new AbortController();
    controller.abort();
    await expect(
      completeAssistantRequest(
        request,
        service,
        DEFAULT_CONFIG,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(service.translate).not.toHaveBeenCalled();
    expect(service.completePrompt).not.toHaveBeenCalled();
  });

  it("uses an image-specific instruction and respects an explicit instruction", () => {
    expect(assistantInstruction(request)).toContain("只输出译文");
    expect(assistantInstruction(request)).toContain("不要猜测或补写");
    expect(
      assistantInstruction({ ...request, instruction: " 保持表格 " }),
    ).toBe("保持表格");
  });
});
