/**
 * Conventional Commits — enforced by the husky `commit-msg` hook.
 *
 * Format: <type>(<scope>): <description>
 *
 * The allow-list mirrors CLAUDE.md → Git commit policy. Scope is optional but
 * encouraged (`core`, `vite-plugin`, `example`, `agents`, `playwright`, `mcp`,
 * `ci`, `deps`). Subject is imperative, lower-case, no trailing period, ≤72 chars.
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "refactor",
        "docs",
        "chore",
        "test",
        "perf",
        "build",
        "ci",
        "revert",
        "style",
      ],
    ],
    "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
  },
};
