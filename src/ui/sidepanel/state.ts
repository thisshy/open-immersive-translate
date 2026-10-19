import browser from "webextension-polyfill";
import { assertAssistantImage } from "../../shared/assistant-image";
import type { ImageAttachment } from "./images";
export type TextTool = "translate" | "explain" | "polish" | "summarize";
export interface SidePanelDraft {
  source: string;
  output: string;
  resultSource: string;
  tool: TextTool;
  image?: ImageAttachment;
  imageOriginal?: string;
}
const DRAFT_KEY = "kSidePanelDraft";
// Drafts last for this browser session; translation history is stored separately.
export async function loadDraft(): Promise<SidePanelDraft | undefined> {
  try {
    const value: unknown = (await browser.storage.session?.get(DRAFT_KEY))?.[
      DRAFT_KEY
    ];
    if (!value || typeof value !== "object") return;
    const draft = value as Partial<SidePanelDraft>;
    if (
      typeof draft.source !== "string" ||
      typeof draft.output !== "string" ||
      typeof draft.resultSource !== "string" ||
      !["translate", "explain", "polish", "summarize"].includes(
        draft.tool ?? "",
      )
    )
      return;
    if (draft.image !== undefined) {
      assertAssistantImage(draft.image);
      if (typeof draft.image.name !== "string") return;
    }
    if (
      draft.imageOriginal !== undefined &&
      typeof draft.imageOriginal !== "string"
    )
      return;
    return draft as SidePanelDraft;
  } catch {
    return;
  }
}
export async function saveDraft(draft: SidePanelDraft): Promise<void> {
  try {
    await browser.storage.session?.set({ [DRAFT_KEY]: draft });
  } catch {
    /* Draft storage must not prevent translation. */
  }
}
