import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechButton } from "../../src/ui/sidepanel/speech";

class MockUtterance {
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

const voices = [
  { lang: "en-US", localService: true, name: "English" },
  { lang: "zh-CN", localService: true, name: "Chinese" },
] as SpeechSynthesisVoice[];

let spoken: MockUtterance[];
let engine: {
  getVoices: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  spoken = [];
  engine = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn((utterance: MockUtterance) => spoken.push(utterance)),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("speechSynthesis", engine);
  vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("side panel speech", () => {
  it("applies the chosen speed and restarts only its own active playback", () => {
    const sourceRate = vi.fn();
    const translationRate = vi.fn();
    const view = render(
      <>
        <SpeechButton
          text="Hello"
          language="en"
          label="朗读原文"
          rate={0.8}
          rateLabel="原文语速"
          onRateChange={sourceRate}
        />
        <SpeechButton
          text="你好"
          language="zh-CN"
          label="朗读译文"
          rate={1}
          rateLabel="译文语速"
          onRateChange={translationRate}
        />
      </>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "原文语速" }), {
      target: { value: "0.6" },
    });
    expect(sourceRate).toHaveBeenCalledWith(0.6);
    expect(engine.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    expect(spoken[0]?.rate).toBe(0.8);
    const oldEnd = spoken[0]?.onend;
    fireEvent.change(screen.getByRole("combobox", { name: "译文语速" }), {
      target: { value: "0.5" },
    });
    expect(translationRate).toHaveBeenCalledWith(0.5);
    expect(engine.cancel).not.toHaveBeenCalled();
    expect(engine.speak).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("combobox", { name: "原文语速" }), {
      target: { value: "0.75" },
    });
    expect(sourceRate).toHaveBeenLastCalledWith(0.75);
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(spoken[1]?.rate).toBe(0.75);
    expect(spoken[1]?.text).toBe("Hello");
    act(() => oldEnd?.());
    expect(screen.getByRole("button", { name: "停止朗读原文" })).toBeTruthy();
    view.rerender(
      <>
        <SpeechButton
          text="Hello"
          language="en"
          label="朗读原文"
          rate={0.75}
          rateLabel="原文语速"
          onRateChange={sourceRate}
        />
        <SpeechButton
          text="你好"
          language="zh-CN"
          label="朗读译文"
          rate={0.5}
          rateLabel="译文语速"
          onRateChange={translationRate}
        />
      </>,
    );
    expect(engine.speak).toHaveBeenCalledTimes(2);
    act(() => spoken[1]?.onend?.());
    expect(screen.getByRole("button", { name: "朗读原文" })).toBeTruthy();
  });

  it("reads with the selected language, stops, and reports playback errors", () => {
    render(<SpeechButton text="你好" language="auto" label="朗读原文" />);
    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    expect(spoken[0]?.text).toBe("你好");
    expect(spoken[0]?.lang).toBe("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "停止朗读原文" }));
    expect(engine.cancel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    act(() => spoken[1]?.onerror?.({ error: "audio-busy" }));
    expect(screen.getByRole("alert").textContent).toContain("朗读失败");
    expect(screen.getByRole("button", { name: "朗读原文" })).toBeTruthy();
  });

  it("switches ownership between the source and translation buttons", () => {
    render(
      <>
        <SpeechButton text="Hello" language="en" label="朗读原文" />
        <SpeechButton text="你好" language="zh-CN" label="朗读译文" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    fireEvent.click(screen.getByRole("button", { name: "朗读译文" }));
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "朗读原文" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止朗读译文" })).toBeTruthy();
    act(() => spoken[1]?.onend?.());
    expect(screen.getByRole("button", { name: "朗读译文" })).toBeTruthy();
  });

  it("only cancels its own audio when content changes or the component unmounts", () => {
    const source = render(
      <SpeechButton text="Hello" language="en" label="朗读原文" />,
    );
    const translation = render(
      <SpeechButton text="你好" language="zh-CN" label="朗读译文" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "朗读原文" }));
    source.rerender(
      <SpeechButton text="Goodbye" language="en" label="朗读原文" />,
    );
    expect(engine.cancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "朗读译文" }));
    source.unmount();
    expect(engine.cancel).toHaveBeenCalledOnce();
    translation.unmount();
    expect(engine.cancel).toHaveBeenCalledTimes(2);
  });

  it("disables speech with an explanation when local language voices are absent", () => {
    render(<SpeechButton text="Bonjour" language="fr" label="朗读原文" />);
    const button = screen.getByRole("button", { name: "朗读原文" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.title).toContain("本地语音");
    expect(engine.speak).not.toHaveBeenCalled();
  });
});
