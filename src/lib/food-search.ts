/**
 * Tolerant food-name matching (PLAN Part 7), shared by the saved-foods search
 * and the bundled generic-food search.
 *
 * Why this exists: both searches used SQL `LIKE`, which only answers "is this
 * exact text in there". Saved-food search matched the WHOLE query as one
 * contiguous substring, so "garlic herb cream cheese" could never find
 * "Garlic and Herb Cream Cheese" — one unanticipated word ("and") in the
 * middle was enough to lose it, while the shorter "cream cheese" found it
 * fine. Matching is therefore done in JS against a normalized form, scored
 * rather than filtered, so near-misses still surface and rank sensibly.
 *
 * Scoring shape: every query word contributes its best match against the
 * candidate's words (exact > prefix > substring > small typo), the total is
 * averaged over the query length, and contiguous-phrase / leading-match
 * bonuses lift the obvious wins to the top. A candidate must match at least
 * half the query words, which is what keeps a common word like "cheese" from
 * dragging in the whole database when four words were typed.
 */

/** Below this many normalized characters, searching isn't meaningful yet. */
const MIN_QUERY_LENGTH = 2;

/** A query token shorter than this is too ambiguous for typo tolerance. */
const MIN_FUZZY_TOKEN = 4;
/** Above this length a token may be off by two characters, else one. */
const TWO_EDIT_TOKEN = 7;
/** Score of the best possible typo match (one edit) — see tokenScore. */
const BEST_FUZZY_SCORE = 0.55;

// Combining marks left behind by NFD decomposition ("e" + U+0301 for "é").
// Built from an escaped string rather than a regex literal: the literal
// characters are invisible in an editor and get mangled by any tool that
// guesses at the file's encoding.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;

/**
 * Fold to comparable text: strip accents, lowercase, and turn every run of
 * punctuation into a single space. Punctuation matters here — USDA names are
 * comma-heavy ("Cheese, cream") and brand names are full of &/-/', none of
 * which anybody types.
 *
 * `normalize` is feature-detected rather than assumed: it is standard ES6 and
 * present in Hermes, but this file must not be the thing that breaks the
 * bundle if that ever changes on an older engine.
 */
export function normalizeText(raw: string): string {
  const folded =
    typeof raw.normalize === 'function' ? raw.normalize('NFD').replace(DIACRITICS, '') : raw;
  return folded.toLowerCase().replace(NON_ALPHANUMERIC, ' ').trim();
}

/** A candidate prepared for repeated scoring (normalize/split done once). */
export interface SearchTarget {
  text: string;
  words: string[];
}

export function prepareTarget(raw: string): SearchTarget {
  const text = normalizeText(raw);
  return { text, words: text.length ? text.split(' ') : [] };
}

export interface ParsedQuery {
  /** Whole normalized query, for contiguous-phrase bonuses. */
  normalized: string;
  tokens: string[];
}

/** Returns null when the query is too short to search on. */
export function parseQuery(raw: string): ParsedQuery | null {
  const normalized = normalizeText(raw);
  if (normalized.length < MIN_QUERY_LENGTH) return null;
  return { normalized, tokens: normalized.split(' ') };
}

/**
 * Levenshtein distance, abandoned as soon as it provably exceeds `max`
 * (returns `max + 1`). The bound is what keeps this affordable to run across
 * thousands of candidates: the length pre-check alone rejects most pairs
 * without allocating, and the per-row early exit stops the rest early.
 */
// Reused across calls: this runs ~100k times for a two-word query over the
// seed database, and allocating two rows per call was the single biggest
// cost in the whole search (it dominated the profile at ~30ms/keystroke).
let prevRow: number[] = [];
let currRow: number[] = [];

