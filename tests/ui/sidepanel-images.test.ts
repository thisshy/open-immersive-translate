import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  tabs: {
    query: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
}));
vi.mock("webextension-polyfill", () => ({ default: browserMock }));

import {
  captureTabImage,
  pastedImage,
  readClipboardImage,
  readImageFile,
} from "../../src/ui/sidepanel/images";

const readClipboard = vi.fn();
const IMAGE_DATA_URL = "data:image/png;base64,aGVsbG8=";

beforeEach(() => {
  readClipboard.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { read: readClipboard },
  });
  browserMock.tabs.query.mockReset().mockResolvedValue([
    {
      id: 4,
      windowId: 2,
      url: "https://example.com/article",
    },
  ]);
  browserMock.tabs.captureVisibleTab
    .mockReset()
    .mockResolvedValue(IMAGE_DATA_URL);
});

describe("sidebar image input", () => {
  it("reads supported files as validated data URLs", async () => {
    const file = new File(["hello"], "figure.png", { type: "image/png" });
    await expect(readImageFile(file)).resolves.toEqual({
      dataUrl: IMAGE_DATA_URL,
      name: "figure.png",
    });
  });

  it("rejects unsupported, empty, and oversized images before reading them", async () => {
    const oversized = new File(["hello"], "large.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 5 * 1024 * 1024 + 1 });
    await expect(
      readImageFile(new File(["hello"], "figure.gif", { type: "image/gif" })),
    ).rejects.toThrow("仅支持 PNG");
    await expect(
      readImageFile(new File([], "empty.png", { type: "image/png" })),
    ).rejects.toThrow("图片为空");
    await expect(readImageFile(oversized)).rejects.toThrow("5 MiB");
  });

  it("finds a pasted image among text items and ignores missing files", () => {
    const file = new File(["hello"], "pasted.png", { type: "image/png" });
    const items = [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => file },
    ] as DataTransferItem[];
    expect(pastedImage(items)).toBe(file);
    expect(pastedImage(items.slice(0, 2))).toBeUndefined();
  });

  it("reads an image from clipboard items alongside text", async () => {
    const getType = vi
      .fn()
      .mockResolvedValue(new Blob(["hello"], { type: "image/png" }));
    readClipboard.mockResolvedValue([
      { types: ["text/plain"] },
      { types: ["image/png"], getType },
    ]);
    await expect(readClipboardImage()).resolves.toEqual({
      dataUrl: IMAGE_DATA_URL,
      name: "clipboard.png",
    });
    expect(getType).toHaveBeenCalledWith("image/png");
  });

  it("offers normal paste when clipboard access is denied", async () => {
    readClipboard.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    await expect(readClipboardImage()).rejects.toThrow("Ctrl+V");
  });

  it("reports no image or unsupported clipboard images clearly", async () => {
    readClipboard.mockResolvedValue([{ types: ["text/plain"] }]);
    await expect(readClipboardImage()).rejects.toThrow("剪贴板里没有图片");
    readClipboard.mockResolvedValue([{ types: ["image/gif"] }]);
    await expect(readClipboardImage()).rejects.toThrow("仅支持 PNG");
  });
});

describe("sidebar webpage capture", () => {
  it("captures the active webpage in its window without sending a model request", async () => {
    await expect(captureTabImage()).resolves.toEqual({
      dataUrl: IMAGE_DATA_URL,
      name: "screenshot.png",
    });
    expect(browserMock.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(browserMock.tabs.captureVisibleTab).toHaveBeenCalledWith(2, {
      format: "png",
    });
  });

  it.each([
    "chrome://extensions/",
    "chrome-extension://sample/options.html",
    "edge://settings/",
    "file:///private/image.png",
    undefined,
  ])("does not capture protected or unsupported page %s", async (url) => {
    browserMock.tabs.query.mockResolvedValue([{ id: 4, windowId: 2, url }]);
    await expect(captureTabImage()).rejects.toThrow("这个页面无法截图");
    expect(browserMock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("reports capture failures and rejects an invalid screenshot payload", async () => {
    browserMock.tabs.captureVisibleTab.mockRejectedValue(new Error("Denied"));
    await expect(captureTabImage()).rejects.toThrow("截图失败");
    browserMock.tabs.captureVisibleTab.mockResolvedValue(
      "https://example.com/image.png",
    );
    await expect(captureTabImage()).rejects.toThrow();
  });
});
