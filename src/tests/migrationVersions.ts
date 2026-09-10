/**
 * The migration versions a save of a given age has to walk through, derived from
 * `SAVE_VERSION` rather than spelled out as a literal in each test — otherwise
 * every new migration fails eight tests for the same uninteresting reason.
 *
 * The assertion that matters is unchanged: a save at version `from` is walked
 * all the way to current, one step at a time, with no version skipped.
 *
 * Not a `.test.ts` file, so vitest's `include` will not try to run it.
 */

import { SAVE_VERSION } from "../persistence/saveSchema";

export function migrationVersionsFrom(from: number): number[] {
  return Array.from({ length: Math.max(0, SAVE_VERSION - from) }, (_, index) => from + index);
}
