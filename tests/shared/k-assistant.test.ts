import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAssistantClient,
  runAssistant,
  type AssistantClient,
  type AssistantRequest,
} from "../../src/shared/k-assistant";

const request: AssistantRequest = {
  kind: "translate",
  text: "hello",
  service: "openai-compatible",
  from: "en",
  to: "zh-CN",
};

afterEach(() => vi.unstubAllGlobals());

describe("assistant runtime port", () => {
  it("reads the Chrome disconnect error and rejects the interrupted stream", async () => {
    let onDisconnect: (() => void) | undefined;
    const lastError = vi.fn(() => ({
      message: "Back/forward cache closed the port.",
    }));
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onDisconnect: {
        addListener: (listener: () => void) => {
          onDisconnect = listener;
        },
      },
    };
    vi.stubGlobal("chrome", {
      runtime: {
        get lastError() {
          return lastError();
        },
        connect: () => port,
      },
    });
    const stream = createAssistantClient().stream!(request, vi.fn());
    const rejected = expect(stream).rejects.toThrow(
      "Back/forward cache closed the port.",
    );
    onDisconnect?.();
    await rejected;
    expect(lastError).toHaveBeenCalledOnce();
    expect(port.onMessage.removeListener).toHaveBeenCalledOnce();
  });
});

describe("runAssistant", () => {
  it("uses partial output for a streaming adapter", async () => {
    const onPartial = vi.fn();
    const client: AssistantClient = {
      complete: vi.fn(),
      supportsStreaming: vi.fn().mockResolvedValue(true),
      stream: vi.fn().mockImplementation(async (_request, partial) => {
        partial("你");
        partial("你好");
        return "你好";
      }),
    };

    await expect(runAssistant(client, request, onPartial)).resolves.toBe(
      "你好",
    );
    expect(onPartial).toHaveBeenNthCalledWith(2, "你好");
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("falls back when streaming is unavailable or fails", async () => {
    const client: AssistantClient = {
      complete: vi.fn().mockResolvedValue("fallback"),
      supportsStreaming: vi.fn().mockResolvedValue(true),
      stream: vi.fn().mockRejectedValue(new Error("disconnected")),
    };

    await expect(runAssistant(client, request, vi.fn())).resolves.toBe(
      "fallback",
    );
    expect(client.complete).toHaveBeenCalledWith(request);
  });
});
