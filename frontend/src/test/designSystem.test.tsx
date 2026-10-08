import { AnswerOption, GapBadge, LevelBadge, ProgressBar, Prose, gapFromScore, levelFromScore } from "@isker/design-system";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("design system helpers", () => {
  it("maps scores to the five EntreComp levels", () => {
    expect([0, 39, 40, 59, 60, 79, 80, 89, 90, 100].map(levelFromScore)).toEqual([
      "Foundation", "Foundation", "Developing", "Developing", "Intermediate", "Intermediate", "Advanced", "Advanced", "Proficient", "Proficient",
    ]);
  });
  it("classifies gaps against the target", () => {
    expect(gapFromScore(48, 70)).toBe("High");
    expect(gapFromScore(55, 70)).toBe("Medium");
    expect(gapFromScore(65, 70)).toBe("Low");
  });
});

describe("design system components", () => {
  it("GapBadge always shows a word, not only colour", () => {
    render(<GapBadge score={40} target={70} />);
    expect(screen.getByText("High gap")).toBeInTheDocument();
  });
  it("LevelBadge derives the level from a score", () => {
    render(<LevelBadge score={82} />);
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });
  it("ProgressBar exposes accessible values", () => {
    render(<ProgressBar value={72} label="Overall" />);
    const bar = screen.getByRole("progressbar", { name: "Overall" });
    expect(bar).toHaveAttribute("aria-valuenow", "72");
  });
  it("AnswerOption is a radio with checked state", () => {
    render(<AnswerOption label="Ask customers" checked index={1} />);
    expect(screen.getByRole("radio", { name: /Ask customers/ })).toHaveAttribute("aria-checked", "true");
  });
  it("Prose renders markdown structure and never injects HTML", () => {
    const { container } = render(<Prose source={"## Title\nSome **bold** text.\n\n- one\n- two\n\n<script>alert(1)</script>"} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});
