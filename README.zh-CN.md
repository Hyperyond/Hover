<div align="center">

# Hover

<img src="docs/assets/banner.png" alt="Hover — 本地优先、开源的 AI 端到端测试编写方式" width="100%" />

<p>
  <a href="./README.md">English</a> · <b>简体中文</b>
</p>

<!-- 能力 badges：能装什么 / 在哪能跑 -->
<p>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/cli"><img alt="@hover-dev/cli on npm" src="https://img.shields.io/npm/v/@hover-dev/cli?style=flat-square&label=npx%20%40hover-dev%2Fcli%20add&color=cb3837&logo=npm&logoColor=white" /></a>
  <a href="#安装"><img alt="Covers Vite, Astro, Nuxt, Webpack, RN Web" src="https://img.shields.io/badge/covers-Vite%20%C2%B7%20Astro%20%C2%B7%20Nuxt%20%C2%B7%20Webpack%20%C2%B7%20RN%20Web-7c3aed?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/core"><img alt="@hover-dev/core on npm" src="https://img.shields.io/npm/v/@hover-dev/core?style=flat-square&label=%40hover-dev%2Fcore&color=cb3837&logo=npm&logoColor=white" /></a>
</p>

<!-- 项目 meta：release / 社区 / 架构 -->
<p>
  <a href="https://github.com/Hyperyond/Hover/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Hyperyond/Hover?style=flat-square&label=release&color=blueviolet" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://github.com/Hyperyond/Hover/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Hyperyond/Hover?style=flat-square&color=2ecc71" /></a>
  <a href="https://github.com/Hyperyond/Hover/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Hyperyond/Hover?style=flat-square&color=8e44ad" /></a>
  <a href="#工作原理"><img alt="Local CLI Agent First" src="https://img.shields.io/badge/architecture-Local%20CLI%20Agent%20First-black?style=flat-square" /></a>
</p>

</div>

---

在你的 dev 页面打开浮动聊天框，用中文（或者你喜欢的任何语言）描述要验证什么，看着 AI 真实地操作你的应用。一遍跑通后，点 **Save as spec** —— Hover 会写出一份标准的 `@playwright/test` 文件，CI 跑它的时候**完全不需要 AI 在场**。

**无需 API key，不按 token 计费。** Hover 调用你 `PATH` 上已经装好的 coding-agent CLI（claude / codex），跑在你已经付费的订阅里。

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

<p align="center">
  <a href="https://www.youtube.com/watch?v=ASWFWUyMUlc">
    <img src="https://img.youtube.com/vi/ASWFWUyMUlc/maxresdefault.jpg" alt="Hover 演示视频 — 在 YouTube 观看" width="70%" />
  </a>
  <br/>
  <sub><b><a href="https://www.youtube.com/watch?v=ASWFWUyMUlc">▶ 在 YouTube 观看演示视频</a></b></sub>
</p>

[`examples/`](./examples/) 下有 9 个真实的示例 app。其中 4 个压**测试场景**（登录、多步表单、电商结账、画布 + DOM 混合）—— 右边的 Hover widget 都是同一套 UI 在驱动。另外 5 个压**bundler / 框架覆盖**（Astro、Nuxt、webpack、React Native Web，加上电商弹窗流程里那个故意不装插件的第三方域）。

