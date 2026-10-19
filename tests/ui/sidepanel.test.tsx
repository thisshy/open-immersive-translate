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
      captureVisibleTab: vi.fn(),
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
let currentTab: { id: number; title: string; url: string; windowId?: number };
let translated: Set<number>;
const writeClipboard = vi.fn().mockResolvedValue(undefined);
const IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const IMAGE_SOURCE = "Hello from screenshot";
const IMAGE_TRANSLATION = "截图中的你好";
const IMAGE_RESPONSE = JSON.stringify({
  source: IMAGE_SOURCE,
  translation: IMAGE_TRANSLATION,
});

class MockUtterance {
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

const speak = vi.fn();

function pasteImage(element: Element): void {
  const bytes = Uint8Array.from(
    atob(IMAGE_DATA_URL.split(",")[1]!),
    (character) => character.charCodeAt(0),
  );
  const file = new File([bytes], "clipboard.png", { type: "image/png" });
  fireEvent.paste(element, {
    clipboardData: {
      items: [{ kind: "file", type: file.type, getAsFile: () => file }],
    },
  });
}

function idleAssistant(): AssistantClient {
  return {
    complete: vi.fn().mockResolvedValue("你好"),
    supportsStreaming: vi.fn().mockResolvedValue(false),
    stream: vi.fn(),
  };
}

function imageAssistant(): AssistantClient {
  return {
    ...idleAssistant(),
    complete: vi.fn().mockResolvedValue(IMAGE_RESPONSE),
  };
}

beforeEach(() => {
  storage = {
    config: { ...structuredClone(DEFAULT_CONFIG), uiLanguage: "zh-CN" },
    kSidePanelHistory: [],
  };
  session = {};
  currentTab = {
    id: 8,
    title: "Article",
    url: "https://example.com/article",
    windowId: 2,
  };
  translated = new Set();
  browserMock.messageListeners.clear();
  browserMock.activatedListeners.clear();
  browserMock.updatedListeners.clear();
  browserMock.tabs.query
    .mockReset()
    .mockImplementation(async () => [{ ...currentTab }]);
  browserMock.tabs.captureVisibleTab
    .mockReset()
    .mockResolvedValue(IMAGE_DATA_URL);
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
  speak.mockReset();
  vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
  vi.stubGlobal("speechSynthesis", {
    getVoices: vi.fn(() => [
      { lang: "en-US", localService: true, name: "English" },
      { lang: "zh-CN", localService: true, name: "Chinese" },
    ]),
    speak,
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  writeClipboard.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: writeClipboard,
      readText: vi.fn().mockResolvedValue(""),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("renders source and translation formulas while preserving editable and copied LaTeX", async () => {
    const original = String.raw`Energy \(E=mc^2\).`;
    const translation = String.raw`能量 \(E=mc^2\)。\n\[\frac{a}{b}=\sqrt{x}\]`;
    const assistant = {
      ...idleAssistant(),
      complete: vi.fn().mockResolvedValue(translation),
    };
    const view = render(<SidePanel assistant={assistant} />);
    const source =
      await screen.findByLabelText<HTMLTextAreaElement>("输入要翻译的文字");
    fireEvent.input(source, { target: { value: original } });
    fireEvent.click(screen.getByRole("button", { name: "翻译文字" }));
    await waitFor(() =>
      expect(
        view.container.querySelectorAll(".side-output .katex"),
      ).toHaveLength(2),
    );
    expect(
      view.container.querySelectorAll(".side-source-preview .katex"),
    ).toHaveLength(1);
    expect(source.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "复制译文" }));
    await waitFor(() =>
      expect(writeClipboard).toHaveBeenCalledWith(translation),
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑原文" }));
    await waitFor(() => expect(source.hidden).toBe(false));
    expect(document.activeElement).toBe(source);
    expect(source.value).toBe(original);
    fireEvent.input(source, { target: { value: String.raw`New \(x^2\).` } });
    fireEvent.click(screen.getByRole("button", { name: "公式预览" }));
    await waitFor(() => expect(source.hidden).toBe(true));
    expect(
      view.container.querySelector(".side-source-preview annotation")
        ?.textContent,
    ).toBe("x^2");
    expect(assistant.complete).toHaveBeenCalledTimes(1);
    expect(assistant.stream).not.toHaveBeenCalled();
    fireEvent.keyDown(view.container.querySelector(".side-source-preview")!, {
      key: "Enter",
      ctrlKey: true,
    });
    await waitFor(() => expect(assistant.complete).toHaveBeenCalledTimes(2));
  });

  it("renders recognized image formulas and restores formula previews from the session draft", async () => {
    const original = String.raw`Growth \(\tilde{\ell}\gg1\).`;
    const translation = String.raw`增长 \(\tilde{\ell}\gg1\)。`;
    const assistant = {
      ...idleAssistant(),
      complete: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ source: original, translation })),
    };
    const view = render(<SidePanel assistant={assistant} />);
    pasteImage(await screen.findByLabelText("输入要翻译的文字"));
    fireEvent.click(await screen.findByRole("button", { name: "翻译图片" }));
    await waitFor(() =>
      expect(
        view.container.querySelectorAll(".side-source-preview .katex"),
      ).toHaveLength(1),
    );
    expect(view.container.querySelectorAll(".side-output .katex")).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    expect(speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: original }),
    );
    await waitFor(() =>
      expect(session.kSidePanelDraft).toEqual(
        expect.objectContaining({
          imageOriginal: original,
          output: translation,
        }),
      ),
    );
    view.unmount();
    const reopened = render(<SidePanel assistant={assistant} />);
    await waitFor(() =>
      expect(
        reopened.container.querySelectorAll(".side-source-preview .katex"),
      ).toHaveLength(1),
    );
    expect(
      reopened.container.querySelectorAll(".side-output .katex"),
    ).toHaveLength(1);
    expect(assistant.complete).toHaveBeenCalledTimes(1);
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

