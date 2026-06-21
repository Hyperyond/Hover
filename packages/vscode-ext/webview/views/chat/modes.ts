/** Mode catalogue + icons for the in-composer mode picker (ported from the
 *  legacy webview). `normal` maps to a null modeId on the wire. */
export const MODE_ICONS: Record<string, string> = {
  normal:
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.2H11l-1 8.8 8.6-12.2H12.1L13 2z"/></svg>',
  qa: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.4-4.4"/></svg>',
  "api-test":
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6l7-3z"/></svg>',
  pentest:
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3a7 7 0 0 0-3.6 13V18a1 1 0 0 0 1 1H10v-2M12 3a7 7 0 0 1 3.6 13V18a1 1 0 0 1-1 1H14v-2M9.5 19h5"/><circle cx="9.2" cy="11.5" r="1.4" fill="currentColor"/><circle cx="14.8" cy="11.5" r="1.4" fill="currentColor"/></svg>',
};

export interface ModeDef {
  value: string;
  icon: string;
  title: string;
  tag?: string;
  desc: string;
}

export const MODES: ModeDef[] = [
  { value: "normal", icon: MODE_ICONS.normal, title: "Flow", desc: "AI drives the flow you describe → one Playwright spec" },
  {
    value: "qa",
    icon: MODE_ICONS.qa,
    title: "QA Testing",
    tag: "Experimental",
    desc: "Explore the whole app → findings report + promotable specs",
  },
  // API testing and Pentest are no longer standalone modes — they are capability
  // toggles inside QA Testing (compose the api-test / pentest MITM runtimes).
  // Kept out of the picker; the plugins still load so QA can compose them.
];

export function modeIcon(id: string | null): string {
  return MODE_ICONS[id || "normal"] || MODE_ICONS.normal;
}
