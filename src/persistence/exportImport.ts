/**
 * Manual export and import of the complete save envelope.
 *
 * An import is validated and migrated before the player is asked to confirm,
 * and a backup is written before the imported state replaces the current one.
 */

import type { GameState } from "../domain/state";
import { runMigrations, type RawEnvelope } from "./migrations";
import {
  createEnvelope,
  saveJsonReplacer,
  validateEnvelope,
  verifyEnvelopeChecksum,
} from "./saveSchema";
import type { NormalizationReport, SaveEnvelope } from "./saveSchema";

export const EXPORT_FILE_NAME = "lunar-jackpot-save.json";
export const EXPORT_MIME_TYPE = "application/json";

export function exportSave(envelope: SaveEnvelope): string {
  /*
   * The same replacer the checksum uses, and it has to be: `JSON.stringify`
   * turns `Infinity` into `null`, so without it a rolled-over balance would
   * export as nothing and import as zero. Sharing the rule is what keeps an
   * exported infinite save passing its own checksum on the way back in.
   */
  return JSON.stringify(envelope, saveJsonReplacer, 2);
}

export function exportGameState(
  game: GameState,
  revision: number,
  nowUnixMs: number,
): string {
  return exportSave(createEnvelope(game, revision, nowUnixMs));
}

export type ImportResult =
  | { ok: true; envelope: SaveEnvelope; report: NormalizationReport; migrated: number[] }
  | { ok: false; reason: string };

/** Parses and validates without touching stored data. */
export function parseImport(text: string, nowUnixMs: number): ImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, reason: `The file is not valid JSON: ${String(error)}` };
  }

  const verified = verifyEnvelopeChecksum(parsed);

  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }

  const migrated = runMigrations(parsed as RawEnvelope);
  const validation = validateEnvelope(migrated.envelope, nowUnixMs, { verifyChecksum: false });

  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  return {
    ok: true,
    envelope: validation.envelope,
    report: validation.report,
    migrated: migrated.appliedVersions,
  };
}

/** A short human summary shown in the destructive-import confirmation. */
export function describeImport(envelope: SaveEnvelope): string {
  const saved = new Date(envelope.savedAtUnixMs);
  const cash = envelope.game.resources.cash.toLocaleString("en-US");

  return [
    `Saved ${saved.toLocaleString("en-US")}`,
    `revision ${envelope.revision}`,
    `prestige ${envelope.game.prestige.count}`,
    `${cash} cash`,
  ].join(", ");
}
