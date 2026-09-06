/**
 * Deterministic brief-generation fixture (feature 020 — request kind added
 * during implementation: the learning-brief dialog fires a brief-generation
 * request during onboarding, and 017's protocol-fidelity bar (FR-002) requires
 * the stand-in to answer every request mode the app actually uses).
 *
 * Shape: GeneratedBriefSchema (src/lib/ai/generate/generate-brief.ts) — strict
 * object, `goal` required, optional enum fields only. Keep values inside the
 * schema's enums; extra keys are rejected by .strict().
 */
export const BRIEF_FIXTURE = {
	goal: 'be able to explain photosynthesis with a labeled diagram',
	level: 'some',
	mode: 'explainer',
	scopeStrategy: 'guided-curriculum'
};
