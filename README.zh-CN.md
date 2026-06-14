# Hover — AI 端到端测试 & 安全

[English](./README.md) · **简体中文**

**本地优先、开源的 Web AI 测试 —— 一个 VS Code 插件。** Hover 调用你本机已有的编码 Agent CLI(Claude Code / OpenAI Codex),通过 Playwright MCP 操作你真实的 Chrome,再把跑通的流程结晶成纯 `@playwright/test` 用例 —— **CI 里零 AI** 就能跑。✦ 优化 pass · 🟠 安全测试(IDOR / 越权)· 🔴 渗透测试(攻击性、白盒)。

## 安装

到 **[VS Code 应用市场](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)** 安装 —— 或在扩展面板搜 **“Hover — AI E2E Testing & Security”**。

你还需要 `PATH` 上有**一个编码 Agent CLI**:[Claude Code](https://claude.com/claude-code)(`npm i -g @anthropic-ai/claude-code`)或 [OpenAI Codex](https://github.com/openai/codex)(`npm i -g @openai/codex`),用你的订阅或自己的 API key 登录即可。除此之外**没有别的要配** —— Hover 不带任何模型 SDK,也不存任何 key。

[▶ 看 2 分钟演示](https://www.youtube.com/watch?v=lQV5dmVWaIA)

## 你能得到什么

- **对话即生成测试文件** —— 用大白话描述你要验证什么,Hover 操作你真实的应用,把跑通的流程存成纯 `@playwright/test` 用例。AI 的活到“保存”为止 —— CI 是纯 Playwright,零 token、不用往 CI 里塞 key。
- **多环境账户/权限,一并搞定** —— 给每个环境(本地 / staging / prod)配一次测试账户,在对话里写 `@账户名`,Agent 就替你登录。凭证会被**参数化成 `process.env` 引用**:绝不写进 spec、JSDoc 或 sidecar,同一套变量名一键导出到 CI secrets。
- **调用你本机的 AI —— 无需额外配置** —— 跑你机器上已有的 Claude Code / Codex CLI,用你本就付费的订阅。不用接模型 key、没有 SDK,数据不出本机(`@hover-dev/core` 只绑 `127.0.0.1`,无遥测、无上传)。
- **安全 + 渗透,同一个对话框** —— 切到 🟠 **安全测试**(IDOR / 越权 / 业务逻辑,靠本地 HTTPS MITM 把抓到的 API 改参重放)或 🔴 **渗透测试**(攻击性、白盒:SQLi / XSS / SSTI / SSRF / 开放重定向 / IDOR),只对你**自己的**应用。确认的发现会变成 `.security.spec.ts` 的 CI 关卡,或一份“测了什么、没测什么”的报告。不需要 mitmproxy、不需要 Python、不需要装系统 CA。
- **确定性、可移植的 spec** —— 选择器用 `getByRole / getByLabel / getByText`,不是 CSS/XPath。可选、默认关闭的 **AI 优化 pass** 会把草稿打磨成候选,用 diff 让你采纳(原件永远保留)。每个 spec 都是普通 Playwright,进 git、脱离 Hover 也能跑。
- **测试自愈(规划中)** —— spec 在 CI 挂了,**Hover Cloud** 会用 AI 修复 UI 漂移并在 dashboard 上呈现。编写永远本地、免费。

## 工作原理

```
┌────────────────┐   chat (WebSocket)   ┌──────────────────┐
│  Hover         │ ───────────────────▶ │  @hover-dev/core │
│  (VS Code      │ ◀─────────────────── │  Node 引擎       │ ◀── 插件
│   插件)        │   step events        │  (127.0.0.1)     │     (模式 / MCP)
└────────────────┘                      └────────┬─────────┘
                                                 │ spawn(沙箱)
                                                 ▼
                                  claude / codex ── MCP ──▶ Playwright ── CDP ──▶
                                  独立的调试版 Chrome(端口 9222,临时 profile)
```

引擎打包在插件里,调用 `PATH` 上的编码 Agent CLI,沙箱限定到 Playwright MCP,通过 CDP 操作一个独立的调试 Chrome —— 不碰你的主 profile,不走任何托管服务。

## 在 CI 里跑 spec

结晶出来的 spec 是纯 `@playwright/test`,哪都能跑、不需要 AI:

```bash
npx playwright test __vibe_tests__
```

用 `BASE_URL`(以及 `HOVER_<LABEL>_*` 账户 secrets)指向任意环境;同一个 spec 在本地 / staging / PR 预览上都能跑。Hover 还能帮你生成一个在每个 PR 上跑这些 spec 的 GitHub Actions workflow。

## 模式

| 模式 | 做什么 |
|---|---|
| **普通** | AI 编写 / 运行功能 E2E 流程 → `.spec.ts` |
| 🟠 **安全测试** | 业务 / 越权 —— MITM 重放 IDOR / 越权 / 参数篡改 → `.security.spec.ts` CI 关卡 |
| 🔴 **渗透测试** | 攻击性 —— SQLi / XSS / SSTI / SSRF / IDOR,只打你**自己的** dev 应用 → 一份发现报告 |

两种安全模式都由 **seeds**(小的探测配方,8 类访问控制 + 9 类漏洞)驱动。全套内置;在 `<root>/.hover/rules/` 丢自己的 JSON 即可扩展。

## 其他形态

更想用终端或自己的 dev 页面?`hover run "<prompt>"` 在命令行里编写 spec,原来的页面内 widget 仍以 bundler 插件形式(Vite / Astro / Nuxt / Next.js / webpack)存在于 [`packages/`](./packages/) —— 这两条现在都**已冻结**;VS Code 插件是正向路径。

## 示例

[`examples/`](./examples/) 下有可运行的应用,覆盖不同测试场景 —— 登录 / 计数器 / 待办、约 50 个字段的表单、带跨标签支付弹窗的电商购物车,以及一个 canvas 应用 —— 外加 Astro、Nuxt、Next.js、webpack 和 React Native **Web** 的 dogfood 场地(原生 iOS / Android 不在范围,用 Maestro / Detox / Appium)。

## FAQ

**UI 改了,我存的 spec 挂了。** 大多数 UI 改动不会挂 —— 选择器是语义化的,不是 CSS/XPath。语义真变了 spec 会红:**重录**(Agent 重放原始 prompt,约 30 秒)、手改(它就是普通 Playwright)、或当成一个真 regression。CI 阶段故意不自愈 —— 保持确定 + 免费(自愈作为可选的 Hover Cloud 在路上)。

**Hover 会上传我的源码或 DOM 吗?** 不会。`PATH` 上的 CLI 与它自己的厂商通信;`@hover-dev/core` 没有上传通道、无遥测、只绑 `127.0.0.1`。

## 路线图

**规划中 —— Hover Cloud:** 一个架在你本地 spec 之上的托管层(并行跑、定时监控、flakiness dashboard、失败时 AI 自愈 UI 漂移)。编写永远本地、免费;云端只**运行和监控**你已经拥有的 spec。[加入等待名单](https://gethover.dev/#cloud)。

## 站在巨人的肩上

[**`nexu-io/open-design`**](https://github.com/nexu-io/open-design)(**Local CLI Agent First** 架构)、[**Playwright**](https://playwright.dev/) 及其 [**Codegen**](https://playwright.dev/docs/codegen)、[**Stagehand**](https://github.com/browserbase/stagehand) / [**Midscene**](https://github.com/web-infra-dev/midscene)(证明了 LLM 能驱动真实浏览器),以及 [**`microsoft/webwright`**](https://github.com/microsoft/webwright)(code-as-action)。Hover 把这个循环缩短:编写时驱动一次,然后退场。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md):Node 22+ / pnpm 10+,Conventional Commits(强制),推送前 `pnpm typecheck && pnpm test`,保持 `main` 可运行。

## 许可

[Apache-2.0](./LICENSE) © Hyperyond
