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
  it("disconnects a cancellable complete request instead of sending an uncancellable message", async () => {
    const controller = new AbortController();
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: { connect: () => port, sendMessage },
    });

    const completion = createAssistantClient().complete(
      request,
      controller.signal,
    );
    const rejected = expect(completion).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ request, stream: false }),
    );
    controller.abort();
    await rejected;
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(port.onMessage.removeListener).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not connect or submit when the request was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const connect = vi.fn();
    vi.stubGlobal("chrome", { runtime: { connect } });

    await expect(
      createAssistantClient().stream!(request, vi.fn(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(connect).not.toHaveBeenCalled();
  });

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
  it("rejects invalid image input before discovering capabilities or dispatching", async () => {
    const client: AssistantClient = {
      complete: vi.fn(),
      supportsStreaming: vi.fn(),
      stream: vi.fn(),
    };
    await expect(
      runAssistant(
        client,
        { ...request, image: { dataUrl: "https://example.com/image.png" } },
        vi.fn(),
      ),
    ).rejects.toThrow("图片仅支持");
    expect(client.supportsStreaming).not.toHaveBeenCalled();
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.stream).not.toHaveBeenCalled();
  });

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

  it("falls back when capability discovery fails before any request was sent", async () => {
    const client: AssistantClient = {
      complete: vi.fn().mockResolvedValue("fallback"),
      supportsStreaming: vi
        .fn()
        .mockRejectedValue(new Error("worker restarted")),
      stream: vi.fn(),
    };

    await expect(runAssistant(client, request, vi.fn())).resolves.toBe(
      "fallback",
    );
    expect(client.complete).toHaveBeenCalledWith(request, undefined);
    expect(client.stream).not.toHaveBeenCalled();
  });

  it("does not resend a failed stream after partial output", async () => {
    const client: AssistantClient = {
      complete: vi.fn(),
      supportsStreaming: vi.fn().mockResolvedValue(true),
      stream: vi.fn().mockImplementation(async (_request, partial) => {
        partial("partial translation");
        throw new Error("model request failed");
      }),
    };

    await expect(runAssistant(client, request, vi.fn())).rejects.toThrow(
      "model request failed",
    );
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("stops before dispatch if cancelled while discovering capabilities", async () => {
    const controller = new AbortController();
    const client: AssistantClient = {
      complete: vi.fn(),
      supportsStreaming: vi.fn().mockImplementation(async () => {
        controller.abort();
        return true;
      }),
      stream: vi.fn(),
    };

    await expect(
      runAssistant(client, request, vi.fn(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.stream).not.toHaveBeenCalled();
  });

  it("never falls back when the streaming request was cancelled", async () => {
    const controller = new AbortController();
    const client: AssistantClient = {
      complete: vi.fn(),
      supportsStreaming: vi.fn().mockResolvedValue(true),
      stream: vi
        .fn()
        .mockRejectedValue(new DOMException("Stopped", "AbortError")),
    };

    await expect(
      runAssistant(client, request, vi.fn(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(client.stream).toHaveBeenCalledWith(
      request,
      expect.any(Function),
      controller.signal,
    );
    expect(client.complete).not.toHaveBeenCalled();
  });
});