export function editDistanceWithin(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  if (prevRow.length < b.length + 1) {
    prevRow = new Array<number>(b.length + 1);
    currRow = new Array<number>(b.length + 1);
  }
  let prev = prevRow;
  let curr = currRow;
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowBest = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      curr[j] = value;
      if (value < rowBest) rowBest = value;
    }
    // Every future row is >= this row's minimum, so nothing can come back
    // under the bound once the whole row has.
    if (rowBest > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** Best score one query word can achieve against a candidate's words. */
function tokenScore(token: string, words: string[], allowFuzzy: boolean): number {
  let best = 0;
  for (const word of words) {
    if (word === token) return 1;
    if (word.startsWith(token)) {
      if (best < 0.9) best = 0.9;
      continue;
    }
    if (token.length >= 3 && word.includes(token)) {
      if (best < 0.75) best = 0.75;
      continue;
    }
    // A typo match tops out at BEST_FUZZY_SCORE, so once a real substring hit
    // has beaten that there is nothing left for the expensive path to win.
    if (allowFuzzy && best < BEST_FUZZY_SCORE && token.length >= MIN_FUZZY_TOKEN) {
      const max = token.length >= TWO_EDIT_TOKEN ? 2 : 1;
      const distance = editDistanceWithin(token, word, max);
      // 1 edit -> 0.55, 2 edits -> 0.40: always below a real substring hit,
      // so typo matches fill in behind exact ones rather than displacing them.
      if (distance <= max) {
        const score = 0.7 - 0.15 * distance;
        if (best < score) best = score;
      }
    }
  }
  return best;
}

/**
 * 0 means "not a match". Higher is better; values above 1 are possible
 * because of the phrase bonuses, which is intended — an exact phrase hit
 * should outrank any accumulation of partial word matches.
 *
 * `allowFuzzy: false` skips typo tolerance entirely, which is dramatically
 * cheaper. Callers should run that pass first and only fall back to the
 * fuzzy one when it returns too little — see `searchWithFallback`.
 */
export function scoreMatch(
  target: SearchTarget,
  query: ParsedQuery,
  allowFuzzy = true,
): number {
  if (!target.words.length) return 0;

  if (!allowFuzzy) {
    // Exact pass: one native substring test over the whole name rejects the
    // vast majority of candidates before any per-word looping.
    let possible = false;
    for (const token of query.tokens) {
      if (target.text.includes(token)) {
        possible = true;
        break;
      }
    }
    if (!possible) return 0;
  }

  let sum = 0;
  let matched = 0;
  for (const token of query.tokens) {
    const score = tokenScore(token, target.words, allowFuzzy);
    if (score > 0) {
      matched++;
      sum += score;
    }
  }
  if (matched === 0) return 0;
  // Half the typed words have to land somewhere, or a four-word query would
  // return everything sharing its most common word.
  if (matched * 2 < query.tokens.length) return 0;

  let score = sum / query.tokens.length;
  if (target.text.includes(query.normalized)) score += 0.4;
  if (target.text.startsWith(query.normalized)) score += 0.25;
  return score;
}

/** Below this many hits, it's worth paying for typo tolerance. */
const FUZZY_FALLBACK_THRESHOLD = 5;
/**
 * A score this high means some candidate matched essentially every word the
 * user typed. Anything lower means at least one word found nothing, which is
 * what a typo looks like — and counting hits alone can't see that: "chiken
 * breast" turns up plenty of exact matches on "breast" (quail, pheasant,
 * turkey) while the word that actually mattered matched nothing.
 */
const STRONG_MATCH_SCORE = 0.9;

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Score `items` against the query, exact-first: the cheap pass runs over
 * everything, and the fuzzy pass only runs when the exact one came back
 * thin. That is precisely when the user has mistyped or half-typed something
 * — the case where the extra work buys a result instead of burning battery
 * confirming what the fast pass already found.
 */
export function searchWithFallback<T>(
  items: readonly T[],
  query: ParsedQuery,
  targetOf: (item: T) => SearchTarget,
): Scored<T>[] {
  const collect = (allowFuzzy: boolean): Scored<T>[] => {
    const hits: Scored<T>[] = [];
    for (const item of items) {
      const score = scoreMatch(targetOf(item), query, allowFuzzy);
      if (score > 0) hits.push({ item, score });
    }
    return hits;
  };

  const exact = collect(false);
  let best = 0;
  for (const hit of exact) {
    if (hit.score > best) best = hit.score;
  }
  if (exact.length >= FUZZY_FALLBACK_THRESHOLD && best >= STRONG_MATCH_SCORE) return exact;
  // The fuzzy pass is a strict superset — it only ever adds match
  // opportunities — so its results replace rather than merge with the above.
  return collect(true);
}
