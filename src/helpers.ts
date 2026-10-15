// Shared utility helpers used across the plugin.

/**
 * A Promise whose resolve/reject methods are exposed as properties, so the
 * caller can fulfill it from outside the constructor callback.
 */
export class PromiseCapability<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;
  /** true once resolve() or reject() has been called. */
  settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = (value) => {
        this.settled = true;
        resolve(value);
      };
      this.reject = (reason) => {
        this.settled = true;
        // A rejection should always carry an Error, so the reason has a stack
        // and a readable message rather than a bare string or object.
        reject(reason instanceof Error ? reason : new Error(describeError(reason)));
      };
    });
  }
}

/** Log only in development builds. */
export function debugLog(...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'production') {
    // `debug` (not `log`): Obsidian's review allows warn/error/debug only.
    console.debug(...args);
  }
}

/**
 * A readable message for an unknown thrown value. `String(value)` alone would
 * render a plain object as "[object Object]", so objects go through JSON.
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);
  try {
    return JSON.stringify(e) ?? 'Unknown error';
  } catch {
    return 'Unserializable error';
  }
}

/**
 * UTF-8 text → base64. Replaces the deprecated
 * `btoa(unescape(encodeURIComponent(text)))` idiom: `unescape` is a legacy
 * browser feature, and encoding the bytes explicitly is clearer and faster.
 */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked: spreading a huge byte array would exceed the argument limit of
  // String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Vault-relative folder holding the plugin's caches (Zotero library, CSL
 * styles/locales, parsed bibliographies, rendered citations, link maps).
 * Renamed from the ancestral `.pandoc`; migrated on first run by
 * `ReferenceList.migrateCacheDir()`.
 */
export const SW_CACHE_DIR = '.scholar-weft';

/** Previous cache folder name, migrated to {@link SW_CACHE_DIR} on first run. */
export const SW_CACHE_DIR_LEGACY = '.pandoc';

/**
 * Copy an HTMLElement's content to the clipboard as both rich-text HTML and
 * plain text, so pasting into a word processor preserves formatting while
 * pasting into a plain-text editor gives readable text.
 */
export async function copyElToClipboard(el: HTMLElement): Promise<void> {
  const html = el.outerHTML;
  const text = el.innerText ?? el.textContent ?? '';

  if (
    typeof ClipboardItem !== 'undefined' &&
    navigator.clipboard?.write
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain-text fallback.
    }
  }

  await copyTextToClipboard(text);
}

/** Copy a plain string to the clipboard. */
export async function copyTextToClipboard(text: string): Promise<void> {
  // The async Clipboard API is present in every Obsidian runtime (desktop
  // Electron and the mobile WebView), so the old hidden-textarea
  // `document.execCommand('copy')` fallback is no longer needed.
  await navigator.clipboard.writeText(text);
}
