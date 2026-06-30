import type { Page } from 'playwright-core';
import { groundedLocate, type GroundedTarget, type SkillStep } from '@hover-dev/core/engine';

/*
 * The hover-mcp engine, decoupled from the MCP wire layer so it's testable with
 * a mock Page. The user's OWN agent (Claude Code / Cursor) calls these via MCP:
 * it reads the page (snapshot), actuates with GROUNDED targets (role+name →
 * testId → text), and Hover buffers each successful actuation as a SkillStep.
 * `crystallize` turns the buffer into a plain Playwright spec — record==replay,
 * because the buffered selectors ARE the ones that drove the page.
 */

export type FactType = 'business-rule' | 'expected-behavior' | 'validation' | 'access-policy';

export interface McpDeps {
  /** Resolve the live page on the app under test (launch/connect lazily). */
  getPage: () => Promise<Page>;
  /** Write the buffered steps to a spec; returns the written path. */
  crystallize: (name: string, description: string | undefined, steps: SkillStep[]) => Promise<{ path: string }>;
  /** Persist a learned business rule to .hover/memory/ (rules only — no secrets). */
  recordFact?: (title: string, rule: string, type: FactType) => Promise<{ path: string } | { error: string }>;
  /** Recall known business knowledge from .hover/memory/ as a prompt block ('' if none). */
  recall?: () => Promise<string>;
}

function describe(g: GroundedTarget): string {
  if (g.role && g.name) return `${g.role} "${g.name}"`;
  if (g.testId) return `testId "${g.testId}"`;
  if (g.text) return `text "${g.text}"`;
  return '(no target)';
}

export class HoverMcpController {
  /** The grounded-action buffer — sliced by `crystallize`. */
  readonly steps: SkillStep[] = [];

  constructor(private readonly deps: McpDeps) {}

  private push(tool: string, input: unknown): void {
    this.steps.push({ kind: 'step', tool, input });
  }

  private async resolve(g: GroundedTarget) {
    const page = await this.deps.getPage();
    const loc = groundedLocate(page, g);
    if (!loc) throw new Error(`pass role+name (preferred), or testId, or text — taken from the snapshot`);
    return loc;
  }

  async navigate(url: string): Promise<string> {
    const page = await this.deps.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    this.push('browser_navigate', { url });
    return `navigated to ${url}`;
  }

  /** ARIA snapshot of the page — the agent reads role+name from here. */
  async snapshot(): Promise<string> {
    const page = await this.deps.getPage();
    return await page.locator('body').ariaSnapshot();
  }

  async click(g: GroundedTarget): Promise<string> {
    const loc = await this.resolve(g);
    await loc.click({ timeout: 8000 });
    this.push('click_control', g);
    return `✓ clicked ${describe(g)}`;
  }

  async fill(g: GroundedTarget, value: string): Promise<string> {
    const loc = await this.resolve(g);
    await loc.fill(value, { timeout: 8000 });
    this.push('fill_control', { ...g, value });
    return `✓ filled ${describe(g)}`;
  }

  async select(g: GroundedTarget, value: string): Promise<string> {
    const loc = await this.resolve(g);
    await loc.selectOption(value, { timeout: 8000 });
    this.push('select_control', { ...g, value });
    return `✓ selected ${value} in ${describe(g)}`;
  }

  async check(g: GroundedTarget, checked: boolean): Promise<string> {
    const loc = await this.resolve(g);
    if (checked) await loc.check({ timeout: 8000 });
    else await loc.uncheck({ timeout: 8000 });
    this.push('check_control', { ...g, checked });
    return `✓ ${checked ? 'checked' : 'unchecked'} ${describe(g)}`;
  }

  async assertVisible(g: GroundedTarget): Promise<string> {
    const loc = await this.resolve(g);
    const visible = await loc.first().isVisible();
    if (!visible) throw new Error(`${describe(g)} is not visible`);
    this.push('assert_visible', { ...g, matcher: 'visible' });
    return `✓ ${describe(g)} is visible`;
  }

  /** Recall what earlier runs learned about this app's business rules. */
  async recall(): Promise<string> {
    if (!this.deps.recall) return 'No business memory available.';
    const known = await this.deps.recall();
    return known || 'No business knowledge recorded yet for this app.';
  }

  /** Persist a confirmed business RULE so future runs don't re-ask it. Rules
   *  only — never secrets / credentials / PII. */
  async recordFact(title: string, rule: string, type: FactType = 'business-rule'): Promise<string> {
    if (!this.deps.recordFact) return 'Memory channel unavailable; continuing.';
    const res = await this.deps.recordFact(title, rule, type);
    return 'error' in res ? `✗ could not save fact: ${res.error}` : `✓ remembered: ${title}`;
  }

  /** Crystallize the buffered flow → a plain Playwright spec, then clear the
   *  buffer for the next flow. */
  async crystallize(name: string, description?: string): Promise<string> {
    if (this.steps.length === 0) return 'Nothing to crystallize yet — actuate some controls first.';
    const flow = [...this.steps];
    const { path } = await this.deps.crystallize(name, description, flow);
    this.steps.length = 0;
    return `✓ wrote ${path} (${flow.length} step${flow.length === 1 ? '' : 's'})`;
  }
}