### 测试场景

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/01-basic-app.png" alt="01 · basic-app — 登录 + 计数器 + todos" /><br/>
<sub><b>01 · <a href="./examples/basic-app"><code>basic-app</code></a> —— 烟雾基线。</b> 登录 → +1 计数 → 加 todo。Agent 11 turn 跑完整个流程，花了 $0.16；结果卡同时给出 <b>Save as Skill</b>（下次对话可复用）和 <b>Save as spec</b>（标准的 <code>@playwright/test</code> 文件）。</sub>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/02-stock-registration.png" alt="02 · stock-registration — 多步券商开户表单" /><br/>
<sub><b>02 · <a href="./examples/stock-registration"><code>stock-registration</code></a> —— ~50 字段、条件展示的券商开户表单。</b> Agent 填完了文本字段，然后页面自带的校验逻辑标出三个必填 radio（性别 / 婚姻 / 美国税务居民）。Hover 停下来给一张说明清楚为什么停的 done card —— 人手动勾完那三个继续跑就行。</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/03-e-commerce.png" alt="03 · e-commerce — 购物车 + 结账" /><br/>
<sub><b>03 · <a href="./examples/e-commerce"><code>e-commerce</code></a> —— Amazon 风格电商。</b> "买两件销量最高的耳机，地址用我之前存的，刷卡。" Agent 选对了品类、加了两件商品、走到了支付步骤。长动作链、真实购物车状态、随时可以 <b>Save as spec</b>。</sub>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/04-canvas-paint.png" alt="04 · canvas-paint — DOM 工具栏夹在 canvas 像素中" /><br/>
<sub><b>04 · <a href="./examples/canvas-paint"><code>canvas-paint</code></a> —— 一个画图 app，画布本身是不透明的 <code>&lt;canvas&gt;</code>。</b> 截图工具看不到像素内容，但 Agent 通过 DOM 工具栏（工具 · 颜色 · 笔刷大小 · 保存）一路操作下来 —— 证明 Hover 的"优先选语义化 selector" 策略在画布场景下依然好使。</sub>
</td>
</tr>
</table>

### Bundler 覆盖

下面五个目标的页面内容都一样（counter + todo 烟雾页），但底层 bundler / 框架不同 —— 每个 Hover 集成包都有自己专属的 dogfood 落点。

| 示例 | Bundler / 框架 | Hover 包 | 端口 |
|---|---|---|---|
| [`examples/astro-app`](./examples/astro-app) | Astro 5（静态，`astro dev`） | [`@hover-dev/astro`](./packages/astro-integration/) | 5178 |
| [`examples/nuxt-app`](./examples/nuxt-app) | Nuxt 4（SSR，`nuxt dev`） | [`@hover-dev/nuxt`](./packages/nuxt-integration/) | 5179 |
| [`examples/webpack-app`](./examples/webpack-app) | vanilla webpack 5 + `webpack-dev-server` | [`webpack-plugin-hover`](./packages/webpack-plugin/) | 5180 |
| [`examples/rn-web-app`](./examples/rn-web-app) | React Native Web（Vite，`react-native` → `react-native-web` alias） | [`vite-plugin-hover`](./packages/vite-plugin/) | 5181 |
| [`examples/payment-provider`](./examples/payment-provider) | Vite，**故意不装** Hover 插件 | n/a | 5177 |

`payment-provider` 故意不装插件 —— `examples/e-commerce` 的 "Pay with PayHover" 按钮会把它弹到新标签页，Agent 要在没 widget 的情况下发现新标签页、切过去、操作完、再确认回调回到原标签页。

### React Native —— 只支持 Web 这一支

