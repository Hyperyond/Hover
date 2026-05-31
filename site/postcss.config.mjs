/** Tailwind v4 is wired through its PostCSS plugin; no tailwind.config needed —
 *  theme + content scanning are configured CSS-first in app/globals.css. */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
