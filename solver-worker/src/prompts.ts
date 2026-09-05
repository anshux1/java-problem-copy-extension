import type { SolveRequest } from "./schema";

function section(title: string, value: string): string {
  return `## ${title}\n${value.trim() || "Not provided."}`;
}

function renderCards(cards: SolveRequest["logical"]): string {
  if (!cards.length) return "Not provided.";
  return cards
    .map((card) => {
      const fields = card.fields.map((field) => `- ${field.label}:\n${field.value}`).join("\n");
      return `### ${card.title}\n${fields}`;
    })
    .join("\n\n");
}

export function stripJavaComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function extractPublicClassName(code: string): string | null {
  const withoutComments = stripJavaComments(code);
  return withoutComments.match(/\bpublic\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)\b/)?.[1] ?? null;
}

export function mandatoryFragments(input: SolveRequest): string[] {
  return input.mandatory
    .flatMap((card) => card.fields.map((field) => field.value.trim()))
    .filter(Boolean);
}

export const SYSTEM_PROMPT = `You are an expert Java 11 solver for an eLab auto-grader.
Return only one complete runnable Java program in a single \`\`\`java code block, with no prose outside it.
Preserve the starter template's public class name and required method signatures exactly.
Follow the exact input and output formats. Include every mandatory fragment verbatim.
Do not call, describe, or simulate Save, Reset, Run, Evaluate, or submission actions.`;

export function buildUserPrompt(input: SolveRequest): string {
  const className = extractPublicClassName(input.starterCode);
  return [
    "# Programming Problem",
    section("Runtime", input.language),
    section("Required public class", className || "Preserve the class declared in the starter code."),
    section("Problem Description", input.problem),
    section("Functional Description", input.functional),
    section("Constraints", input.constraints),
    section("Input Format", input.inputFormat),
    section("Output Format", input.outputFormat),
    `## Logical Test Cases\n${renderCards(input.logical)}`,
    `## Mandatory Requirements\n${renderCards(input.mandatory)}`,
    `## Complexity Requirements\n${renderCards(input.complexity)}`,
    `## Starter Code\n\`\`\`java\n${input.starterCode.trim()}\n\`\`\``,
    "## Final instruction\nProduce the complete solution now. Keep the required public class name and every mandatory fragment exactly."
  ].join("\n\n");
}
