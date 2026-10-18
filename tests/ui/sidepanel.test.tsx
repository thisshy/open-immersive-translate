import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => {
  const messageListeners = new Set<(message: unknown) => void>();
  const activatedListeners = new Set<() => void>();
  const updatedListeners = new Set<() => void>();
  const tabEvent = (listeners: Set<() => void>) => ({
    addListener: vi.fn((listener: () => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: () => void) => listeners.delete(listener)),
  });
  return {
    messageListeners,
    activatedListeners,
    updatedListeners,
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) =>
          messageListeners.add(listener),
        ),
        removeListener: vi.fn((listener: (message: unknown) => void) =>
          messageListeners.delete(listener),
        ),
      },
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn(),
      sendMessage: vi.fn(),
      create: vi.fn().mockResolvedValue(undefined),
      onActivated: tabEvent(activatedListeners),
      onUpdated: tabEvent(updatedListeners),
    },
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      session: { get: vi.fn(), set: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});

vi.mock("webextension-polyfill", () => ({ default: browserMock }));

import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { AssistantClient } from "../../src/shared/k-assistant";
import { SidePanel } from "../../src/ui/sidepanel/index";

let storage: Record<string, unknown>;
let session: Record<string, unknown>;
let currentTab: { id: number; title: string; url: string };
let translated: Set<number>;
const writeClipboard = vi.fn().mockResolvedValue(undefined);

function idleAssistant(): AssistantClient {
  return {
    complete: vi.fn().mockResolvedValue("你好"),
    supportsStreaming: vi.fn().mockResolvedValue(false),
    stream: vi.fn(),
  };
}

beforeEach(() => {
  storage = {
    config: { ...structuredClone(DEFAULT_CONFIG), uiLanguage: "zh-CN" },
    kSidePanelHistory: [],
  };
  session = {};
  currentTab = { id: 8, title: "Article", url: "https://example.com/article" };
  translated = new Set();
  browserMock.messageListeners.clear();
  browserMock.activatedListeners.clear();
  browserMock.updatedListeners.clear();
  browserMock.tabs.query
    .mockReset()
    .mockImplementation(async () => [{ ...currentTab }]);
  browserMock.tabs.sendMessage
    .mockReset()
    .mockImplementation(async (id, message) => {
      if (message.type === "getPageState") {
        return {
          title: currentTab.title,
          url: currentTab.url,
          translated: translated.has(id),
        };
      }
      if (message.type === "getSelectionText")
        return { text: "selected sentence" };
      if (message.type === "toggleTranslate") {
        if (translated.has(id)) translated.delete(id);
        else translated.add(id);
      }
      return undefined;
    });
  browserMock.storage.local.get.mockReset().mockImplementation(async (key) => ({
    [key]: storage[key],
  }));
  browserMock.storage.local.set
    .mockReset()
    .mockImplementation(async (value) => {
      Object.assign(storage, value);
    });
  browserMock.storage.session.get
    .mockReset()
    .mockImplementation(async (key) => ({ [key]: session[key] }));
  browserMock.storage.session.set
    .mockReset()
    .mockImplementation(async (value) => Object.assign(session, value));
  browserMock.storage.onChanged.addListener.mockReset();
  browserMock.storage.onChanged.removeListener.mockReset();
  writeClipboard.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: writeClipboard,
      readText: vi.fn().mockResolvedValue(""),
    },
  });
});

afterEach(cleanup);