Hover 只服务"浏览器能跑起来"的前端。**React Native（iOS / Android 原生）不支持，也不在路线图上** —— Hover 的整套栈（Chrome DevTools Protocol + Playwright + Shadow DOM widget）跟原生移动端不沾边，那个领域有 [Maestro](https://maestro.mobile.dev/)、[Detox](https://wix.github.io/Detox/)、Appium 等专门工具。**React Native Web** 项目编译成纯 DOM，完整覆盖 —— 看 [`examples/rn-web-app`](./examples/rn-web-app/) 的接入方式（就一行 `react-native` → `react-native-web` 的 Vite alias）。

## 为什么是 Hover

这个领域已有几个不错的工具；Hover 跟它们的差异在另一个维度：**产物的可移植性**。

| 工具 | 它做什么 | 取舍 |
|---|---|---|
| **Playwright Codegen** | 录制你的点击 → `.spec.ts`。无 AI、无 auth | 不会思考——只能照搬你的点击 |
| **Stagehand / Midscene** | AI 增强的测试；两家都做了缓存，稳态 CI 跑命中缓存就跳过 LLM。需要配 **OpenAI / Anthropic API key**——cache miss 时按 token 计费 | 跑测试仍然需要**它们的 SDK + 仓库里那份缓存文件**。不可移植到普通的 Playwright runner |
| **Hover** | AI 只在**探索**时驱动浏览器一次；同时产出**确定性的 spec**、**可重放的 agent skill** 和**可直接导入 Jira 的测试用例**。**不需要 API key —— Hover 直接调用你 `PATH` 上已经装好的 coding-agent CLI**（claude / codex），跑在你已付费的 Claude Pro/Max 或 ChatGPT 订阅里 | 落盘的 spec 对 UI 改动是脆的——坏了就重跑 agent（CI 时不会自愈） |

Hover **不打算**做的事：当一个更好的"测试时 AI 运行时"。Stagehand 的缓存 + 自愈机制比我们能造的成熟，Midscene 的视觉 fallback 能处理 canvas / iOS / Android 目标我们碰不到。

Hover **要**做的事：**让落盘的产物就是纯 `@playwright/test` 代码，在干净机器上 `npx playwright test` 就能跑、零 AI 依赖**。AI 的工作到 "Save" 为止；CI 跑的就是纯 Playwright。这是交接点。

### 一次探索，三种受众

跑通的 Hover 会话可以以三种方式落盘。done card 上一个 **💾 Save as ▾** 下拉按钮展开三个选项，挑一个、两个、或都存。

- **📜 Save as spec** → `__vibe_tests__/<slug>.spec.ts` —— 标准 `@playwright/test` 代码，selector 用 `getByRole / getByLabel / getByTestId`。CI 跑、pre-commit 跑、新机器都能跑。不需要 agent，不需要 `claude` 二进制，不需要 API key。这是该流程的**ground truth**。**JSDoc 头部现在带一段编号的人话 `Steps:` 块 + `Expected:` 块**，QA / PM 不用打开 Playwright 文档就能读懂这个 spec 在干嘛。
- **💾 Save as Skill** → `.claude/skills/<slug>/SKILL.md` —— 一份可重放的指令集，agent 下次会话会自动发现。在未来任何一次会话里说一句 *"execute login-as-claude"*，记录的步骤会用同样的 Playwright MCP 沙箱、在你真实的浏览器里重新跑一遍。Skill 就是 Markdown 文件，跟着仓库走。
- **📋 Save as Jira case** → `__vibe_tests__/<slug>.case.csv` —— 多行格式 CSV，遵循 [Xray Test Case Importer](https://docs.getxray.app/display/XRAY/Importing+Manual+Tests+using+Test+Case+Importer) 规范（Manual Test 类型、每一步一行 Action、最后一行带 Expected Result）。直接拖进 Xray、[Zephyr Scale](https://support.smartbear.com/zephyr-scale-cloud/docs/en/test-management/test-cases/importing-test-cases.html) 或者原生 Jira issue importer，agent 跑过的流程就以**真实可追踪的测试用例**形态出现在 Jira 里 —— 立刻能分派、能挂到 story / sprint 上、能作为人工 Manual Test 跑。**再也不用把测试步骤从代码编辑器一行一行抄进 Jira。**

| | `📜 .spec.ts` | `💾 SKILL.md` | `📋 .case.csv` |
|---|---|---|---|
| **落在哪** | `__vibe_tests__/` | `.claude/skills/` | `__vibe_tests__/` |
| **谁读** | Node + Playwright (CI) | Claude Code / agent | Xray · Zephyr Scale · Jira issue importer |
| **受众** | CI、写代码的开发 | 未来探索时的你 | QA review · PM 追踪 · auditor 签字 |
| **确定性** | 硬合约 | 尽力重放 | 人工 review，人手动跑勾选 |
| **编辑方式** | 代码编辑器 | Markdown 编辑器 | 表格软件，或导入后用测试管理工具的 UI |

可以只存一种，也可以全存。Spec 给 CI，Skill 给下一次探索，Case 给测试团队和 sprint board —— 同一个会话、同一张 Save card。

<p align="center">
  <img src="docs/screenshots/05-save-dropdown.png" alt="Save 下拉菜单 — Playwright spec、Claude Code Skill、Jira test case (CSV)" width="48%" />
  <img src="docs/screenshots/06-jira-case-modal.png" alt="Save as Jira case 弹窗" width="48%" />
</p>

### 团队内可共享，不绑在工具里

三种文件都跟你代码一起 commit 进 git。一个前端开发把流程一存，剩下的所有人都能用 —— **不用装 Hover、不用 agent、不用 token**：

- **QA / 测试团队** clone 仓库跑 `pnpm test:e2e` 拿 spec 的确定性结果，*或者* 把对应的 `.case.csv` 拖进 Xray / Zephyr Scale / Jira，按 Manual Test 流程跑同一套步骤 —— 全程可追踪、可分派。不用装 Hover、不用配 Chrome、不用懂"agent"是什么。
- **其他前端** 在自己的 Hover widget 里调起已存的 skill —— *"execute login-as-claude"* 会在他们自己的浏览器 session 里重放记录的步骤。Skill 最适合不依赖特定用户数据或动态元素 ID 的流程，比如页面导航、表单填写模式、UI 探索路径等。
- **PR review** 把每个 spec 当成普通代码处理 —— 可 diff、可 blame、可 `requestChanges`。没有专有格式、没有 SaaS 仪表盘、没有"测试过了但看不到怎么过的"。
- **Sprint 规划 / PM 追踪** —— `.case.csv` 进 Jira 就是真实的 test issue，可以挂在 story 上、分派给测试、按 Manual Test session 跑。Jira board 上反映的就是这个 app **真能做**的事，不是"计划要做"。
- **新人 onboarding** 就是 `git clone && pnpm install && pnpm test:e2e`。测试套件本身就是这个 app 每条重要流程**怎么跑通**的活文档 —— 新人看真实浏览器走过真实场景。

所有东西都进 git。没有任何东西在某个供应商的数据库里。前端周一在本地写的 spec，QA 周二 review，周三在 CI 里跑 —— 同一个文件，无导出步骤。

## v0.2.x 里你能拿到的（Phase 2 已发布）

- **Vite 插件** —— 通过 `transformIndexHtml` 往 dev 页面注入一个 Shadow DOM widget。生产构建里完全是 no-op。`data-hover="true"` 标记让你自己的 Playwright 跑测试时自动跳过它。
- **无需 API key、无需 `.env`、不按 token 计费。** Hover 调用你 `PATH` 上已经装好的 coding-agent CLI，跑在你已经付费的订阅里（Claude Pro / Max、ChatGPT Pro）。`@hover-dev/core` 这个包里没有任何 LLM SDK 代码——没有需要 auth 的东西。把你已付费的 agent 额度榨干。
- **多 agent。** `claude`（硬沙箱，推荐）和 `codex`（软沙箱）都已接入。服务启动时自动检测你 PATH 上装的哪个；widget 头部显示当前 agent 为 pill (`claude ▾`)，下拉可即时切换。`cursor-agent` / `aider` / `gemini-cli` 都是单文件加 registry 就能扩展。
- **按 agent 不同的沙箱策略。** 硬沙箱 agent（claude）显式 allow/deny，只剩 Playwright MCP 能被调用；`Bash` / `Edit` / `Write` / `Read` / `WebFetch` 等全部明确 deny；支持 `--max-budget-usd` 硬上限。软沙箱 agent（codex）CLI 没有内置工具 deny list，我们用 `--sandbox read-only` + 严格 `developer_instructions` 系统提示约束；widget 会给软沙箱 agent 加 ⚠ 标，让你知道工具面更宽。
- **Widget v2 —— 可扩展的信息层级。** 对话以每个自然语言意图为一行，而不是淹没在 `browser_click` 之类的 raw 事件里。工具调用详情折叠在 chevron 后；正在执行的 step 有 mint 左竖条 + spinner。深色面板、单一 mint accent、自定义 inline-SVG 图标 + 同主题 tooltip —— 让 widget 安静地浮在你的 dev 页面上，不抢戏。
- **Result + Findings 卡。** 一次 run 结束后，widget 把 agent 的验证报告渲染为独立的 Result 卡（markdown 已 strip，纯文本），Save-as 下拉就挂在它上面。如果 agent 总结里包含 `## Findings` 块——bug、轻微问题、观察——会单独抽出来渲染为 Findings 卡，每行带 severity 配色。Bug 发现是一等输出，不再淹没在叙述里。
- **CDP 直连专用 debug Chrome。** Hover 操作的是它在 `<tmpdir>/hover-chrome` 下启动的隔离 profile，不会动你的主 Chrome 配置，也不会启 headless Chromium。Cookie / 扩展 / DevTools 状态都不会从主浏览器迁过来——你在 debug Chrome 里登一次，profile 目录会复用，登录态能跨 Hover 指令和 dev server 重启保持。
- **三种结晶格式。**
  - **Save as Playwright spec** → 落盘到 `__vibe_tests__/<slug>.spec.ts`，selector 用 `getByRole / getByLabel / getByTestId`。JSDoc 头部带人话 Steps + Expected 块，方便非程序员 review。
  - **Save as Skill** → 落盘到 `.claude/skills/<slug>/SKILL.md`，未来对话里说一句 *"execute login-as-claude"* 就能重放。
  - **Save as Jira case** → 落盘到 `__vibe_tests__/<slug>.case.csv`，Xray 兼容的多行 CSV，直接导入 Jira / Xray / Zephyr Scale 成为 Manual Test issue。
- **Alt-click "Assert This"** —— 按住 ⌥ 点页面上任何元素，生成一条 Playwright 断言（`expect(...).toHaveValue / toBeChecked / toHaveText / …`）。断言会累积，下一次 *Save as spec* 时一起烘焙进文件。
- **录制模式** —— 切到 Record，手动跑一遍流程，得到跟 AI 驱动同样形状的 step 序列。下游 save 路径根本不关心 step 是 AI 跑出来的还是你点出来的。
- **会话持久化 + resume** —— widget 状态通过 `localStorage` 跨页面刷新存活；下次提示会接上同一个 `claude --session-id`。

### Bug 发现是一等输出

Agent 的验证报告和发现的 bug 在结束时落到独立卡片，不和 step 时间线混在一起。Result 卡里是文字总结（PASS / FAIL + 走的步骤）；Findings 卡列出 agent 标注的每个 `## Bug` / `## Minor` / `## Note`，按 severity 配色。

<p align="center">
  <img src="docs/screenshots/07-findings-card.png" alt="Findings 卡 — agent 标注的 bug 和轻微问题" width="60%" />
</p>

system prompt 教 agent 每次结束都用这种结构化块输出，QA 读 spec 时不需要在 tool calls 里翻就能扫到 bug 列表。

### 自选 agent —— claude、codex，或自己加

Widget 头部显示当前 agent 的 pill，点开是 registry 里所有 agent 的下拉，标注哪些在你 PATH 上、哪些没装（带可复制的安装提示）。无需重启 dev server 即切。

<p align="center">
  <img src="docs/screenshots/08-agents-dropdown.png" alt="Agent picker 下拉 — Claude Code 已安装、OpenAI Codex 待装" width="50%" />
</p>

`claude` 是推荐默认（硬沙箱，工具面仅限 MCP）。`codex` 是二等公民（软沙箱——codex CLI 没暴露内置工具 deny list，我们靠它的 `--sandbox read-only` + 严格 `developer_instructions`）。Widget 会给软沙箱 agent 加 ⚠ 标。

加 `cursor-agent` / `aider` / `gemini-cli` 或你自己的 coding-agent CLI 只需要在 [`packages/core/src/agents/registry.ts`](./packages/core/src/agents/registry.ts) 加一个文件。

## 快速开始

第一次需要两个终端。Chrome 和 Vite 起来之后会一直跑，跨多次 loop 都不用关。

```bash
git clone https://github.com/Hyperyond/Hover.git
cd Hover
pnpm install
pnpm --filter basic-app exec playwright install chromium   # 仅 `pnpm test:e2e` 需要
```

```bash
# 终端 1 —— basic-app 跑在 http://localhost:5173。仓库里的 examples 都传了
# `autoLaunchChrome: true`，所以这一步也会顺带拉起 debug Chrome（9222 端口，
# 隔离 profile 在 <tmpdir>/hover-chrome）并打开 dev URL。
pnpm dev:example:basic-app
```

```bash
# 终端 2 —— 跑 AI 烟雾测试（CDP 预检 → 调起 claude → 流式输出事件）
pnpm smoke
# 或者自定义目标 + 提示：
pnpm smoke http://localhost:5173/ "登录然后加一条名为 'verify hover' 的 todo"
```

或者直接在 debug Chrome 里打开 `http://localhost:5173/`，点 ✨ 浮动按钮，往 widget 里输入指令。

## 安装

**一条命令，零全局安装：**

```bash
npx @hover-dev/cli add
```

这个 CLI 会自动识别你的 bundler（Vite / Astro / Nuxt / Webpack），读 lockfile 决定用 pnpm / yarn / bun / npm 装包，装上对应的 Hover 包并 AST 改你的 config 文件。幂等 —— 重跑安全。

如果想强制走某个 bundler：

```bash
npx @hover-dev/cli add --vite      # vite-plugin-hover
npx @hover-dev/cli add --astro     # @hover-dev/astro
npx @hover-dev/cli add --nuxt      # @hover-dev/nuxt
npx @hover-dev/cli add --webpack   # webpack-plugin-hover
```

只想看不想动：`npx @hover-dev/cli add --dry-run`。

<details>
<summary>或者手动安装</summary>

```bash
pnpm add -D vite-plugin-hover     # Vite 项目
# 或者 `@hover-dev/astro`、`@hover-dev/nuxt`、`webpack-plugin-hover`
```

然后在 bundler 的 config 文件里手动加上 plugin/integration —— 详见 [`packages/`](./packages) 下对应包的 README。

</details>

不用 `.npmrc`、不用 token。所有包都是 npmjs.com 上的公开包。

**也不用填 `.env`。** Hover 不打包 LLM SDK，它会调用你 `PATH` 上已经装好的 coding-agent CLI —— `claude`（[安装](https://docs.claude.com/claude-code)）或 `codex`（[安装](https://developers.openai.com/codex)）。你已经登录的那个，直接就能跑。

接着直接跑你的 dev server：

```bash
pnpm dev
```

在**任意** Chrome 里打开 dev URL。右下角的 ✨ 浮动按钮会用颜色告诉你它现在的状态：

- **蓝色** —— 你正在 debug Chrome 里，直接点开聊天。
- **琥珀色** —— 还没 debug Chrome。点一下，widget 会自动拉起一个（profile 隔离在 `<tmpdir>/hover-chrome`，并直接打开你的 dev URL），然后提示你切过去用。
- **灰色** —— debug Chrome 在跑，但你不在那个窗口里。点一下，把那个窗口拉到前台。

希望 `vite dev` 时就预热好 Chrome？`hover({ autoLaunchChrome: true })`。喜欢自己手动开？`pnpm exec hover-chrome`（或 `npx hover-chrome`）。

## 在 React (Vite) 项目里用

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from 'vite-plugin-hover';

export default defineConfig({
  plugins: [
    react(),
    hover(),                 // 👈 加这一行
  ],
});
```

集成就这一行。照常 `vite dev`，打开你的应用，点 ✨。按钮颜色会告诉你它还需要什么（如果有的话）。

> 通过 widget 保存的 spec 落在项目根目录的 `__vibe_tests__/` 下。用 `npx playwright test` 跑。它只 import `@playwright/test`，对 Hover 没有任何运行时依赖 —— 所以 CI 跑测试时 widget 完全可以禁用。

## 在 Vue (Vite) 项目里用

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { hover } from 'vite-plugin-hover';

export default defineConfig({
  plugins: [
    vue(),
    hover(),                 // 👈 加这一行
  ],
});
```

流程完全一样。Vite dev 服务器 → debug Chrome → ✨。

> Svelte / Solid / Qwik / 原生 JS 都一样能用 —— **只要 Vite dev server 真正会跑用户 Vite 插件的 `transformIndexHtml`**，插件就跟具体框架无关。
>
> **Astro** 有自己的 HTML 管线，会绕过 `.astro` 页面的 `transformIndexHtml` —— 请用 [`@hover-dev/astro`](./packages/astro-integration/) 集成，它把同一套 service + widget 套在 Astro 的 `injectScript` API 上。
>
> **Nuxt** 通过 Nitro 渲染 HTML，不走 Vite，所以 Vite 的 `transformIndexHtml` 对 Nuxt 的 SSR 响应是 no-op —— 请用 [`@hover-dev/nuxt`](./packages/nuxt-integration/) 模块，它把 widget 推进 `nuxt.options.app.head.script`（Nitro 会内联到 SSR 出的 HTML 里）。
>
> **基于 Webpack 的项目**（vanilla `webpack-dev-server`、Rspack、Rsbuild、走 `craco` 的老 CRA、走 `configureWebpack` 的老 Vue CLI）—— 请用 [`webpack-plugin-hover`](./packages/webpack-plugin/)，它挂在 `HtmlWebpackPlugin` 的 `alterAssetTagGroups` 钩子上。
>
> **Next.js** 自 16 起默认使用 Turbopack，而 Turbopack 不加载 webpack 插件。`next dev --webpack` 模式的用户可以手动接 `webpack-plugin-hover`（详见包 README）。Turbopack 原生的 `@hover-dev/next` 已经在路线图上。

## 插件选项

```ts
hover({
  port: 51789,             // 本地 WebSocket 端口；占用了会自动顺延
  enabled: true,           // 设为 false 关闭（默认仅 dev 模式生效）
  chromeDebugPort: 9222,
  agentId: 'claude',       // 对应 @hover-dev/core 的 agent registry
  model: 'sonnet',         // 'opus' 大约贵 5×—— 浏览器驱动用 sonnet 完全够
  maxBudgetUsd: undefined, // 每次 agent 调用的 $ 硬上限；默认不设，让 widget 里的 Stop 按钮控住
});
```

## 九个 example 应用

`examples/` 下每个都是真实可跑的应用，按"测试场景"和"bundler / 框架覆盖"两个维度铺开：

| 应用 | 端口 | 压什么 |
|---|---|---|
| [basic-app](./examples/basic-app) | 5173 | 登录 + 计数器 + todos。基线烟雾 · Vite + React |
| [e-commerce](./examples/e-commerce) | 5174 | 长动作链：商品列表 → 购物车 → 结账，跨标签页支付弹窗 · Vite + React |
| [stock-registration](./examples/stock-registration) | 5175 | ~50 字段的券商开户表单，含条件展示 —— AI 填写富控件的能力 · Vite + React |
| [canvas-paint](./examples/canvas-paint) | 5176 | `<canvas>` 像素中夹着 DOM 工具栏 —— 截图不透明时还能不能找到语义 selector · Vite + React |
| [payment-provider](./examples/payment-provider) | 5177 | **故意不装** Hover 插件 —— 模拟跨标签页流程里的第三方域 · Vite |
| [astro-app](./examples/astro-app) | 5178 | Astro 5 静态站点烟雾页 —— 验证 `@hover-dev/astro` 走 `injectScript` 注入 |
| [nuxt-app](./examples/nuxt-app) | 5179 | Nuxt 4 SSR 烟雾页 —— 验证 `@hover-dev/nuxt` 走 `app.head.script` 注入 |
| [webpack-app](./examples/webpack-app) | 5180 | vanilla webpack 5 + `webpack-dev-server`，纯 JS 无 React —— 验证 `webpack-plugin-hover` 走 `alterAssetTagGroups` 注入 |
| [rn-web-app](./examples/rn-web-app) | 5181 | React Native Web —— `react-native` 通过 Vite alias 指到 `react-native-web`，编译到 DOM。证明 RN Web 在覆盖范围内（RN 原生不在） |

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
- **v0.1.x** —— Phase 1 —— Vite 插件 + 聊天 UI + 持久化服务 + Save as Spec ✓
- **v0.2.x** —— Phase 2 —— 多 agent（claude + codex）、深色 widget v2、Result + Findings 卡、自定义 tooltip、代码质量重构 ✓ **（你在这里）**
- **v0.3.x** —— **`@hover-dev/next` —— Next.js 16+ Turbopack 原生集成。** 现有 `webpack-plugin-hover` 只覆盖 `next dev --webpack`；Next 16 默认走 Turbopack，而 Turbopack 不加载 webpack plugin。补上原生 Next 模块，把 Hover bundler 覆盖故事里最大的那块缺口堵上。
- **v0.4.x** —— **点击元素 → 生成精准修复提示词。** Hover 就长在 dev 页面里，可以读取 Vite / 框架插件注入的源码位置标记（React fiber 的 `_debugSource`、Vue `vite-plugin-vue-inspector` 注入的 `data-v-inspector` 属性），结合 DOM selector chain 一起组装出"文件路径 + 行号 + 列号 + 组件路径 + 选择器"的完整修复 prompt——Findings 卡里每条 bug 都会带一个 "Suggest fix" 按钮，一键复制丢到 coding-agent 聊天框。*前提说明：React ≤18 和 Vue + inspector plugin 开箱可用；React 19 删了 `_debugSource`，我们会另起炉灶写一个框架无关的 Vite transform 注入 `data-hover-source` 属性来补这个缺口。*
- **v0.5.x** —— **多 tab / 跨 origin spike + 更多 agent。**
  - 多 tab / 跨 origin 场景（Stripe、OAuth、"Pay with PayHover"）—— spike 阶段。`examples/payment-provider` 已经在压 `window.open` → `postMessage` 回调路径，但 agent 实际处理 `browser_tabs(list/select)` 在野外还是脆。先开 tracking issue，spike 跑通再决定形态、再写进 release。
  - 更多 agent 接入 [registry](./packages/core/src/agents/registry.ts) —— `cursor-agent` / `aider` / `gemini-cli` / `qwen-code`。
- **v0.6.x** —— Chrome 扩展（脱离 Vite 插件依赖，支持非 Vite 栈）

Phase 2 是你今天就能用的。

## 项目状态

🟢 **Phase 2 已发布** 在 v0.2.x —— dogfood 可用。可以在真实 Vite 应用上跑；之前偶尔会出现 AI navigate 到同源 URL 把 widget 打断的问题，现在系统 prompt 已加固（明确禁止 agent `browser_navigate` 到当前 origin）。万一漏掉，刷新后会自动 resume。

Issue 跟踪：[github.com/Hyperyond/Hover/issues](https://github.com/Hyperyond/Hover/issues)。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。简要：

- Node 22+ / pnpm 10+
- Conventional Commits（`commit-msg` hook 强制）
- 推送前跑 `pnpm typecheck && pnpm test`
- 保持 `main` 可运行 —— 实验性工作放在 `experiment/<name>` 分支

## License

[Apache-2.0](./LICENSE) © Hyperyond
