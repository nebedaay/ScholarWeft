// YAML frontmatter builder for the single-file note template.
//
// The point of this module is that a template author never types YAML: they add
// PROPERTIES, and this serialiser decides quoting, indentation, block scalars,
// and omission of empty values. That removes the whole "one stray space or blank
// line breaks Obsidian's parser" failure mode.
//
// Output style follows Obsidian's own Properties writer:
//   - block scalars (multi-line values) are `|-` with two-space-indented lines
//     and NO surrounding quotes;
//   - single-line scalars are double-quoted ONLY when YAML would otherwise
//     misread them (`: ` or ` #`, a leading indicator such as `[[`, a value that
//     looks like a number/bool/null, an empty or space-padded value, …);
//   - empty/`null`/`undefined` values add no property at all unless forced.
//
// It is pure — no Obsidian imports, no I/O — so it is unit-testable on its own.
// The template helpers (`start_YAML()` / `add_property()` / `end_YAML()`) are
// thin wrappers around a `YamlBuilder` held in the per-render state.

/** A scalar YAML value the builder knows how to serialise. */
export type YamlScalar = string | number | boolean;

/** A property value: a scalar, a list of scalars, or nothing. */
export type YamlValue = YamlScalar | YamlScalar[] | null | undefined;

/**
 * How a re-import reconciles a managed property with the value already on
 * disk. Mirrors ZotLit's frontmatter merge strategies.
 *   - `replace` (default): the freshly rendered value wins (an empty value
 *     removes the property);
 *   - `append`: list items already present are kept verbatim and the new ones
 *     are added, so hand-added tags/links survive;
 *   - `keep`: the existing value wins unless it is empty (write-once).
 */
export type FrontmatterMerge = 'replace' | 'append' | 'keep';

export interface YamlPropertyOptions {
  /**
   * Emit the property even when the value is empty (`""` or `[]`). Off by
   * default, which is what lets a template add optional values unconditionally.
   */
  force?: boolean;
  /**
   * Quoting policy for single-line scalars. `auto` (default) quotes only when
   * required; `always` / `never` force or suppress quoting. Block scalars are
   * never quoted regardless.
   */
  quote?: 'auto' | 'always' | 'never';
  /** Re-import reconciliation strategy. Default `replace`. */
  merge?: FrontmatterMerge;
}

/** One managed property: its key, merge strategy, and rendered lines. */
export interface YamlFieldSpec {
  key: string;
  merge: FrontmatterMerge;
  /** Serialised lines (empty when the value was omitted). */
  lines: string[];
}

const INDENT = '  ';

