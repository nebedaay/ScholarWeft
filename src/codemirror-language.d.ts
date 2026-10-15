// Obsidian ships a patched build of `@codemirror/language` (lishid/cm-language)
// that adds `tokenClassNodeProp` — the node property its markdown parser sets
// on link/code/math/hashtag tokens, which `editorExtension.ts` reads to decide
// whether a citation sits inside one of them.
//
// esbuild externalises `@codemirror/language`, so at runtime the import always
// resolves to Obsidian's own copy and the property is present. Only the *type*
// is missing, because the published npm package is upstream CodeMirror. Declare
// the extra export here rather than depending on a git fork of the package.
import type { NodeProp } from '@lezer/common';

declare module '@codemirror/language' {
	export const tokenClassNodeProp: NodeProp<string>;
}
