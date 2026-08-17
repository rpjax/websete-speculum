/**
 * Structural DOM tree shape — pure data, no DOM types (same rule as `frame.ts`: this file
 * must be importable by tsc-side lab code without pulling `lib.dom.d.ts` into the project's
 * global lib, which collides with unrelated legacy `Node`-named types elsewhere in this repo).
 * The DOM-walking producer of this shape (`client/domTreeSnapshot.ts`) lives in the
 * esbuild-only, DOM-typed side of the codebase and is never imported from tsc-checked code —
 * see `lab/virtualSnapshot.ts` for how the server side obtains one without that import.
 */

export type TreeNode = {
  tag: string;
  /** Omitted when HTML. `svg` / `mathml` / `none` / custom URI otherwise. */
  ns?: string;
  attrs?: [string, string][];
  text?: string;
  children?: TreeNode[];
};
