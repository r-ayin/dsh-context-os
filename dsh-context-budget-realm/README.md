# dsh-context-budget-realm

`dsh-context-budget` 的 **realm 侧换窗执行器**。只在 preset 的 `compaction` 组内挂载，不参与 root 注入。

## 为什么需要单独一个包

dsh 的压缩引擎（服务名 `compaction`）被 preset 的 `cordis:group` + `isolate: { compaction: true }` 隔离在 realm 子树内。这带来两个后果：

1. **root 注入的插件解析不到它** —— `ctx.compaction` 在 root 平面永远是 undefined；
2. **root 侧写 `inject: ['compaction']` 会永久 pending** —— 引擎不在 root 平面，依赖永远等不到，fiber 卡死（这是实际发生过的事故）。

所以必须拆成两个实例：

| 实例 | 位置 | 职责 |
|---|---|---|
| 主包 `dsh-context-budget` | root 注入 | 工具面、预算 provider、**写**换窗标志文件 |
| 本包 | preset compaction 组内 | **消费**换窗标志文件、调用压缩引擎 |

## 跨 isolate 的通信

realm 之间没有共享 JS 作用域，所以用**文件标志**作为唯一可靠通道：

```
~/.dsh/context-budget/rollover/<session-id>.json   # { ts: <epoch ms> }
```

主包的 `new_window` 工具写标志 → 本包在 `agent/pre-step` 消费 → `compactIfNeeded(agent, 'context-overflow')` → 结果落 `~/.dsh/context-budget/notes/<session-id>.jsonl`。

保护机制：

- **10 分钟过期**（`staleMinutes`）——陈旧标志不会被误消费；
- **四分支全落盘** —— 已执行 / 无可压范围 / 引擎不可用 / 引擎异常，任何一种都写 notes，不静默失败；
- **永不阻塞轮次** —— 全部逻辑包在 try/catch 内，异常不会中断对话。

## 关键实现点

```ts
export const inject = ['compaction']
```

`inject` 声明式等待是 realm 内拿到引擎的**唯一可靠路径**（与官方 `command-compact` 同款）。裸属性读（`ctx.compaction` 直接取值）在 realm 内会失败——cordis Service 通过 `ctx.reflect.provide(name, this, this[Service.check])` 注册，带可用性谓词，非 inject 声明的属性读解析不到。

## 装配

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: context-budget-rollover
      name: '@dsh-external/dsh-context-budget-realm'
```

## 配置

| 项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉则完全不注册监听 |
| `staleMinutes` | `10` | 标志文件过期时间 |

## 边界

**标志文件的产生方是主包。** 若 `dsh-context-budget` 主包没有注入，就没有任何东西会写标志文件，本包会静默空转——它不产生标志，只消费。这种情况下的表现是：`new_window` 工具根本不存在（工具面由主包注册）。

纯被动阈值压缩（`compaction-codex` 到 0.8×窗口自动触发）**不依赖本包**，可以单独使用。