describe("SidePanel", () => {
  it("opens ready for input and only fills selected text without model requests", async () => {
    const assistant = idleAssistant();
    render(<SidePanel assistant={assistant} />);
    const source = await screen.findByLabelText("输入要翻译的文字");
    expect(document.activeElement).toBe(source);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "翻译文字" })
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "读取网页选中内容" }));
    await screen.findByDisplayValue("selected sentence");
    expect(browserMock.tabs.sendMessage).toHaveBeenCalledWith(
      8,
      { type: "getSelectionText" },
      { frameId: 0 },
    );
    act(() => {
      for (const listener of browserMock.messageListeners)
        listener({ type: "sidePanelSelection", text: " new selection " });
    });
    await screen.findByDisplayValue("new selection");
    expect(assistant.complete).not.toHaveBeenCalled();
    expect(assistant.stream).not.toHaveBeenCalled();
    expect(assistant.supportsStreaming).not.toHaveBeenCalled();
  });

  it("translates with Ctrl+Enter, copies output, and restores its draft after reopening", async () => {
    const assistant: AssistantClient = {
      complete: vi.fn(),
      supportsStreaming: vi.fn().mockResolvedValue(true),
      stream: vi.fn().mockImplementation(async (_request, onPartial) => {
        onPartial("你");
        onPartial("你好");
        return "你好";
      }),
    };
    const view = render(<SidePanel assistant={assistant} />);
    const source = await screen.findByLabelText("输入要翻译的文字");
    fireEvent.input(source, { target: { value: "hello" } });
    fireEvent.keyDown(source, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(storage.kSidePanelHistory).toEqual([
        expect.objectContaining({ source: "hello", translation: "你好" }),
      ]),
    );
    expect(assistant.stream).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "translate", text: "hello" }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("你好"));
    await screen.findByText("已复制");
    await waitFor(() =>
      expect(session.kSidePanelDraft).toEqual(
        expect.objectContaining({ source: "hello", output: "你好" }),
      ),
    );
    view.unmount();
    const reopened = render(<SidePanel assistant={assistant} />);
    await screen.findByDisplayValue("hello");
    await waitFor(() =>
      expect(
        reopened.container.querySelector(".side-output")?.textContent,
      ).toBe("你好"),
    );
    expect(assistant.stream).toHaveBeenCalledTimes(1);
  });

  it("loads older settings with a readable font and persists the chosen size", async () => {
    const oldConfig = structuredClone(DEFAULT_CONFIG);
    storage.config = {
      ...oldConfig,
      uiLanguage: "zh-CN",
      sidePanel: { enabled: true, service: "chatgpt", historyLimit: 50 },
    };
    const assistant = idleAssistant();
    const view = render(<SidePanel assistant={assistant} />);
    await screen.findByLabelText("输入要翻译的文字");
    const shell = view.container.querySelector<HTMLElement>(".side-shell")!;
    expect(shell.style.getPropertyValue("--side-font-size")).toBe("16px");
    fireEvent.click(screen.getByRole("button", { name: "增大字号" }));
    await waitFor(() =>
      expect(storage.config).toEqual(
        expect.objectContaining({
          sidePanel: expect.objectContaining({ fontSize: 17 }),
        }),
      ),
    );
    view.unmount();
    const reopened = render(<SidePanel assistant={assistant} />);
    await screen.findByLabelText("输入要翻译的文字");
    expect(
      reopened.container
        .querySelector<HTMLElement>(".side-shell")!
        .style.getPropertyValue("--side-font-size"),
    ).toBe("17px");
  });

  it("stops the request and keeps partial output without adding completed history", async () => {
    let requestSignal: AbortSignal | undefined;
    const assistant: AssistantClient = {
      complete: vi.fn(),
      supportsStreaming: vi.fn().mockResolvedValue(true),
      stream: vi.fn().mockImplementation((_request, onPartial, signal) => {
        requestSignal = signal;
        onPartial("部分译文");
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Stopped", "AbortError")),
          );
        });
      }),
    };
    const view = render(<SidePanel assistant={assistant} />);
    const source = await screen.findByLabelText("输入要翻译的文字");
    fireEvent.input(source, { target: { value: "long text" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译文字" }));
    await screen.findByText("部分译文");
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await screen.findByText("已停止，保留已生成内容");
    expect(requestSignal?.aborted).toBe(true);
    expect(view.container.querySelector(".side-output")?.textContent).toBe(
      "部分译文",
    );
    expect(storage.kSidePanelHistory).toEqual([]);
    expect(assistant.complete).not.toHaveBeenCalled();
  });

  it("shows the specific error and retries only when requested", async () => {
    const assistant = idleAssistant();
    vi.mocked(assistant.complete)
      .mockRejectedValueOnce(new Error("Model unavailable for this account"))
      .mockResolvedValueOnce("重试成功");
    const view = render(<SidePanel assistant={assistant} />);
    const source = await screen.findByLabelText("输入要翻译的文字");
    fireEvent.input(source, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译文字" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Model unavailable for this account");
    expect(assistant.complete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(view.container.querySelector(".side-output")?.textContent).toBe(
        "重试成功",
      ),
    );
    expect(assistant.complete).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not offer a model retry or resend translation after copying fails", async () => {
    const assistant = idleAssistant();
    const view = render(<SidePanel assistant={assistant} />);
    const source = await screen.findByLabelText("输入要翻译的文字");
    fireEvent.input(source, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译文字" }));
    await waitFor(() =>
      expect(view.container.querySelector(".side-output")?.textContent).toBe(
        "你好",
      ),
    );
    writeClipboard.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("复制失败，请手动选择文字复制");
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    expect(assistant.complete).toHaveBeenCalledTimes(1);
    expect(assistant.stream).not.toHaveBeenCalled();
    expect(view.container.querySelector(".side-output")?.textContent).toBe(
      "你好",
    );
  });

  it("uses the current tab for page actions and reads back the resulting state", async () => {
    const assistant = idleAssistant();
    render(<SidePanel assistant={assistant} />);
    await screen.findByLabelText("输入要翻译的文字");
    fireEvent.click(screen.getByRole("tab", { name: "页面" }));
    await screen.findByText("Article");
    currentTab = {
      id: 12,
      title: "New article",
      url: "https://new.example.com/article",
    };
    act(() => {
      for (const listener of browserMock.activatedListeners) listener();
    });
    await screen.findByText("New article");
    fireEvent.click(screen.getByRole("button", { name: "翻译", exact: true }));
    await screen.findByRole("button", { name: "显示原文" });
    expect(browserMock.tabs.sendMessage).toHaveBeenCalledWith(12, {
      type: "toggleTranslate",
      tabId: 12,
    });
    expect(browserMock.tabs.sendMessage).toHaveBeenLastCalledWith(
      12,
      { type: "getPageState" },
      { frameId: 0 },
    );
    expect(assistant.complete).not.toHaveBeenCalled();
  });
});
