<div align="center">

# Hover

<img src="docs/assets/banner.png" alt="Hover — 本地优先、开源的 AI 端到端测试编写方式" width="100%" />

<p>
  <a href="./README.md">English</a> · <b>简体中文</b>
</p>

<p>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" /></a>
  <a href="https://github.com/Hyperyond/Hover/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Hyperyond/Hover?style=flat-square&label=release&color=blueviolet" /></a>
  <a href="#路线图"><img alt="Phase 1 shipped" src="https://img.shields.io/badge/phase-1%20shipped-22c55e?style=flat-square" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://github.com/Hyperyond/Hover/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Hyperyond/Hover?style=flat-square&color=2ecc71" /></a>
  <a href="https://github.com/Hyperyond/Hover/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Hyperyond/Hover?style=flat-square&color=8e44ad" /></a>
  <a href="#工作原理"><img alt="Local CLI Agent First" src="https://img.shields.io/badge/architecture-Local%20CLI%20Agent%20First-black?style=flat-square" /></a>
</p>

</div>

---

在你的 dev 页面打开浮动聊天框，用中文（或者你喜欢的任何语言）描述要验证什么，看着 AI 真实地操作你的应用。一遍跑通后，点 **Save as spec** —— Hover 会写出一份标准的 `@playwright/test` 文件，CI 跑它的时候**完全不需要 AI 在场**。

```
┌──────────────────────────────────────────────────────────┐
│  自然语言描述 ── AI 通过 CDP 驱动你的 Chrome              │
│         │                                                │
│         ▼                                                │
│   browser_click、browser_type … （Playwright MCP）       │
│         │                                                │
│         ▼                                                │
│   验证通过的会话 ── Save as Playwright spec ──┐         │
│                                                ▼         │
│                       __vibe_tests__/login-flow.spec.ts  │
│                       （纯 @playwright/test, 无 AI 依赖）│
└──────────────────────────────────────────────────────────┘
```

## 实际效果

<table>
<tr>
<td width="50%" valign="top" align="center">
<sub><b>01 · dev 页面上的浮动 widget</b><br/><i>(截图待补)</i></sub>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/02-ai-driving.png" alt="02 · AI 正在填写真实表单" /><br/>
<sub><b>02 · AI 正在填写真实表单</b> —— Agent 正在填写券商开户的多步表单。注意右上角状态变为 <code>running</code>、Send 按钮变成红色的 <code>Stop</code>，右侧实时滚动每一次 <code>browser_*</code> 工具调用 —— 一旦看到走偏，立刻可以打断。</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top" align="center">
<sub><b>03 · Save as Playwright spec 弹窗</b><br/><i>(截图待补)</i></sub>
</td>
<td width="50%" valign="top" align="center">
<sub><b>04 · 生成的 spec 在 CI 中跑通</b><br/><i>(截图待补)</i></sub>
</td>
</tr>
</table>

## 为什么是 Hover

这个领域已有的三种方案，Hover 是把它们"诚实地"组合起来的产物：

| 工具 | 它做什么 | 缺什么 |
|---|---|---|
| **Playwright Codegen** | 录制你的点击 → spec | 不会思考；只能复读 |
| **Stagehand / Midscene** | 让 AI 在跑测试时驱动浏览器 | AI 永远在测试链路里 —— 慢、不稳、烧钱 |
| **Hover** | AI 只在**探索**时驱动浏览器一次；保存出确定性的 spec | AI 的工作在 "Save" 时结束；CI 跑的就是普通 Playwright |

差异点在于**交接**：AI 写测试，但产物跟 AI 解耦。

## Phase 1 里你能拿到的（当前 release）

- **Vite 插件** —— 通过 `transformIndexHtml` 往 dev 页面注入一个 Shadow DOM widget。生产构建里完全是 no-op。`data-hover="true"` 标记让你自己的 Playwright 跑测试时自动跳过它。
- **本地 Node 服务**绑在 `127.0.0.1`，连接 widget ↔ 你 `PATH` 上的 agent CLI（当前是 `claude`；`codex` / `cursor` / `aider` 都是一个文件就能加上）。
- **CDP 直连你已开的 Chrome** —— Hover 跟**你正在调试的那个 Chrome** 说话，绝不会启一个新的 Chromium。Cookie、DevTools 状态、你停留的那个页面 —— 全部保留。
- **Save as Playwright spec** → 落盘到 `__vibe_tests__/<slug>.spec.ts`，selector 用 `getByRole / getByLabel / getByTestId`，从 agent 描述元素的自然语言推断出来。
- **Save as Skill** → 落盘到 `.claude/skills/<slug>/SKILL.md`，未来对话里说一句 *"execute login-as-claude"* 就能重放。
- **Alt-click "Assert This"** —— 按住 ⌥ 点页面上任何元素，生成一条 Playwright 断言（`expect(...).toHaveValue / toBeChecked / toHaveText / …`）。断言会累积，下一次 *Save as spec* 时一起烘焙进文件。
- **录制模式** —— 切到 🔴 Record，手动跑一遍流程，得到跟 AI 驱动同样形状的 step 序列。下游 save 路径根本不关心 step 是 AI 跑出来的还是你点出来的。
- **会话持久化 + resume** —— widget 状态通过 `localStorage` 跨页面刷新存活；下次提示会接上同一个 `claude --session-id`。
- **严格的 agent 沙箱** —— 只有 Playwright MCP server 能被调用。`Bash`、`Edit`、`Write`、`Read`、`WebFetch` 等全部明确 deny。每次调用硬上限 `--max-budget-usd 0.50`。

