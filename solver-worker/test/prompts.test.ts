import { describe, expect, it } from "vitest";
import { buildUserPrompt, extractPublicClassName, mandatoryFragments } from "../src/prompts";
import { sampleRequest } from "./fixtures";

describe("prompt builder", () => {
  it("preserves the student-specific public class", () => {
    expect(extractPublicClassName(sampleRequest.starterCode)).toBe("ClassRA2682241010202");
    expect(buildUserPrompt(sampleRequest)).toContain("Required public class\nClassRA2682241010202");
  });

  it("includes all mandatory fragments and the starter code", () => {
    const prompt = buildUserPrompt(sampleRequest);
    for (const fragment of mandatoryFragments(sampleRequest)) expect(prompt).toContain(fragment);
    expect(prompt).toContain(sampleRequest.starterCode);
  });
});
