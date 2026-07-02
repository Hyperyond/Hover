/**
 * `.css` files are imported as plain text (esbuild's `text` loader, configured
 * in tsup.config.ts) and inlined into a webview's `<style>` block. This ambient
 * declaration tells TypeScript the default export is the stylesheet string.
 */
declare module "*.css" {
  const content: string;
  export default content;
}

/** `.txt` assets (e.g. the CI drift-report script) are imported as plain text
 *  via the same esbuild `text` loader and written out to the user's repo. */
declare module "*.txt" {
  const content: string;
  export default content;
}
