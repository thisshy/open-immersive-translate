import browser from "webextension-polyfill";
import {
  MAX_ASSISTANT_IMAGE_BYTES,
  validateAssistantImageDataUrl,
} from "../../shared/assistant-image";

export interface ImageAttachment {
  dataUrl: string;
  name: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function readImageFile(file: File): Promise<ImageAttachment> {
  if (!Object.hasOwn(IMAGE_EXTENSIONS, file.type)) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 图片。");
  }
  if (file.size > MAX_ASSISTANT_IMAGE_BYTES) {
    throw new Error("图片不能超过 5 MiB，请截取较小的区域后重试。");
  }
  if (file.size === 0) {
    throw new Error("图片为空，请重新复制或选择图片。");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("读取图片失败，请重新复制或选择图片。"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () =>
      reject(new Error("读取图片失败，请重新复制或选择图片。"));
    reader.onabort = () => reject(new Error("图片读取已取消。"));
    reader.readAsDataURL(file);
  });

  return {
    dataUrl: validateAssistantImageDataUrl(dataUrl),
    name: file.name || `image.${IMAGE_EXTENSIONS[file.type]}`,
  };
}

export function pastedImage(
  items: DataTransferItemList | readonly DataTransferItem[],
): File | undefined {
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return undefined;
}

export async function readClipboardImage(): Promise<ImageAttachment> {
  if (typeof navigator.clipboard?.read !== "function") {
    throw new Error("无法读取剪贴板图片，请按 Ctrl+V 粘贴或选择图片文件。");
  }

  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error("无法读取剪贴板图片，请按 Ctrl+V 粘贴或选择图片文件。");
  }

  let hasUnsupportedImage = false;
  for (const item of items) {
    for (const type of item.types) {
      if (Object.hasOwn(IMAGE_EXTENSIONS, type)) {
        let blob: Blob;
        try {
          blob = await item.getType(type);
        } catch {
          throw new Error(
            "读取剪贴板图片失败，请按 Ctrl+V 粘贴或选择图片文件。",
          );
        }
        return readImageFile(
          new File([blob], `clipboard.${IMAGE_EXTENSIONS[type]}`, { type }),
        );
      }
      if (type.startsWith("image/")) hasUnsupportedImage = true;
    }
  }

  throw new Error(
    hasUnsupportedImage
      ? "仅支持 PNG、JPEG 和 WebP 图片。"
      : "剪贴板里没有图片，请先截图或复制一张图片。",
  );
}

export async function captureTabImage(): Promise<ImageAttachment> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error(
      "这个页面无法截图，请先打开普通网页，或截图后按 Ctrl+V 粘贴。",
    );
  }

  let dataUrl: string;
  try {
    dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
  } catch {
    throw new Error("当前网页截图失败，请使用系统截图后按 Ctrl+V 粘贴。");
  }

  return {
    dataUrl: validateAssistantImageDataUrl(dataUrl),
    name: "screenshot.png",
  };
}
