# Hover —— 开源 Vibe Testing 套件

[English](./README.md) · **简体中文**

[![npm @hover-dev/mcp](https://img.shields.io/npm/v/%40hover-dev%2Fmcp?label=npm%20%40hover-dev%2Fmcp&color=cb3837&logo=npm)](https://www.npmjs.com/package/@hover-dev/mcp)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/hyperyond.hover-dev?label=VS%20Marketplace&color=1f9cf0&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Playwright](https://img.shields.io/badge/output-%40playwright%2Ftest-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**把你本来就在用的 coding agent 指向 Hover,得到一套你自己拥有的真 Playwright 测试。** Hover 是一个开源 **Vibe Testing** 套件:把它的 MCP server 加进你自己的 agent(Claude Code、Cursor……),agent 就会探索你的应用、梳理业务流程,并把每条流程结晶成 `__vibe_tests__/` 下的纯 `@playwright/test` 用例。这些测试**归你所有** —— 在你的 CI 里跑,过程中**零 AI**。

核心差异是 **record == replay(录即放)**:agent 通过 Hover 的**接地(grounded)**浏览器工具操作,所以"驱动这次点击的选择器"就是"保存下来的选择器",而结晶是**确定性**的(没有 LLM 在写代码)。不会有编造的选择器、不依赖 Hover 运行时、不锁定。

> **先定义行为,再交付代码,守住回归。** Vibe-coding 快,但它改老代码和写新代码一样顺手,昨天还好用的流程今天就悄悄坏了。Hover 把顺序反过来:你先**声明一个功能应该做什么**,这条 spec 成为固定契约,你的 agent 不断把代码**拟合**到它上面 —— 写代码、在 **CI** 里跑用例、Hover Cloud 对每个失败**裁定**(是漂移还是 bug)并把修复路由回来,一直迭代到绿。**是 AI 拟合你的 spec,不是反过来。** 见 [Guard 先行开发](#guard-先行开发)。

## 套件 —— 四个 surface,一个 artifact

| Surface | 角色 | 是什么 |
|---|---|---|
| **MCP** —— `@hover-dev/mcp` | **创作** | 引擎。加进你自己的 agent;`/mcp__hover__test_app` 探索 + 结晶用例。BYO-CLI —— 你的模型、你的订阅,我们不带任何 key。 |
| **VS Code** —— `hover-dev` | **评审** | 可选的 cockpit:应用业务流程 + 覆盖的 **Business Map** 图谱、Dashboard(通过 / 失败 / flaky + CI 结果)、一键运行。 |
| **CI** | **运行** | 结晶出的用例在每个 PR 上以纯 Playwright 运行 —— 无 agent、无 token。Hover 帮你生成 workflow。 |
| **[Cloud](https://cloud.gethover.dev)** *(已上线 · 公测免费)* | **观测 + 闭环** | 接收你的 CI 结果,提供看板、flakiness、回归告警、**漂移-vs-bug 自愈队列**、**业务地图 + 知识库**,以及驱动 guard 先行开发的运行裁决。**不跑任何浏览器** —— 只读结果,绝不跑你的测试。 |

贯穿四者的是 **artifact**:在你仓库 + 你 CI 里、你拥有的、可移植的 Playwright。AI 只在创作时驱动一次,绿色路径上没有任何 AI 在跑。

## 快速开始

把 MCP 加进你的 agent(以 Claude Code 为例 —— 任何支持 MCP 的 agent 都行):

```bash
npm i -g @hover-dev/mcp
claude mcp add hover -- hover-mcp
```

**已经装过?** 用 `npm i -g @hover-dev/mcp@latest` 升级,然后重载你的 agent 让它重启 server —— 不用重跑 `claude mcp add`。([升级说明 →](https://www.gethover.dev/docs/get-started/install/#updating))

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

## Guard 先行开发

**`/guard` 声明什么该成立 → `/build` 把它推到绿。**

测已有流程只是一半。另一半是**测试先行地构建新流程** —— 而且不让 LLM 凭空为"还不存在的 UI"手写 Playwright。

```
/mcp__hover__guard  加一个每日打卡;连续 7 天在统计页显示徽章
```

**`guard` 声明意图(红灯):** 它追问模糊的边界,把意图记成挂在业务线上的业务规则,并往你的 Business Map 写一条**待验证线 + 验收标准**。纯声明 —— 不编造任何用例。

```
/mcp__hover__build  Daily check-in
```

**`build` 把它推到绿:** 你的 agent 写代码,在你的**活应用**里走一遍流程逐条核对验收标准,然后从那次真实运行里**结晶**出用例(record == replay 不破)。它跑全量回归、推送,并读取 **Hover Cloud 对每个失败的裁决** —— `bug` → 修代码,`drift` → 修过时的用例,`unclear` → 停下问你。一直迭代到 CI 变绿;**合并永远在你手里。**

循环的外半(CI 裁决)需要连上 Cloud 账号 —— 在 VS Code 运行 `Hover: Connect Hover Cloud`,或设 `HOVER_CLOUD_TOKEN`。创作和内循环完全本地。

## 为什么是 Hover

- **record == replay** —— 接地操作 + 确定性结晶:保存的选择器就是驱动这次运行的那个。Playwright codegen / Stagehand / Midscene 都保证不了这点。
- **你拥有 artifact** —— 仓库里的纯 `@playwright/test`,在你 CI 里零 AI 运行。无专有格式、不依赖 Hover 运行时、不锁定。
- **BYO-CLI** —— Hover 不带 AI 运行时、不带 key;它骑在你已经付费的 coding agent + 订阅上。我们管**怎么测**,从不管**用哪个模型**。
- **会复利的测试知识** —— Hover 在 `.hover/` 里维护业务地图 + 记住的规则,随代码一起提交,套件随你应用成长而复利、且自我感知。
- **AI 只作用于已经跑过的结果** —— 绿色 CI 路径 100% 无 AI。Cloud 的裁判只处理*失败*的运行(对照你的规则判漂移还是 bug),绝不碰绿色构建,绝不接管本地创作。

## 工作原理

```
你的 agent (Claude Code / Cursor)
   │  MCP 工具 —— 接地操作
   ▼
@hover-dev/mcp ──▶ CDP ──▶ 你的 debug Chrome ──▶ 你的应用
   │
   └─ crystallize_spec ──▶ __vibe_tests__/<flow>.spec.ts   (纯 Playwright,无 AI)
                                    │
                                    ▼
                         你的 CI ──▶ Hover Cloud(只读结果)
                                        │  drift · bug · unclear + 裁判
                                        └─▶ 路由回你的编辑器修复,经人工审阅
```

agent 从不凭空手写用例:它通过接地工具(`role+name → testId → text`)操作,Hover 把记录的步骤**确定性地**翻译成 Playwright —— 所以你回放的就是你录的。

## FAQ

**一定要装 VS Code 扩展吗?** 不用。MCP 就是完整的创作闭环。扩展是可选的评审 cockpit(Business Map + Dashboard)。

**一定要用 Hover Cloud 吗?** 不用 —— 创作、结晶、在你 CI 里运行,全部本地且免费。Cloud 加的是*观测 + 闭环*那一层(看板、自愈队列、裁决、guard 先行的外循环)。公测期免费,且不跑任何浏览器。

**Hover 会上传我的源码或 DOM 吗?** 不会。你的 agent 与它自己的 provider 通信;Hover 不带模型、不带 key、无遥测。Cloud 只接收*你*发给它的 CI 结果(Playwright 报告) —— 绝不跑你的测试,也够不到你的机器。

**UI 改了,保存的用例挂了。** 选择器是语义化的,大多数 UI 变动不会破坏它。真破坏时:直接改那份纯 Playwright,跑 `/mcp__hover__heal <flow>` 在本地重新接地,或者 —— 若连了 Cloud —— CI 的失败会落进**自愈队列**,分诊漂移-vs-bug 后路由回你的编辑器。修复永远本地 + 人工审阅;绿色 CI 路径保持确定性、无 AI。

## Hover Cloud

[**cloud.gethover.dev**](https://cloud.gethover.dev) —— 一层**在你已拥有的用例、你已在跑的 CI 之上**的托管数据 + 自愈编排层。用 GitHub 登录、连上一个仓库,Hover 就会写好 CI workflow 并开始盯每一次运行:

- **看板 & flakiness** —— 通过率、运行历史、给最不稳的用例排序的抖动分。
- **自愈队列** —— 每个失败分诊为 **drift**(修测试)/ **bug**(修应用)/ **unclear**,并有一个对照你业务规则打分的 LLM 裁判(仅建议);路由回你的编辑器本地修。
- **业务地图 & 知识时间线** —— 你流程的覆盖图谱,以及 Hover 学到的规则,直接读自你的仓库,带 git 溯源历史。
- **合并信心 & PR 检查** —— 对"这个 PR 的失败是否由它引入"的确定性裁决,外加 `hover/e2e` 状态和覆盖摘要。
- **回归告警、环境、团队** —— 邮件 / Slack 告警,staging / production 目标,邀请 + 角色。

公测期免费。它不跑任何浏览器 —— 这是最强的反锁定立场。

## 站在巨人肩上

[**Playwright**](https://playwright.dev/)(+ [Codegen](https://playwright.dev/docs/codegen))、[**Model Context Protocol**](https://modelcontextprotocol.io/),以及自带的 coding-agent CLI([Claude Code](https://claude.com/claude-code) / [Codex](https://github.com/openai/codex) / ……)。[**Stagehand**](https://github.com/browserbase/stagehand) 与 [**Midscene**](https://github.com/web-infra-dev/midscene) 证明了 LLM 能驱动真实浏览器;Hover 把循环缩短 —— 创作时驱动一次,之后彻底退场。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md):Node 22+ / pnpm 10+、Conventional Commits(强制)、push 前 `pnpm typecheck && pnpm test`、保持 `main` 可运行。

## 许可证

[Apache-2.0](./LICENSE) © Hyperyond
