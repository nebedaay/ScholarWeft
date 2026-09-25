/**
 * Zotero annotation colour → palette name.
 *
 * Adapted from ZotLit (AGPL-3.0) — `packages/db/src/lib/zt-color.ts`. The first
 * eight are Zotero's reader palette (5 from Z6, 3 added in Z7). The last two are
 * never offered in the reader; they are written by importers (Citavi) or predate
 * the current palette (Adobe's default highlight sits between yellow and orange).
 *
 * Per the plugin's own choice, the two legacy colours are mapped to the NEAREST
 * CURRENT colour rather than being given their own names, so every annotation
 * renders with a name the callout stylesheet defines:
 *   #FF8C19 (pre-Z7 orange) → yellow
 *   #A6507B (plum)          → purple
 *
 * @see NOTICE.md — ZotLit attribution.
 */
const ANNOTATION_COLOR_NAMES: Record<string, string> = {
  // Zotero reader palette (Z6).
  '#FFD400': 'yellow',
  '#FF6666': 'red',
  '#5FB236': 'green',
  '#2EA8E5': 'blue',
  '#A28AE5': 'purple',
  // Added to the reader palette in Zotero 7.
  '#E56EEE': 'magenta',
  '#F19837': 'orange',
  '#AAAAAA': 'gray',
  // Legacy / importer-written — mapped to the closest current colour.
  '#FF8C19': 'yellow',
  '#A6507B': 'purple',
};

export function annotationColorToName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ANNOTATION_COLOR_NAMES[raw.toUpperCase()] ?? null;
}