## 快速开始

第一次需要三个终端。Chrome 和 Vite 起来之后会一直跑，跨多次 loop 都不用关。

```bash
git clone https://github.com/Hyperyond/Hover.git
cd Hover
pnpm install
pnpm --filter basic-app exec playwright install chromium   # 仅 `pnpm test:e2e` 需要
```

```bash
# 终端 1 —— debug 模式 Chrome，9222 端口，隔离 profile
pnpm smoke:chrome
```

```bash
# 终端 2 —— basic-app 跑在 http://localhost:5173
pnpm dev:example:basic-app
```

```bash
# 终端 3 —— 跑 AI 烟雾测试（CDP 预检 → 调起 claude → 流式输出事件）
pnpm smoke
# 或者自定义目标 + 提示：
pnpm smoke http://localhost:5173/ "登录然后加一条名为 'verify hover' 的 todo"
```

或者直接在 debug Chrome 里打开 `http://localhost:5173/`，点 ✨ 浮动按钮，往 widget 里输入指令。

## 安装

```bash
pnpm add -D @hyperyond/vite-plugin
# 或者:  npm install -D @hyperyond/vite-plugin
# 或者:  yarn add -D @hyperyond/vite-plugin
```

<details>
<summary>一次性鉴权配置（GitHub Packages 仓库）</summary>

Hover 发布在 GitHub Packages，不在 npm.org。在你项目根目录加一个 `.npmrc`（这文件可以提交进 git，里面没有真实 secret）：

```ini
@hyperyond:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

然后导出一个有 `read:packages` 权限的 Personal Access Token（[30 秒就能创建](https://github.com/settings/tokens/new?scopes=read:packages&description=hyperyond-packages-read)）：

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx
```

或者写进 shell 启动脚本里永久生效。公开包用的是只读 token，留着不会有安全问题。

</details>

接着用 debug 模式启动 Chrome 让 Hover 可以连：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/hover-chrome
```

在**那个** Chrome 窗口里打开你的 dev 服务器，✨ 浮动按钮就会出现在右下角。

## 在 React (Vite) 项目里用

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from '@hyperyond/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    hover(),                 // 👈 加这一行
  ],
});
```

集成就这一行。照常 `vite dev`，在 debug Chrome 里打开你的应用，点 ✨。

> 通过 widget 保存的 spec 落在项目根目录的 `__vibe_tests__/` 下。用 `npx playwright test` 跑。它只 import `@playwright/test`，对 Hover 没有任何运行时依赖 —— 所以 CI 跑测试时 widget 完全可以禁用。

## 在 Vue (Vite) 项目里用

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { hover } from '@hyperyond/vite-plugin';

