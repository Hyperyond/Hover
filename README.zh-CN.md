<div align="center">

# Hover

<img src="docs/assets/banner.png" alt="Hover — 本地优先、开源的 AI 端到端测试编写方式" width="100%" />

<p>
  <a href="./README.md">English</a> · <b>简体中文</b>
</p>

<p>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/cli"><img alt="@hover-dev/cli on npm" src="https://img.shields.io/npm/v/@hover-dev/cli?style=flat-square&label=npx%20%40hover-dev%2Fcli%20setup&color=cb3837&logo=npm&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/core"><img alt="@hover-dev/core on npm" src="https://img.shields.io/npm/v/@hover-dev/core?style=flat-square&label=%40hover-dev%2Fcore&color=cb3837&logo=npm&logoColor=white" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://gethover.dev/docs"><img alt="Documentation" src="https://img.shields.io/badge/docs-gethover.dev-7CFFA8?style=flat-square&logo=readthedocs&logoColor=white" /></a>
</p>

<p>在 dev 页面打开聊天框，用大白话描述一个流程，看着 AI 真实操作你的应用 —— 跑通后点 <b>Save as spec</b>，得到一份标准 <code>@playwright/test</code> 文件，CI 里运行时<b>没有 agent、没有模型、没有 key</b>。</p>

</div>

<p align="center">
  <a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">
    <img src="https://img.youtube.com/vi/lQV5dmVWaIA/maxresdefault.jpg" alt="Hover 演示 — 在 YouTube 观看" width="80%" />
  </a>
  <br/>
  <sub><b><a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">▶ 看 2 分钟演示</a></b></sub>
</p>


Hover 先驱动你的应用跑一遍，把验证过的会话存成一份纯 Playwright spec。想更好？还有个可选的 **AI 优化**：它把这份 spec 打磨一版，以 diff 给你过目 —— 你决定要不要，原始版本永远保留。

**自带 CLI —— 订阅 *或* API key 都行。** Hover 直接 spawn 你 `PATH` 上已有的 coding-agent CLI（`claude` / `codex` / …）。可以复用你已经在付费的订阅，也可以把自己的模型 API key 填进 widget（它被透传到 CLI 的环境变量，只存在你的浏览器里，绝不上传）。无论哪种，LLM 成本都只是 authoring 时的一次性开销 —— 不会变成每次构建通过都要反复支付的成本，因为存下来的 `.spec.ts` 用 `npx playwright test` 永远跑得起来，回路里没有 agent。

## 为什么是 Hover
这个领域已经有不少好工具。Hover 的不同在于：它优化的是另一个维度 —— **产物的可移植性**。

| 工具 | 它做什么 | 代价 |
|---|---|---|
| **Playwright Codegen** | 录你的点击 → `.spec.ts`，无 AI | 不会思考 —— 只能照你做过的原样回放 |
| **Stagehand / Midscene** | AI 增强的测试；稳态运行靠缓存跳过 LLM。需要 OpenAI / Anthropic key | 测试跑在**厂商 SDK + 缓存文件**里 —— 无法迁到一个纯 Playwright runner |
| **Hover** | AI 驱动浏览器**探索一遍**，存出一份确定性 spec —— 还能可选地让 AI 把它优化成一个 diff 审核的候选 —— 外加一份可导入 Jira 的 case。**spawn 你 `PATH` 上的 CLI** —— 用订阅或你自己的 API key | 固化的 spec 对 UI 变化脆弱 —— 坏了就重跑 agent（CI 时不自愈） |

Hover 并不想在*运行时*把 AI 做得更强。它的选择是让最终存下来的产物就是纯 `@playwright/test` 代码、零 AI 依赖 —— agent 的活到 "save" 为止，CI 是纯 Playwright，**零 token、CI 里不接任何 key**。

### 两种固化方式

done 卡片上一个 **💾 Save as ▾** 把同一次验证过的会话固化成两种形态 —— 每个文件都进 git，没装 Hover 的同事也能读。

| | `📜 .spec.ts` | `📋 .case.csv` |
|---|---|---|
| **落在** | `__vibe_tests__/` | `__vibe_tests__/` |
| **谁读** | Node + Playwright（CI） | Xray · Zephyr · Jira |
| **受众** | CI、开发 | QA · PM |
| **确定性** | 硬契约 | 人工审核 |

