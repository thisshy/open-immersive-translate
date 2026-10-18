import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const portState = vi.hoisted(() => ({
  messageListener: undefined as ((message: unknown) => void) | undefined,
  disconnectListener: undefined as (() => void) | undefined,
  error: undefined as { message: string } | undefined,
}));

const rawPort = vi.hoisted(() => ({
  name: "imt:translate",
  sender: { tab: { id: 4 } },
  postMessage: vi.fn(),
  disconnect: vi.fn(),
  onMessage: {
    addListener: vi.fn((listener) => {
      portState.messageListener = listener;
    }),
    removeListener: vi.fn(),
  },
  onDisconnect: {
    addListener: vi.fn((listener) => {
      portState.disconnectListener = listener;
    }),
    removeListener: vi.fn(),
  },
}));

const browserMock = vi.hoisted(() => ({
  runtime: {
    get lastError() {
      return portState.error;
    },
    connect: vi.fn(() => rawPort),
    onConnect: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: { sendMessage: vi.fn() },
}));

vi.mock("webextension-polyfill", () => ({ default: browserMock }));

import { PdfTranslationClient } from "../../src/pdf/translation";

beforeEach(() => {
  rawPort.postMessage.mockReset();
  rawPort.disconnect.mockReset();
  portState.messageListener = undefined;
  portState.disconnectListener = undefined;
  portState.error = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PdfTranslationClient", () => {
  it("handles a cache disconnect and reconnects only unfinished paragraphs", () => {
    vi.useFakeTimers();
    const lastError = vi.spyOn(browserMock.runtime, "lastError", "get");
    const client = new PdfTranslationClient(vi.fn());
    const requestId = client.translate({
      paragraphs: [
        { id: "one", text: "Hello" },
        { id: "two", text: "World" },
      ],
      from: "en",
      to: "zh-CN",
      service: "chatgpt",
    });
    portState.messageListener?.({
      type: "translateResult",
      requestId,
      results: [{ id: "one", text: "你好" }],
      done: false,
    });
    rawPort.postMessage.mockClear();
    portState.error = {
      message:
        "The page keeping the extension port is moved into back/forward cache, so the message channel is closed.",
    };
    portState.disconnectListener?.();
    expect(lastError).toHaveBeenCalledOnce();
    portState.error = undefined;
    vi.advanceTimersByTime(250);
    expect(rawPort.postMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        requestId,
        paragraphs: [{ id: "two", text: "World" }],
      }),
    );
    client.dispose();
  });

  it("uses the shared translate port and forwards streamed paragraph results", () => {
    const onResult = vi.fn();
    const client = new PdfTranslationClient(onResult);
    const requestId = client.translate({
      paragraphs: [{ id: "pdf-1-1-1", text: "Hello" }],
      from: "en",
      to: "zh-CN",
      service: "google",
    });

    expect(rawPort.postMessage).toHaveBeenCalledWith({
      type: "translate",
      requestId,
      paragraphs: [{ id: "pdf-1-1-1", text: "Hello" }],
      from: "en",
      to: "zh-CN",
      service: "google",
      glossary: undefined,
      context: undefined,
      priority: "viewport",
    });

    portState.messageListener?.({
      type: "translateResult",
      requestId,
      results: [{ id: "pdf-1-1-1", text: "你好" }],
      done: true,
    });
    expect(onResult).toHaveBeenCalledWith(
      [{ id: "pdf-1-1-1", text: "你好" }],
      true,
    );
    client.dispose();
    expect(rawPort.disconnect).toHaveBeenCalledOnce();
  });
});
