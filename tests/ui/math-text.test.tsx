import { cleanup, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { hasMath, MathText } from "../../src/ui/sidepanel/math-text";

afterEach(cleanup);

describe("side panel math", () => {
  it.each([
    [String.raw`能量 \(E=mc^2\)。`, false],
    [String.raw`能量 $E=mc^2$。`, false],
    [String.raw`\[\frac{a}{b}=\sqrt{x}\]`, true],
    [
      String.raw`$$\Delta\psi\to\left(\frac{\tilde{t}}{\tilde{t}_{\mathrm{rec}}}\right)^{\frac{\delta+3/2}{\delta+1}}$$`,
      true,
    ],
    [String.raw`\begin{equation}\nabla\alpha=0\tag{24}\end{equation}`, true],
    [String.raw`\begin{align*}a&=b\\c&=d\end{align*}`, true],
  ])("renders supported delimiters and environments: %s", (text, display) => {
    const { container } = render(<MathText text={text} />);
    expect(hasMath(text)).toBe(true);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(Boolean(container.querySelector(".katex-display"))).toBe(display);
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("keeps code examples literal while rendering surrounding formulas", () => {
    const text = "`$x$`\n```latex\n\\(y\\)\n```\nOutside $z^2$.";
    const { container } = render(<MathText text={text} />);
    expect(container.querySelector("code")?.textContent).toBe("`$x$`");
    expect(container.querySelector("pre")?.textContent).toContain("\\(y\\)");
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(hasMath("`$x$`\n```latex\n\\(y\\)\n```")).toBe(false);
  });

  it("updates incomplete streamed formulas and replaces prior render trees", () => {
    const { container, rerender } = render(
      <MathText text={String.raw`Text \(\frac{1}`} />,
    );
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe(String.raw`Text \(\frac{1}`);
    rerender(<MathText text={String.raw`Text \(\frac{1}{2}\)`} />);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    rerender(<MathText text="下一段普通文字" />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe("下一段普通文字");
  });

  it("leaves malformed formulas readable without hiding surrounding prose", () => {
    const { container } = render(
      <MathText text={String.raw`Before \(\frac{1}\) after.`} />,
    );
    expect(container.querySelector(".katex-error")?.textContent).toBe(
      String.raw`\frac{1}`,
    );
    expect(container.textContent).toContain("Before ");
    expect(container.textContent).toContain(" after.");
  });

  it("treats HTML as text and disables external resources and unsafe links", () => {
    const text = String.raw`<img src=x onerror=alert(1)><script>alert(1)</script> \(\href{javascript:alert(1)}{link}\) \(\includegraphics{https://example.com/track}\)`;
    const { container } = render(<MathText text={text} />);
    expect(container.querySelector("img, script, a, iframe")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
  });
});