<p align="center">
  <img src="docs/screenshots/05-save-dropdown.png" alt="Save 下拉 —— Playwright spec、Jira test case (CSV)" width="48%" />
  <img src="docs/screenshots/06-jira-case-modal.png" alt="Save as Jira case 弹窗" width="48%" />
</p>

## 你现在能用到什么

- **五个打包器集成** —— Vite、Astro、Nuxt、Next.js（Turbopack）、webpack 5；React Native Web 走 `vite-plugin-hover`。一个 Shadow-DOM widget 注入你的 dev 页面，生产构建里是 no-op，并标了 `data-hover="true"` 让你自己的 Playwright 跑测时跳过它。
- **用你的订阅或你的 API key** —— spawn 你 `PATH` 上的任一 coding-agent CLI，用你登录的订阅、或你粘进 widget 的模型 API key（存在浏览器里、注入 CLI 环境变量、绝不上传）。`@hover-dev/core` 零 LLM SDK 代码 —— 根本没有模型客户端去发送 key。
- **六个 agent、逐 agent 沙箱** —— `claude`（硬沙箱，推荐）、`codex`、`cursor-agent`、`aider`、`gemini-cli`、`qwen-code`。硬沙箱 agent 只能碰 Playwright MCP，外加 `--max-budget-usd` 上限；软沙箱 agent 带 ⚠ 标记。
- **结构化 spec 输出** —— 从重复流程中抽出 Page Object + fixture、`test.step(...)` 分块、每条 spec 一个 `.hover/<slug>.json` sidecar、popup/新标签页的 `Promise.all` 配对。一个**默认关闭**的 **AI 优化环节**把确定性草稿打磨成候选、由你通过 diff 接受（原始永远保留；疑似 bug 的行为以 `// KNOWN BUG` 行内标注），并从一个**种子库**（`.hover/rules/`，社区可扩展）学习。`.hover/conventions.md` 引导团队风格；探索范围按你 prompt 的具体程度自动收放。
- **抗变 + bug 发现** —— 可见性守卫的选择器会立刻报出明确错误，而不是干等 30 秒超时；**⟳ Re-record** 用 spec 的原始 prompt 重跑、重写选择器；agent 的 `## Findings` 落进按严重度分级的卡片。
- **安全 & 渗透 —— 一个 widget，两个模式** —— 切到橙色 [`@hover-dev/security`](./packages/security/)（业务 / 权限：本地 HTTPS MITM 让 agent 把捕获的 API 调用带变异重放，探 IDOR / 认证绕过 / 参数篡改，确认的发现固化成 `.security.spec.ts` CI 闸门），或红色 [`@hover-dev/pentest`](./packages/pentest/)（进攻：在你**自己**的 dev app 上打 SQLi / XSS / SSTI / SSRF / 开放重定向 / 越权，破坏性 + 带内确认，→ 一份说明测了什么、**没测什么**的渗透报告）。零外部依赖 —— 无 mitmproxy、无 Python、无系统 CA；仅限授权的自有应用测试。
- **Record 模式、语音模式、⌖ Fix prompt** —— 手动走一遍流程得到同样的 spec；按住说话的语音 prompt（中文 / English）；点任意元素 → 一段带源码归因的 fix prompt 进剪贴板。详见[文档站](https://gethover.dev/docs)。

<p align="center">
  <img src="docs/screenshots/07-findings-card.png" alt="Findings 卡片 —— agent 标记的、按严重度分级的 bug" width="48%" />
  <img src="docs/screenshots/09-fix-prompt-comparison.png" alt="含糊的自然语言诉求 vs. 结构化、带源码归因的 Fix prompt" width="48%" />
</p>

## 快速开始

```bash
npx @hover-dev/cli setup        # 探测打包器 + 包管理器，自动改配置（幂等；--dry-run 预览）
```

你还需要 **Node 22+** 和一个 coding-agent CLI —— Claude Code（`npm i -g @anthropic-ai/claude-code`）或 OpenAI Codex（`npm i -g @openai/codex`）。两种鉴权任选其一：用你已经在付费的订阅（`claude login` / `codex login`），**或**把模型 API key 粘进 widget 的 ⚙ 设置（注入 CLI 环境变量，只存在你的浏览器里）。然后照常起 dev server，在 Chrome 打开 dev URL —— 右下角出现一个浮动 ✨ 启动器；点它（按需 spawn 一个隔离的 debug Chrome），输入 prompt，点 **Save as spec**：

```
log in, then add a todo named "verify hover"
```

验证过的流程就变成 `__vibe_tests__/<slug>.spec.ts` —— 纯 Playwright，不依赖 Hover 运行时。手动接线、monorepo、Next.js 那一步、安全模式：见[安装文档](https://gethover.dev/docs/get-started/install)。

## 命令

都走 `hover` CLI（`npx @hover-dev/cli <命令>`）：

| 命令 | 作用 |
|---|---|
| `setup` | 探测打包器 + 包管理器，装集成、改配置 |
| `run "<prompt>"` | 终端里驱动 debug Chrome —— 无 widget；`--save <slug>` 固化成 spec |
| `scan ["<范围>"]` | 红色渗透 —— 在你**自己**的 dev app 上打 web 漏洞，写一份渗透报告（需 `--url <devUrl>`） |
| `optimize <spec>` | 可选 AI 优化 pass → 改进版候选（diff，原件保留） |
| `extract` | 把跨 spec 重复的 flow 抽成共享 Page Object + fixture |
| `re-record <spec>` | 对当前 UI 重新生成 spec |

`run` 是 CLI-only authoring（只需 `@hover-dev/core`、无 widget）；其余是对已存 spec 的后处理。完整参考：[文档](https://gethover.dev/docs/reference/cli)。

**在用 Claude Code？** 把 [`skills/hover-cli`](skills/hover-cli/SKILL.md) 放进你的 `.claude/skills/`，Claude 就学会了整套 CLI——从安装到 crystallize：

```bash
cp -r skills/hover-cli ~/.claude/skills/        # 或 <project>/.claude/skills/
```

## 插件

装一个对应你打包器的集成（`npx @hover-dev/cli setup` 会自动选）；可选的模式插件按需加。

**打包器集成** —— 按技术栈选一个：

| 打包器 | 包 |
|---|---|
| Vite（含 React Native Web） | [`vite-plugin-hover`](./packages/vite-plugin/) |
| Astro | [`@hover-dev/astro`](./packages/astro-integration/) |
| Nuxt | [`@hover-dev/nuxt`](./packages/nuxt-integration/) |
| Next.js（Turbopack） | [`@hover-dev/next`](./packages/next-integration/) |
| webpack 5 / Rspack | [`webpack-plugin-hover`](./packages/webpack-plugin/) |

**可选模式插件** —— 同一个 widget 长出一个模式：

| 插件 | 模式 | 干什么 |
|---|---|---|
| [`@hover-dev/security`](./packages/security/) | 🟠 安全 | 业务 / 权限 —— MITM 重放 IDOR / 认证绕过 / 参数篡改 → `.security.spec.ts` CI 闸门 |
| [`@hover-dev/pentest`](./packages/pentest/) | 🔴 渗透 | 进攻 —— 在你**自己**的 dev app 上打 SQLi / XSS / SSTI / SSRF / 越权 → 一份渗透报告 |

## 种子库

AI 优化环节和安全模式都靠**种子**教 —— 小的「示例 / 探针配方」。一套内置种子随 Hover 发布；往 `<root>/.hover/rules/` 丢你自己的 JSON 就能加新模式（不用 fork、不用写插件代码）。当前内置：

**优化种子** —— 教优化环节一个翻译模式（门槛高:只有「固定、与应用无关」的才内置）:

| 种子 | 模式 |
|---|---|
| `download` | 触发下载的点击 → `Promise.all` + `waitForEvent('download')` |

（popup / 新标签页配对是在翻译器里硬编码的，不是种子。）更多优化种子在社区仓库 [**`hover-seeds`**](https://github.com/Hyperyond/hover-seeds) 里（`seeds/optimization/` —— `oauth-popup`、`file-upload`、`dialog`、`network-gated-assertion`…）；挑需要的拷进你的 `.hover/rules/`。

**安全探针种子** —— 🟠 安全 / 🔴 渗透 模式会试的(5 个访问控制 + 7 个漏洞):

| 种子 | 类 | 给谁 |
|---|---|---|
| `idor-numeric-id`、`idor-in-body` | IDOR | 🟠 authz |
| `bfla-privileged-endpoint` | BFLA | 🟠 authz |
| `mass-assignment-privileged-field` | 越权赋值 | 🟠 authz |
| `auth-bypass-missing-check` | 认证绕过 | 🟠 authz |
| `sqli-error-boolean` | SQL 注入 | 🔴 vuln |
| `xss-reflected` | 反射型 XSS | 🔴 vuln |
| `ssti-template-injection` | SSTI | 🔴 vuln |
| `ssrf-url-param` | SSRF | 🔴 vuln |
| `open-redirect` | 开放重定向 | 🔴 vuln |
| `path-traversal` | 路径穿越 | 🔴 vuln |
| `graphql-introspection` | GraphQL | 🔴 vuln |

安全模式只拉 `authz` 那组;渗透模式拉全部。

## 示例

[`examples/`](./examples/) 下有十个可跑的应用。四个压测**测试面**（[`basic-app`](./examples/basic-app)、[`stock-registration`](./examples/stock-registration) ~50 字段表单、[`e-commerce`](./examples/e-commerce) 购物车/结账、[`canvas-paint`](./examples/canvas-paint) canvas 里找 DOM），其余是各**打包器的专属 dogfood 场**：

| 示例 | 打包器 / 框架 | Hover 包 |
|---|---|---|
| [`astro-app`](./examples/astro-app) | Astro 5（`astro dev`） | [`@hover-dev/astro`](./packages/astro-integration/) |
| [`nuxt-app`](./examples/nuxt-app) | Nuxt 4 SSR（`nuxt dev`） | [`@hover-dev/nuxt`](./packages/nuxt-integration/) |
| [`next-app`](./examples/next-app) | Next.js 16 App Router（Turbopack） | [`@hover-dev/next`](./packages/next-integration/) |
| [`webpack-app`](./examples/webpack-app) | webpack 5 + `webpack-dev-server` | [`webpack-plugin-hover`](./packages/webpack-plugin/) |
| [`rn-web-app`](./examples/rn-web-app) | React Native **Web**（Vite alias） | [`vite-plugin-hover`](./packages/vite-plugin/) |

**React Native：** 只支持 **Web** 目标（它编译成 DOM）。原生 iOS / Android 不在范围内 —— 用 Maestro / Detox / Appium。

## 工作原理

```
┌────────────────┐   chat (WebSocket)   ┌──────────────────┐
│  Widget        │ ───────────────────▶ │  @hover-dev/core │
│  (Shadow DOM,  │ ◀─────────────────── │  Node service    │ ◀── plugins
│   in dev page) │   step events        │  (127.0.0.1)     │     (mode, MCPs)
└────────────────┘                      └────────┬─────────┘
                                                 │ spawn (sandboxed)
                                                 ▼
                                  claude / codex ── MCP ──▶ Playwright ── CDP ──▶
                                  隔离的 debug Chrome（端口 9222，临时 profile）
```

Hover spawn 你 `PATH` 上的 coding-agent CLI，沙箱到只剩 Playwright MCP，通过 CDP 驱动一个隔离的 debug Chrome —— 不碰你的主 profile，不连任何托管服务（`@hover-dev/core` 只绑 `127.0.0.1`，无 LLM SDK、无遥测）。插件槽让 [`@hover-dev/security`](./packages/security/) 这类包扩展工具面。架构 + 插件 API：[文档](https://gethover.dev/docs/development/)。

## FAQ

**UI 改了，存的 spec 挂了怎么办？** 大多数 UI 改动不会挂 —— 选择器是 `getByRole / getByLabel / getByText`，不是 CSS/XPath。当*语义*变了，spec 会变红，三个选择：**⟳ Re-record**（agent 用原始 prompt 重跑，~30 秒 ~$0.10）、手改（就是纯 Playwright）、或当成真回归处理。CI 时刻意不自愈 —— 保持 CI 确定且免费。

**Hover 会上传我的源码或 DOM 吗？** 不会。`PATH` 上的 CLI 连它自己的 provider；`@hover-dev/core` 无上传路径、无遥测、只绑 `127.0.0.1`。更多：[文档 FAQ](https://gethover.dev/docs)。

## Roadmap

**最新 —— `v0.16.0`：** **`codeContext`** —— 一个可选、只读、带围栏的源码读取器（`read_source` MCP；secrets / `.env` / `.git` / 构建产物都排除），让**红色渗透模式变白盒**（拿真实 query / 鉴权代码确认漏洞、报告指到 `文件:行`）+ 写测试时用真实选择器；默认关。外加 run 存活重连 + 一轮验证过的代码审计。（结构化 spec 输出 —— Page Object + fixture、`test.step`、`.hover/rules/` 种子库、默认关闭的优化环节 —— 更早就发布了。）

**计划中：** **Chrome 扩展**（驱动任意标签页，去掉打包器插件依赖）· **Hover Cloud**（在本地 spec 之上的托管层：意图驱动自愈、test-rot 检测、AI 失败诊断 —— authoring 仍本地且免费）。[加入 waitlist](https://gethover.dev/#cloud)。

<details>
<summary>已发布（✓），最新在前</summary>

- **v0.16.0** —— `codeContext` 白盒源码读取器 · run 存活 widget 重连 · 一轮验证过的代码审计（孤儿进程、泄密、流劫持修复）· 渗透红模式 + 进攻种子（开放重定向 / 路径穿越 / GraphQL）。
- **v0.15.0** —— 结构化 spec 输出（Page Object、`test.step`、`.hover/rules/` 种子库、优化环节）+ CLI 模式（`hover run`）。
- **v0.14.x** —— 单 Chrome 安全（常驻 MITM 代理）+ gethover.dev 站点 + `--mode-accent` 主题 + CJK 输出。
- **v0.13.x** —— Record/replay 对齐：逐步可见性 prelude、合成 `page.goto`。
- **v0.12.x** —— 安全 spec 录制（`replay_flow` 加 `intent` + `expectStatus`）。
- **v0.11.x** —— spec 抗变：⟳ Re-record + Saved-sessions 浮层。
- **v0.10.x** —— 多标签 / popup 可靠性 + `aider` / `gemini-cli` / `qwen-code`。
- **v0.9.x** —— widget 插件 UI 协议 + `cursor-agent`。
- **v0.8.x** —— 多框架源码归因 + Next 插件支持。
- **v0.7.x** —— 安全测试 + 插件 API（`defineHoverPlugin`）。
- **v0.6.x** —— 语音模式（按住说话 STT + 朗读叙述）。
- **v0.5.x** —— 合并的 Record + Assert 子工具条。
- **v0.4.x** —— 点击 → Fix prompt + Vite 源码归因 transform。
- **v0.3.x** —— `@hover-dev/next` Turbopack 原生集成。
- **v0.2.x / v0.1.x / v0.0.1-poc** —— 多 agent + 暗色 widget；Vite 插件 + 聊天 UI + Save as Spec；可行性验证。

</details>

## 站在巨人的肩上

[**`nexu-io/open-design`**](https://github.com/nexu-io/open-design)（**Local CLI Agent First** 架构）、[**Playwright**](https://playwright.dev/) 及其 [**Codegen**](https://playwright.dev/docs/codegen)（Hover authoring 的目标 runtime，以及确定性 spec 即产物）、[**Stagehand**](https://github.com/browserbase/stagehand) / [**Midscene**](https://github.com/web-infra-dev/midscene)（证明了 LLM 能驱动真实浏览器）、[**`microsoft/webwright`**](https://github.com/microsoft/webwright)（code-as-action —— agent 写脚本,而不是一次猜一次点击）。Hover 缩短回路：authoring 时驱动一次,然后退场。

## 参与贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)：Node 22+ / pnpm 10+、Conventional Commits（hook 强制）、推送前 `pnpm typecheck && pnpm test`、保持 `main` 可跑。接新 agent 只是 [`registry.ts`](./packages/core/src/agents/registry.ts) 里加一个文件 —— 欢迎 PR。

## License

[Apache-2.0](./LICENSE) © Hyperyond
