import { describe, expect, it } from "vitest";

import {
  MAX_ASSISTANT_IMAGE_BYTES,
  assertAssistantImage,
  validateAssistantImageDataUrl,
} from "../../src/shared/assistant-image";

describe("assistant image validation", () => {
  it.each(["png", "jpeg", "webp"])("accepts a local %s image", (format) => {
    const dataUrl = `data:image/${format};base64,aGVsbG8=`;
    expect(validateAssistantImageDataUrl(dataUrl)).toBe(dataUrl);
    expect(() => assertAssistantImage({ dataUrl })).not.toThrow();
  });

  it.each([
    "https://example.com/image.png",
    "data:text/html;base64,aGVsbG8=",
    "data:image/svg+xml;base64,aGVsbG8=",
    "data:image/png,aGVsbG8=",
    "data:image/png;base64,",
    "data:image/png;base64,AA=",
    "data:image/png;base64,A===",
    "data:image/png;base64,AA A",
    "data:image/png;base64,AA-A",
  ])("rejects invalid or remote data: %s", (value) => {
    expect(() => validateAssistantImageDataUrl(value)).toThrow();
  });

  it("uses the decoded size, including base64 padding, for the 5 MiB limit", () => {
    const maximum = Buffer.alloc(MAX_ASSISTANT_IMAGE_BYTES).toString("base64");
    const tooLarge = Buffer.alloc(MAX_ASSISTANT_IMAGE_BYTES + 1).toString(
      "base64",
    );
    expect(() =>
      validateAssistantImageDataUrl(`data:image/png;base64,${maximum}`),
    ).not.toThrow();
    expect(() =>
      validateAssistantImageDataUrl(`data:image/png;base64,${tooLarge}`),
    ).toThrow("5 MiB");
  });

  it.each([null, {}, { dataUrl: null }, { dataUrl: 123 }])(
    "rejects a malformed image envelope",
    (value) => {
      expect(() => assertAssistantImage(value)).toThrow("图片数据无效");
    },
  );
});