  it("saves source and translation speeds separately and restores playback at those speeds", async () => {
    session.kSidePanelDraft = {
      source: "Hello",
      output: "你好",
      resultSource: "Hello",
      tool: "translate",
    };
    const assistant = idleAssistant();
    const view = render(<SidePanel assistant={assistant} />);
    const sourceRate = await screen.findByRole<HTMLSelectElement>("combobox", {
      name: "原文语速",
    });
    const translationRate = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "译文语速",
    });
    expect(sourceRate.value).toBe("0.8");
    expect(translationRate.value).toBe("1");
    fireEvent.change(sourceRate, { target: { value: "0.6" } });
    await waitFor(() =>
      expect(storage.config).toMatchObject({
        sidePanel: { sourceSpeechRate: 0.6, translationSpeechRate: 1 },
      }),
    );
    fireEvent.change(translationRate, { target: { value: "1.25" } });
    await waitFor(() =>
      expect(storage.config).toMatchObject({
        sidePanel: { sourceSpeechRate: 0.6, translationSpeechRate: 1.25 },
      }),
    );
    view.unmount();
    render(<SidePanel assistant={assistant} />);
    expect(
      (
        await screen.findByRole<HTMLSelectElement>("combobox", {
          name: "原文语速",
        })
      ).value,
    ).toBe("0.6");
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "译文语速" })
        .value,
    ).toBe("1.25");
    await screen.findByDisplayValue("Hello");
    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    expect(speak).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "Hello", lang: "en-US", rate: 0.6 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "朗读译文" }));
    expect(speak).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "你好", lang: "zh-CN", rate: 1.25 }),
    );
    expect(assistant.complete).not.toHaveBeenCalled();
    expect(assistant.stream).not.toHaveBeenCalled();
  });

  it("previews a pasted image and only submits its image-only translation when requested", async () => {
    const assistant = imageAssistant();
    render(<SidePanel assistant={assistant} />);
    const source =
      await screen.findByLabelText<HTMLTextAreaElement>("输入要翻译的文字");
    pasteImage(source);
    const preview = await screen.findByRole<HTMLImageElement>("img", {
      name: "待翻译的图片",
    });
    expect(preview.src).toBe(IMAGE_DATA_URL);
    expect(source.value).toBe("");
    expect(assistant.supportsStreaming).not.toHaveBeenCalled();
    expect(assistant.complete).not.toHaveBeenCalled();
    expect(assistant.stream).not.toHaveBeenCalled();
    const translate = screen.getByRole<HTMLButtonElement>("button", {
      name: "翻译图片",
    });
    expect(translate.disabled).toBe(false);
    fireEvent.click(translate);
    await waitFor(() =>
      expect(assistant.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "translate",
          service: "chatgpt",
          text: "请翻译图片中的文字。",
          image: { dataUrl: IMAGE_DATA_URL },
        }),
        expect.any(AbortSignal),
      ),
    );
    expect(storage.kSidePanelHistory).toEqual([]);
  });

  it("restores an image draft without translating and prevents empty submission after removal", async () => {
    const assistant = idleAssistant();
    const view = render(<SidePanel assistant={assistant} />);
    pasteImage(await screen.findByLabelText("输入要翻译的文字"));
    await screen.findByRole("img", { name: "待翻译的图片" });
    await waitFor(() =>
      expect(session.kSidePanelDraft).toEqual(
        expect.objectContaining({
          source: "",
          image: { dataUrl: IMAGE_DATA_URL, name: "clipboard.png" },
        }),
      ),
    );
    view.unmount();
    render(<SidePanel assistant={assistant} />);
    const restored = await screen.findByRole<HTMLImageElement>("img", {
      name: "待翻译的图片",
    });
    expect(restored.src).toBe(IMAGE_DATA_URL);
    expect(assistant.supportsStreaming).not.toHaveBeenCalled();
    expect(assistant.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移除图片" }));
    expect(screen.queryByRole("img", { name: "待翻译的图片" })).toBeNull();
    const translate = screen.getByRole<HTMLButtonElement>("button", {
      name: "翻译文字",
    });
    expect(translate.disabled).toBe(true);
    fireEvent.click(translate);
    expect(assistant.complete).not.toHaveBeenCalled();
    expect(assistant.stream).not.toHaveBeenCalled();
  });

  it("previews a captured webpage without using the model until translation is requested", async () => {
    const assistant = imageAssistant();
    render(<SidePanel assistant={assistant} />);
    await screen.findByLabelText("输入要翻译的文字");
    fireEvent.click(screen.getByRole("button", { name: "截取网页" }));
    await screen.findByRole("img", { name: "待翻译的图片" });
    expect(browserMock.tabs.captureVisibleTab).toHaveBeenCalledWith(2, {
      format: "png",
    });
    expect(assistant.supportsStreaming).not.toHaveBeenCalled();
    expect(assistant.complete).not.toHaveBeenCalled();
    expect(assistant.stream).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "翻译图片" }));
    await waitFor(() =>
      expect(assistant.complete).toHaveBeenCalledWith(
        expect.objectContaining({ image: { dataUrl: IMAGE_DATA_URL } }),
        expect.any(AbortSignal),
      ),
    );
  });

  it("reads the recognized original image text instead of the translation response envelope", async () => {
    const assistant = imageAssistant();
    const view = render(<SidePanel assistant={assistant} />);
    const source =
      await screen.findByLabelText<HTMLTextAreaElement>("输入要翻译的文字");
    pasteImage(source);
    await screen.findByRole("img", { name: "待翻译的图片" });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "朗读原文" })
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "翻译图片" }));
    await waitFor(() => expect(source.value).toBe(IMAGE_SOURCE));
    expect(view.container.querySelector(".side-output")?.textContent).toBe(
      IMAGE_TRANSLATION,
    );
    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    expect(speak).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: IMAGE_SOURCE, lang: "en-US" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "朗读译文" }));
    expect(speak).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: IMAGE_TRANSLATION, lang: "zh-CN" }),
    );
    expect(assistant.complete).toHaveBeenCalledTimes(1);
    expect(assistant.stream).not.toHaveBeenCalled();
  });

  it("keeps image instructions separate from the recognized original on retry and draft restore", async () => {
    const assistant = imageAssistant();
    const view = render(<SidePanel assistant={assistant} />);
    const source =
      await screen.findByLabelText<HTMLTextAreaElement>("输入要翻译的文字");
    pasteImage(source);
    await screen.findByRole("img", { name: "待翻译的图片" });
    const notes = await screen.findByLabelText("翻译要求（可选）");
    fireEvent.input(notes, { target: { value: "保留英文人名" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译图片" }));
    await waitFor(() => expect(source.value).toBe(IMAGE_SOURCE));
    fireEvent.click(screen.getByRole("button", { name: "翻译图片" }));
    await waitFor(() => expect(assistant.complete).toHaveBeenCalledTimes(2));
    for (const [request] of vi.mocked(assistant.complete).mock.calls) {
      expect(request).toEqual(
        expect.objectContaining({
          text: "保留英文人名",
          image: { dataUrl: IMAGE_DATA_URL },
        }),
      );
    }
    await waitFor(() =>
      expect(session.kSidePanelDraft).toEqual(
        expect.objectContaining({
          source: "保留英文人名",
          imageOriginal: IMAGE_SOURCE,
          output: IMAGE_TRANSLATION,
        }),
      ),
    );
    view.unmount();
    const reopened = render(<SidePanel assistant={assistant} />);
    await screen.findByDisplayValue(IMAGE_SOURCE);
    await screen.findByDisplayValue("保留英文人名");
    expect(reopened.container.querySelector(".side-output")?.textContent).toBe(
      IMAGE_TRANSLATION,
    );
    expect(assistant.complete).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "移除图片" }));
    expect(screen.queryByRole("img", { name: "待翻译的图片" })).toBeNull();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("输入要翻译的文字").value,
    ).toBe(IMAGE_SOURCE);
    expect(screen.queryByLabelText("翻译要求（可选）")).toBeNull();
    expect(assistant.complete).toHaveBeenCalledTimes(2);
  });

  it("reports missing recognized image text without retrying or reading the translation as original", async () => {
    const assistant = imageAssistant();
    vi.mocked(assistant.complete).mockResolvedValue(
      JSON.stringify({ translation: IMAGE_TRANSLATION }),
    );
    render(<SidePanel assistant={assistant} />);
    const source =
      await screen.findByLabelText<HTMLTextAreaElement>("输入要翻译的文字");
    pasteImage(source);
    await screen.findByRole("img", { name: "待翻译的图片" });
    fireEvent.click(screen.getByRole("button", { name: "翻译图片" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/识别|原文/);
    expect(source.value).toBe("");
    const readOriginal = screen.getByRole<HTMLButtonElement>("button", {
      name: "朗读原文",
    });
    expect(readOriginal.disabled).toBe(true);
    fireEvent.click(readOriginal);
    expect(speak).not.toHaveBeenCalled();
    expect(assistant.complete).toHaveBeenCalledTimes(1);
    expect(assistant.stream).not.toHaveBeenCalled();
  });

  it("explains that image translation requires ChatGPT before making any model request", async () => {
    storage.config = {
      ...structuredClone(DEFAULT_CONFIG),
      uiLanguage: "zh-CN",
      service: "google",
      sidePanel: { ...DEFAULT_CONFIG.sidePanel, service: "google" },
    };
    const assistant = idleAssistant();
    render(<SidePanel assistant={assistant} />);
    pasteImage(await screen.findByLabelText("输入要翻译的文字"));
    await screen.findByRole("img", { name: "待翻译的图片" });
    fireEvent.click(screen.getByRole("button", { name: "翻译图片" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "图片翻译目前支持 ChatGPT 账号（OAuth），请在设置中切换翻译服务。",
    );
    expect(assistant.supportsStreaming).not.toHaveBeenCalled();
    expect(assistant.complete).not.toHaveBeenCalled();
    expect(assistant.stream).not.toHaveBeenCalled();
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
