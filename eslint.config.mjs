// ESLint flat config for ScholarWeft.
//
// Runs the SAME rules the Obsidian community-directory review uses
// (`eslint-plugin-obsidianmd`), plus the type-checked typescript-eslint set it
// bundles, so a local `npm run lint` reports what a submission would.
//
// Dev-only: nothing here ships in main.js.

import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

/**
 * Rules the directory review reports as WARNINGS. The plugin's recommended
 * config raises them to errors; matching the review's severity keeps
 * `npm run lint` exit code meaningful — it should fail on what would fail a
 * submission, not on the long tail of strictness rules.
 */
const reviewWarnings = {
  "@typescript-eslint/no-unsafe-assignment": "warn",
  "@typescript-eslint/no-unsafe-member-access": "warn",
  "@typescript-eslint/no-unsafe-call": "warn",
  "@typescript-eslint/no-unsafe-argument": "warn",
  "@typescript-eslint/no-unsafe-return": "warn",
  "@typescript-eslint/no-unsafe-enum-comparison": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-floating-promises": "warn",
  "@typescript-eslint/no-misused-promises": "warn",
  "@typescript-eslint/no-unnecessary-type-assertion": "warn",
  "@typescript-eslint/no-require-imports": "warn",
  "@typescript-eslint/no-base-to-string": "warn",
  "@typescript-eslint/prefer-promise-reject-errors": "warn",
  // The wrapper rule that reports console logging (and other builtin rules the
  // directory only warns about). `no-console` cannot be disabled per-line — the
  // plugin forbids it — so severity is the only lever, and the review warns.
  "obsidianmd/rule-custom-message": "warn",
  // The directory reports redundant regex escapes as a warning, and one of
  // ours is deliberate: `\[` inside a character class is redundant, but
  // removing it reorders the class and risks the closing bracket.
  "no-useless-escape": "warn",
  // Sentence case for UI text, with the plugin's own proper nouns declared so
  // the rule does not "correct" ScholarWeft -> Scholarweft, LibreOffice ->
  // libreoffice, or the literal property name `sw-zotero-id` -> `sw-Zotero-id`.
  "obsidianmd/ui/sentence-case": [
    "warn",
    {
      mode: "loose",
      brands: [
        "ScholarWeft",
        "Zotero",
        "ZotLit",
        "Pandoc",
        "LibreOffice",
        "Better BibTeX",
        "BibTeX",
        "LaTeX",
        "LuaLaTeX",
        "Markdown",
        "Templater",
      ],
      acronyms: ["TOC", "CSL", "ODT", "DOCX", "PDF", "URL", "YAML", "ID"],
      ignoreRegex: ["sw-zotero-id", "zotero-key", "zotero-note-key", "@[a-z]", "/usr/", "\\.docx", "\\.odt", "odt/docx"],
    },
  ],
};

export default defineConfig([
  {
    // Build output, bundled assets, scratch space, and tests are not shipped
    // source. Tests are also excluded from the tsconfig project, so the
    // type-aware rules could not run over them anyway.
    ignores: [
      "main.js",
      "tmp/**",
      "node_modules/**",
      "scripts/**",
      "docs/**",
      "sw-export-templates/**",
      "sw-literature-note-templates/**",
      "sw-markdown-templates/**",
      "tools/**",
      "install/**",
      "src/**/tests/**",
      "src/**/*.test.ts",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      ...reviewWarnings,
      // TypeScript already reports undefined identifiers, and the browser/node
      // globals this plugin legitimately uses are not in the base config's
      // list — `no-undef` here is all false positives.
      "no-undef": "off",
    },
  },
]);