export default defineConfig({
  plugins: [
    vue(),
    hover(),                 // 👈 加这一行
  ],
});
```

流程完全一样。Vite dev 服务器 → debug Chrome → ✨。

> Svelte / Solid / Qwik / Astro / 原生 JS 都一样能用 —— Vite 能服务的任何项目都行。插件不关心框架；它只是通过 `transformIndexHtml` 往你的 dev 页面注入一个 Shadow DOM widget。

## 插件选项

```ts
hover({
  port: 51789,             // 本地 WebSocket 端口；占用了会自动顺延
  enabled: true,           // 设为 false 关闭（默认仅 dev 模式生效）
  chromeDebugPort: 9222,
  agentId: 'claude',       // 对应 @hyperyond/core 的 agent registry
  model: 'sonnet',         // 'opus' 大约贵 5×—— 浏览器驱动用 sonnet 完全够
  maxBudgetUsd: 0.5,       // 每次 agent 调用的硬上限
});
```

## 五个 example 应用

`examples/` 下每个都是真实的 Vite 应用，专门压一种不同的测试场景：

| 应用 | 端口 | 压什么 |
|---|---|---|
| [basic-app](./examples/basic-app) | 5173 | 登录 + 计数器 + todos。基线烟雾。 |
| [e-commerce](./examples/e-commerce) | 5174 | 长动作链：商品列表 → 购物车 → 结账，跨标签页支付弹窗 |
| [stock-registration](./examples/stock-registration) | 5175 | ~50 字段的券商开户表单，含条件展示 —— AI 填写富控件的能力 |
| [canvas-paint](./examples/canvas-paint) | 5176 | `<canvas>` 像素中夹着 DOM 工具栏 —— 截图不透明时还能不能找到语义 selector |
| [payment-provider](./examples/payment-provider) | 5177 | **故意不装** Hover 插件 —— 模拟跨标签页流程里的第三方域 |

任何一个都用 `pnpm dev:example:<name>` 启动。

## 工作原理

```
┌────────────────┐   聊天 (WebSocket)   ┌──────────────────┐
│  Widget        │ ───────────────────▶ │  @hover/core     │
│  (Shadow DOM,  │ ◀─────────────────── │  Node 服务        │
│   在 dev 页面里) │   step 事件          │  (127.0.0.1)     │
└────────────────┘                      └────────┬─────────┘
                                                 │ 启动
                                                 ▼
                                        ┌──────────────────┐
                                        │  claude (CLI)    │
                                        │  --strict-mcp,   │
                                        │  --allowedTools  │
                                        │  mcp__playwright │
                                        └────────┬─────────┘
                                                 │ MCP
                                                 ▼
                                        ┌──────────────────┐
                                        │  Playwright MCP  │
                                        └────────┬─────────┘
                                                 │ CDP (9222 端口)
                                                 ▼
                                        ┌──────────────────┐
                                        │  你已开的 Chrome  │
                                        │  (现有标签页)     │
                                        └──────────────────┘
```

架构和边界约束写在 [CLAUDE.md](./CLAUDE.md) 里。各 package 的内部实现在 [packages/core/README.md](./packages/core/README.md)。

## 站在巨人肩膀上

- [**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) —— **Local CLI Agent First** 架构的来源。Hover 不打包任何 AI 运行时；它扫描 `PATH`，把开发者已经装好的 agent CLI（当前是 `claude`）当作 sidecar 调用。"本地 daemon 是唯一特权进程、agent 是队友" 的世界观、默认严格沙箱的姿态、每次调用 USD 预算上限 —— 都是直接借鉴。Open Design 在**设计**这个 surface 上把这一套跑通了；Hover 把它搬到**测试** surface，产物从 HTML/PDF 变成确定性的 Playwright spec。
- [**Playwright Codegen**](https://playwright.dev/docs/codegen) —— "**产物必须是 deterministic 的**" 这个立场。AI 写测试是潮流；AI 跑在 CI 里是反复犯的错。Hover 保持产物 deterministic，让 CI 永远不用跟模型对话。
- [**Stagehand**](https://github.com/browserbase/stagehand) 和 [**Midscene**](https://github.com/web-infra-dev/midscene) —— 证明了 LLM 真的能驱动浏览器跑测试。Hover 拿同样的 loop，但把它**缩短**：agent 只在编写阶段驱动浏览器一次，之后就退出。

如果你想用的 agent（`codex` / `cursor-agent` / `aider` / `gemini` / `qwen-code` …）还没支持，去 [`packages/core/src/agents/registry.ts`](./packages/core/src/agents/registry.ts) 加一行就行 —— 欢迎 PR。

## 路线图

- **v0.0.1-poc** —— Phase 0 —— 端到端可行性验证（`claude -p` 通过 CDP 驱动 Chrome）✓
- **v0.1.x** —— Phase 1 —— Vite 插件 + 聊天 UI + 持久化服务 + Save as Spec ✓ （你在这里）
- **v0.2.x** —— Phase 2 —— 多 agent 支持（codex、cursor、aider）、更好的 step UI、错误重放
- **v0.3.x** —— Chrome 扩展（脱离 Vite 插件依赖，支持非 Vite 栈）

Phase 1 是你今天就能用的。

## 项目状态

🟢 **Phase 1 已发布** 在 v0.1.x —— dogfood 可用。可以在真实 Vite 应用上跑；目前还有一些跟 AI 行为相关的小坑（比如 AI 偶尔会 navigate 到同源 URL 把 widget 打断；刷新后自动 resume）。

Issue 跟踪：[github.com/Hyperyond/Hover/issues](https://github.com/Hyperyond/Hover/issues)。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。简要：

- Node 22+ / pnpm 10+
- Conventional Commits（`commit-msg` hook 强制）
- 推送前跑 `pnpm typecheck && pnpm test`
- 保持 `main` 可运行 —— 实验性工作放在 `experiment/<name>` 分支

## License

[Apache-2.0](./LICENSE) © Hyperyond
