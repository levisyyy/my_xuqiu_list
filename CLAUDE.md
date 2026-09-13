# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

产品经理的需求进度跟踪工具。**交付物是单个 `index.html`**（原生 HTML/CSS/JS，零依赖、无构建，双击离线可用）；`package.json` / `test/` 仅用于开发测试，不参与交付。数据存 localStorage（key: `prd-tracker:v1`），支持导出/导入 JSON 备份（导入有校验管线 + 合并/覆盖两种模式）。

核心视图是一张网格：行 = 需求（描述/提出人/优先级/状态/创建日期），列 = **所有周横向平铺**（周一起始，每周 7 个日列 + 1 个周统计"计"列）。周列组不持久化，由 `buildWeeks()` 运行时从"最早需求 createdAt 所在周"生成到"今天所在周"——终点取自今天，所以新一周打开页面自动多出一组列（页面长开时有 60s 心跳 + visibilitychange 跨日检测兜底）。每个"需求×天"格子 = 勾选完成 + click-to-edit 进度备注。

## 常用命令

```bash
npm install   # 首次安装 jsdom（仅此一个 devDependency）
npm test      # 语法检查 + jsdom 端到端冒烟测试（60 项断言）
node test/smoke.test.js   # 只跑冒烟测试
node test/syntax.check.js # 只检查内嵌 JS 语法
```

运行应用：直接用浏览器打开 `index.html`（file:// 协议，Chrome/Edge 下 localStorage 正常）。

## 架构（单文件内部分层）

`index.html` 只有一个 `<script>`（IIFE），按编号注释分区，依赖方向自上而下：

```
1 CONFIG → 2 utils(日期/esc/uid) → 3 storage(探测/读/写) → 4 state & actions(唯一可变数据源)
→ 5 weekcalc(buildWeeks) → 6 computeView/computeSummary(纯函数: state→视图模型, 所有统计在这算)
→ 7 render(视图模型→HTML字符串) → 8 备注click-to-edit → 9 checkbox局部patch
→ 10 模态框(需求表单/confirmDialog/importDialog) → 11 导出导入 → 12 事件委托 → 13 跨日检测 → 14 init
```

**数据流**：用户事件（全部委托在 `#tableWrap`，按 `data-action` 分发，无内联 onclick）→ action 改 `state` → `persist()` 写 localStorage → `render()` 全量 innerHTML 重建（**前后保存/恢复 scrollLeft/Top**，横向平铺方案的关键体验）。

**数据模型**：`{ version, requirements: [{id,title,proposer,priority,status,createdAt,updatedAt}], records: {"<reqId>|<YYYY-MM-DD>": {done,note}} }`。

## 修改代码时必须保持的不变量

- **日期一律本地 `YYYY-MM-DD` 字符串 + 字典序比较**（`day.key >= req.createdAt` 的可填判定就靠字典序）。构造 Date 必须用 `fromKey()`——`new Date('YYYY-MM-DD')` 按 UTC 解析会导致跨日偏移。`toKey/addDays/startOfWeek/isoWeekOf`（ISO 周四规则，处理跨年）都是纯本地日期函数，勿引入时间戳存储。
- **空记录必须删除**：`done=false && note=''` 时 `setRecord` 删 key（导入校验同样跳过空记录），保持存储精简。
- **两个渲染例外走局部 DOM patch，不做全量 render**：checkbox 勾选（`patchAfterToggle`：只更新格子 class、该行周统计 chip、累计天数、摘要）和备注提交/取消（`restoreNoteDiv` 就地还原 div）。原因：全量重建会导致连续勾选闪烁、滚动跳动、以及"点击第二个格子时 blur→render 吃掉 click"的丢点击问题。其余一切修改都走 `render()`。
- **editing 守卫**：`render()` 开头若 `editing` 非空先 `commitNote()`；备注编辑器的 blur/keydown 回调都先判 `editing` 非空（防止已提交后二次触发）。
- **XSS 红线**：所有用户文本（title/proposer/note）拼入 HTML 字符串前必须过 `esc()`；局部还原备注用 `textContent`。
- **sticky 体系**：table 必须 `border-collapse: separate`（collapse 下 sticky 边框会丢）；所有 sticky 格（corner/week-head/day-head/req-cell）必须**实色背景**（半透明会滚动穿透）；z-index 分层 corner 30 > 表头 20 > 首列 10；`.day-row th` 的 `top` = `--week-row-h`。
- **三处列宽必须同步改**：CSS 变量 `--sticky-col-w/--day-col-w/--stat-col-w`、`buildColgroup()` 里的硬编码 px、JS 常量 `STICKY_COL_W`（`scrollToCurrentWeek` 用它计算落点），当前为 280/116/52。
- **周统计分母 = 该周内 ≥ createdAt 的天数**；需求创建前的格子渲染为 `.before-create` 灰壳（无 checkbox、不可交互）。未来日期**允许填写**（PM 预填本周计划），只用 `.future` 置淡，不要禁用。
- **storage 降级链**：`probeStorage()` 失败 → 纯内存运行 + 常驻 banner；`persist()` 捕获 QuotaExceeded → toast；读取解析失败 → 原数据挪到 `prd-tracker:v1:corrupt-<时间戳>` 后重置（不直接删）。

## 测试注意事项

`test/smoke.test.js` 用 jsdom（`runScripts:'dangerously'` + `url:'http://localhost/'`，localStorage 需要非 opaque origin）驱动真实 UI 交互并断言 DOM 与 localStorage。两个坑：

- `confirmDialog/importDialog` 返回 Promise，测试中点击确认按钮后必须 `await flush()`（setTimeout 0）让微任务执行完再断言；浏览器中无此问题。
- jsdom 的 `getBoundingClientRect` 全为 0，`scrollToCurrentWeek` 在测试中不会真实滚动（无害）；sticky/高亮等视觉效果需在真实浏览器验证。
- 测试断言的日期基准是"系统今天"，用例中的 createdAt（2026-08-28 等）为过去日期，随时间推移仍成立；若改测试数据，保持 createdAt ≤ 今天。
