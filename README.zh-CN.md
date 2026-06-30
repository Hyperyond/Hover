# Hover —— 开源 Vibe Testing 套件

[English](./README.md) · **简体中文**

[![npm @hover-dev/mcp](https://img.shields.io/npm/v/%40hover-dev%2Fmcp?label=npm%20%40hover-dev%2Fmcp&color=cb3837&logo=npm)](https://www.npmjs.com/package/@hover-dev/mcp)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/hyperyond.hover-dev?label=VS%20Marketplace&color=1f9cf0&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Playwright](https://img.shields.io/badge/output-%40playwright%2Ftest-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**把你本来就在用的 coding agent 指向 Hover,得到一套你自己拥有的真 Playwright 测试。** Hover 是一个开源 **Vibe Testing** 套件:把它的 MCP server 加进你自己的 agent(Claude Code、Cursor……),agent 就会探索你的应用、梳理业务流程,并把每条流程结晶成 `__vibe_tests__/` 下的纯 `@playwright/test` 用例。这些测试**归你所有** —— 在你的 CI 里跑,过程中**零 AI**。

核心差异是 **record == replay(录即放)**:agent 通过 Hover 的**接地(grounded)**浏览器工具操作,所以"驱动这次点击的选择器"就是"保存下来的选择器",而结晶是**确定性**的(没有 LLM 在写代码)。不会有编造的选择器、不依赖 Hover 运行时、不锁定。

## 套件 —— 四个 surface,一个 artifact

| Surface | 角色 | 是什么 |
|---|---|---|
| **MCP** —— `@hover-dev/mcp` | **创作** | 引擎。加进你自己的 agent;`/mcp__hover__test_app` 探索 + 结晶用例。BYO-CLI —— 你的模型、你的订阅,我们不带任何 key。 |
| **VS Code** —— `hover-dev` | **评审** | 可选的 cockpit:应用业务流程 + 覆盖的 **Business Map** 图谱、Dashboard(通过 / 失败 / flaky + CI 结果)、一键运行。 |
| **CI** | **运行** | 结晶出的用例在每个 PR 上以纯 Playwright 运行 —— 无 agent、无 token。Hover 帮你生成 workflow。 |
| **Cloud** *(可选,规划中)* | **观测** | 托管的并行运行、定时监控、flakiness 看板、失败自愈 —— 都是**在你已拥有的用例之上**做。永不锁定创作。 |

贯穿四者的是 **artifact**:在你仓库 + 你 CI 里、你拥有的、可移植的 Playwright。AI 只在创作时驱动一次,之后没有任何 AI 在跑。

## 快速开始

把 MCP 加进你的 agent(以 Claude Code 为例 —— 任何支持 MCP 的 agent 都行):

```bash
npm i -g @hover-dev/mcp
claude mcp add hover -- hover-mcp
```

然后在你的 agent 里:

```
/mcp__hover__test_app           # 探索应用并结晶一套用例
/mcp__hover__test_app login     # ……或只针对某一条流程
```

用例落在 `__vibe_tests__/`。在任何地方运行,无需 AI:

```bash
npx playwright test __vibe_tests__
```

想要图形界面?装 **[Hover VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)**(`hyperyond.hover-dev`)看 Business Map 图谱 + Dashboard。它是评审 cockpit —— 不驱动任何 agent。

## 为什么是 Hover

- **record == replay** —— 接地操作 + 确定性结晶:保存的选择器就是驱动这次运行的那个。Playwright codegen / Stagehand / Midscene 都保证不了这点。
- **你拥有 artifact** —— 仓库里的纯 `@playwright/test`,在你 CI 里零 AI 运行。无专有格式、不依赖 Hover 运行时、不锁定。
- **BYO-CLI** —— Hover 不带 AI 运行时、不带 key;它骑在你已经付费的 coding agent + 订阅上。我们管**怎么测**,从不管**用哪个模型**。
- **会复利的测试知识** —— Hover 在 `.hover/` 里维护业务地图 + 记住的规则,套件随你应用成长而复利、且自我感知。

## 工作原理

```
你的 agent (Claude Code / Cursor)
   │  MCP 工具 —— 接地操作
   ▼
@hover-dev/mcp ──▶ CDP ──▶ 你的 debug Chrome ──▶ 你的应用
   │
   └─ crystallize_spec ──▶ __vibe_tests__/<flow>.spec.ts   (纯 Playwright,无 AI)
```

agent 从不凭空手写用例:它通过接地工具(`role+name → testId → text`)操作,Hover 把记录的步骤**确定性地**翻译成 Playwright —— 所以你回放的就是你录的。

## FAQ

**一定要装 VS Code 扩展吗?** 不用。MCP 就是完整的创作闭环。扩展是可选的评审 cockpit(Business Map + Dashboard)。

**Hover 会上传我的源码或 DOM 吗?** 不会。你的 agent 与它自己的 provider 通信;Hover 不带模型、不带 key、无遥测、无上传路径。

**UI 改了,保存的用例挂了。** 选择器是语义化的,大多数 UI 变动不会破坏它。真破坏时,直接改那份纯 Playwright,或重跑 `/mcp__hover__test_app <flow>` 重新结晶。CI 阶段刻意不做自动自愈 —— CI 保持确定性且免费;失败自愈是规划中的 Cloud 功能。

## 路线图

**Hover Cloud(规划中,可选):** 并行运行、定时监控、flakiness 看板、失败自愈 —— 一层**在你已拥有的用例之上**的托管层。创作永远本地 + 免费;云端只运行和观测你拥有的测试,绝不锁定。[加入 waitlist](https://gethover.dev/#cloud)。

## 站在巨人肩上

[**Playwright**](https://playwright.dev/)(+ [Codegen](https://playwright.dev/docs/codegen))、[**Model Context Protocol**](https://modelcontextprotocol.io/),以及自带的 coding-agent CLI([Claude Code](https://claude.com/claude-code) / [Codex](https://github.com/openai/codex) / ……)。[**Stagehand**](https://github.com/browserbase/stagehand) 与 [**Midscene**](https://github.com/web-infra-dev/midscene) 证明了 LLM 能驱动真实浏览器;Hover 把循环缩短 —— 创作时驱动一次,之后彻底退场。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md):Node 22+ / pnpm 10+、Conventional Commits(强制)、push 前 `pnpm typecheck && pnpm test`、保持 `main` 可运行。

## 许可证

[Apache-2.0](./LICENSE) © Hyperyond
