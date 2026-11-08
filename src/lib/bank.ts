// The question bank's vocabulary (docs/CONTENT-LIFECYCLE-REUSE.md, phase 4). Pure, so
// client components can share it. Items reuse the assessment-item and Bloom vocabularies,
// so a copy lands in a project without translation.

export const BANK_KINDS = ["question", "scenario"] as const;
export type BankKind = (typeof BANK_KINDS)[number];
export const BANK_KIND_LABEL: Record<BankKind, string> = { question: "Question", scenario: "Scenario" };

/** Same cap as a project's assessment item prompt, so every bank item copies whole. */
export const BANK_PROMPT_MAX = 500;
