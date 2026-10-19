export const MAX_ASSISTANT_IMAGE_BYTES = 5 * 1024 * 1024;

export interface AssistantImage {
  dataUrl: string;
}

/** Accept only a local, base64-encoded image and bound its decoded size. */
export function validateAssistantImageDataUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("图片数据无效，请重新粘贴或选择图片。");
  }
  // Reject an oversized value before scanning its complete base64 payload.
  const maxEncodedLength = Math.ceil(MAX_ASSISTANT_IMAGE_BYTES / 3) * 4;
  if (value.length > maxEncodedLength + 32) {
    throw new Error("图片不能超过 5 MiB，请裁剪或压缩后重试。");
  }
  const prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
  if (!prefix) {
    throw new Error("图片仅支持 PNG、JPEG 或 WebP 格式。");
  }
  const encoded = value.slice(prefix[0].length);
  if (
    !encoded.length ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error("图片数据无效，请重新粘贴或选择图片。");
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedBytes = (encoded.length / 4) * 3 - padding;
  if (decodedBytes > MAX_ASSISTANT_IMAGE_BYTES) {
    throw new Error("图片不能超过 5 MiB，请裁剪或压缩后重试。");
  }
  return value;
}

export function assertAssistantImage(
  value: unknown,
): asserts value is AssistantImage {
  if (typeof value !== "object" || value === null || !("dataUrl" in value)) {
    throw new Error("图片数据无效，请重新粘贴或选择图片。");
  }
  validateAssistantImageDataUrl(value.dataUrl);
}
