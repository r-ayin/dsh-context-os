# dsh-context-os

一套 **DeepSeek Harness (dsh)** 的上下文与压缩系统改造：把官方「LLM 摘要式压缩」替换为 **零 LLM 调用的确定性指针模板**，并把 Codex 式的预算告知 / 历史检索 / 检查点笔记机制移植进来。

> 状态：生产环境长期运行（2026-09 起），三个包合计约 1750 行 TypeScript 源码。
> 这是从实际部署实例中抽出的源码快照，**不含**运行期数据、凭据或主机配置。

## 三个包

| 包 | 作用 | 关键点 |
|---|---|---|
| [`dsh-compaction-codex`](dsh-compaction-codex/) | 换窗压缩引擎 | 继承官方 `BasicCompactionEngine`，只覆写 `summarize()` → 纯确定性模板，零 LLM 调用 |
| [`dsh-context-budget`](dsh-context-budget/) | 预算告知 + 旧窗检索 + 检查点 | Codex TokenBudget 移植：预算行、`history_search`、`notes`、`new_window` |
| [`dsh-context-budget-realm`](dsh-context-budget-realm/) | realm 侧换窗执行器 | 突破 cordis `isolate` 边界，消费标志文件调用压缩引擎 |

## 为什么要替换官方压缩

官方 `dsh-compaction-basic` 在会话接近窗口上限时调用 LLM 生成对话摘要，然后用摘要替换旧轮次。问题在于：

1. **摘要是一次额外的 LLM 请求**——压缩本身消耗 token 与延迟；
2. **LLM 摘要是有损的**——细节丢失不可逆，且质量不稳定；
3. **摘要无法预测未来需要什么**——被丢掉的细节可能正是后续任务的关键。

本方案不改动这套事务 machinery（shadow 持久化、replay 定价、工具配对平衡、并发锁、阈值触发全部原样继承），**只替换摘要的生成方式**：不再让 LLM 概括历史，而是写一段**确定性的指针**——声明哪些内容被归档、旧轮次如何检索回来、以及最近的检查点笔记与首尾锚点。

关键洞察：**dsh 的压缩本来就是无损 shadow**。旧事件永久保留在 `session.jsonl.zstd` 里，摘要只影响模型看到的 surface。所以「归档」不需要任何插件去做，只需要保证模型知道**怎么把旧内容找回来**。

## 实际效果

- 压缩触发的 **LLM 请求数为 0**（此前每次压缩 = 1 次额外 LLM 调用）
- 模板全文上限约 9K 字符（约 2.7K tokens），并按归档区大小自适应裁剪尾部预算，恒小于被 shadow 内容（满足官方 `summarizeCompaction` 硬约束）
- 跨 360 份会话转录重扫确认：31 次压缩全部走 `provider: template, model: codex-rollover`，LLM 摘要 0 次
- 预算行注入**不破坏前缀缓存**：走 `systemPrompt.context` 尾部 snapshot 而非 system prompt 头部，实测稳态命中率 ≈100%

## 装配方式

这些包挂进 preset 的 `compaction` 组，替换官方条目：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-codex
      name: '@dsh-external/dsh-compaction-codex'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: context-budget-rollover
      name: '@dsh-external/dsh-context-budget-realm'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024
```

⚠️ **只对新会话生效**——preset 在会话创建时装配，运行中的会话保持旧装配。

## 已知边界

- `new_window`（模型主动换窗）依赖 `dsh-context-budget` 主包注入；**主包未注入时该工具不存在**，`dsh-context-budget-realm` 会空转（它只消费标志文件，不产生标志）。若只需被动阈值压缩，可不装主包。
- 极小压缩区（归档内容少于摘要帧）会按官方逻辑抛错并留在日志，不会静默。
- notes 文件缺失或损坏时自动降级（省略检查点段），不阻塞压缩事务。
- 转录解压为全量加载，超大转录（>80MB）扫描时跳过。

## 回滚

把 preset 里的 `compaction-codex` 改回 `@deepseek-ai/dsh-compaction-basic` 即回到官方 LLM 摘要，热生效（新会话）。

## 构建

各包内 `bash scripts/build.sh`。依赖链接自 dsh 安装分发的 `node_modules`（按 `DSH_INSTALL` 环境变量 → 包内 `node_modules` → 常见全局安装路径的顺序探测）。

## 许可

BSD-3-Clause。见 [LICENSE](LICENSE)。

## 相关阅读

本文档的压缩策略与以下 Anthropic 工程文章的思路互相印证——注意本实现**刻意与其中「用 LLM 生成摘要」的建议分道扬镳**，理由是 dsh 的 shadow 机制让无损归档成为可能：

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic, 2025-09-29
- [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory) — Anthropic, 2026-11-06