/** A leading character that makes a bare YAML scalar ambiguous. */
const INDICATOR_RE = /^[\s\-?:,[\]{}#&*!|>'"%@`]/;

const NUMBER_LIKE_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const BOOL_NULL_LIKE_RE = /^(?:true|false|null|~|yes|no|on|off)$/i;
const KEY_SAFE_RE = /^[A-Za-z0-9_.-]+$/;

/** Does this string need double quotes to round-trip as a string? */
export function needsQuotes(
  value: string,
  quote: 'auto' | 'always' | 'never' = 'auto'
): boolean {
  if (quote === 'always') return true;
  if (quote === 'never') return false;
  if (value === '') return true;
  if (value !== value.trim()) return true;
  if (INDICATOR_RE.test(value)) return true;
  if (/:\s/.test(value) || /\s#/.test(value)) return true;
  if (/["\\\t]/.test(value)) return true;
  if (BOOL_NULL_LIKE_RE.test(value)) return true;
  if (NUMBER_LIKE_RE.test(value)) return true;
  return false;
}

function quoteString(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function serializeScalar(
  value: YamlScalar,
  quote: 'auto' | 'always' | 'never'
): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return needsQuotes(value, quote) ? quoteString(value) : value;
}

/**
 * A multi-line string as a `|-` block scalar: two-space indent, no quotes, and
 * the trailing newline stripped (the `-` chomp), matching Obsidian.
 */
function serializeBlockScalar(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  // Drop the value's own trailing newline so `|-` (strip) is exact.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const body = lines.map((line) => (line === '' ? '' : INDENT + line)).join('\n');
  return `|-\n${body}`;
}

function serializeKey(key: string): string {
  return KEY_SAFE_RE.test(key) ? key : quoteString(key);
}

/**
 * Serialise one property into zero or more YAML lines (no trailing newline).
 * Returns `[]` when the value is empty and `force` is off.
 */
export function serializeProperty(
  key: string,
  value: YamlValue,
  opts: YamlPropertyOptions = {}
): string[] {
  const quote = opts.quote ?? 'auto';
  const k = serializeKey(key);

  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    if (value.length === 0) return opts.force ? [`${k}: []`] : [];
    return [
      `${k}:`,
      ...value.map((item) => `${INDENT}- ${serializeScalar(item, quote)}`),
    ];
  }

  if (typeof value === 'string') {
    if (value === '') return opts.force ? [`${k}: ""`] : [];
    if (/[\n\r]/.test(value)) {
      return `${k}: ${serializeBlockScalar(value)}`.split('\n');
    }
    return [`${k}: ${serializeScalar(value, quote)}`];
  }

  return [`${k}: ${serializeScalar(value, quote)}`];
}

/**
 * Build a frontmatter block from a property list. Convenience for tests and for
 * callers that have the whole list up front; the template path uses the
 * stateful {@link YamlBuilder} instead.
 */
export function buildYaml(
  entries: Array<[string, YamlValue, YamlPropertyOptions?]>
): string {
  const builder = new YamlBuilder();
  builder.start();
  for (const [key, value, opts] of entries) builder.add(key, value, opts);
  return builder.end();
}

/**
 * Stateful frontmatter builder used by the `start_YAML()` / `add_property()` /
 * `end_YAML()` helpers. Guards against misuse with clear errors, because a
 * silently misplaced property is exactly what this module exists to prevent.
 */
export class YamlBuilder {
  private lines: string[] = [];
  private specs: YamlFieldSpec[] = [];
  private open = false;
  private finished = false;

  get isOpen(): boolean {
    return this.open;
  }

  start(): void {
    if (this.open) throw new Error('[sw yaml] start_YAML() called twice');
    if (this.finished) {
      throw new Error('[sw yaml] start_YAML() called after end_YAML()');
    }
    this.open = true;
  }

  add(key: string, value: YamlValue, opts?: YamlPropertyOptions): void {
    this.assertOpen('add_property');
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('[sw yaml] add_property() needs a non-empty key');
    }
    const lines = serializeProperty(key, value, opts);
    this.lines.push(...lines);
    // Record EVERY managed key, even one omitted for being empty, so a
    // re-import knows it is in scope (an empty `replace` removes it).
    this.specs.push({ key, merge: opts?.merge ?? 'replace', lines });
  }

  /** The managed fields, in template order, for the re-import merge. */
  fieldSpecs(): YamlFieldSpec[] {
    return this.specs.map((s) => ({ ...s, lines: [...s.lines] }));
  }

  /** Escape hatch: insert verbatim YAML lines (a user spelling it out). */
  addRaw(text: string): void {
    this.assertOpen('add_raw_yaml');
    if (typeof text !== 'string') return;
    const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (body) this.lines.push(...body.split('\n'));
  }

  /** Serialise the block and mark the builder finished. */
  end(): string {
    if (!this.open) throw new Error('[sw yaml] end_YAML() without start_YAML()');
    this.open = false;
    this.finished = true;
    return ['---', ...this.lines, '---', ''].join('\n');
  }

  private assertOpen(fn: string): void {
    if (!this.open) throw new Error(`[sw yaml] ${fn}() outside start_YAML()`);
  }
}
