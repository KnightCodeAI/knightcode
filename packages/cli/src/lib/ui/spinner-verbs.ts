/** Playful loading verbs, ported from the reference TUI/src/constants/spinnerVerbs.ts. */
export const SPINNER_VERBS = [
  "Accomplishing",
  "Actioning",
  "Architecting",
  "Baking",
  "Brewing",
  "Calculating",
  "Cerebrating",
  "Channelling",
  "Churning",
  "Coalescing",
  "Cogitating",
  "Composing",
  "Computing",
  "Concocting",
  "Conjuring",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Crystallizing",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Distilling",
  "Doing",
  "Effecting",
  "Elucidating",
  "Envisioning",
  "Fermenting",
  "Finagling",
  "Forging",
  "Forming",
  "Generating",
  "Germinating",
  "Hatching",
  "Herding",
  "Honking",
  "Ideating",
  "Imagining",
  "Improvising",
  "Incubating",
  "Inferring",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Mulling",
  "Mustering",
  "Musing",
  "Noodling",
  "Percolating",
  "Pondering",
  "Processing",
  "Puzzling",
  "Reticulating",
  "Ruminating",
  "Scheming",
  "Shimmying",
  "Simmering",
  "Smooshing",
  "Spelunking",
  "Spinning",
  "Stewing",
  "Summoning",
  "Synthesizing",
  "Thinking",
  "Tinkering",
  "Transmuting",
  "Unfurling",
  "Vibing",
  "Whirring",
  "Working",
  "Wrangling",
] as const;

/** Pick a random verb once per turn (the reference TUI samples on mount). */
export function pickVerb(): string {
  const i = Math.floor(Math.random() * SPINNER_VERBS.length);
  return SPINNER_VERBS[i] ?? "Working";
}

/**
 * Deterministic verb for a turn seed (e.g. its start timestamp) so the verb
 * stays fixed across mid-turn remounts instead of reshuffling each phase.
 */
export function verbForSeed(seed: number): string {
  const i = Math.abs(Math.floor(seed)) % SPINNER_VERBS.length;
  return SPINNER_VERBS[i] ?? "Working";
}

/** Past-tense verbs for the turn-completion line ("Cooked for 15m 17s"). */
export const TURN_COMPLETION_VERBS = [
  "Baked",
  "Brewed",
  "Churned",
  "Cogitated",
  "Cooked",
  "Crunched",
  "Sautéed",
  "Worked",
] as const;

export function pickCompletionVerb(): string {
  const i = Math.floor(Math.random() * TURN_COMPLETION_VERBS.length);
  return TURN_COMPLETION_VERBS[i] ?? "Worked";
}
