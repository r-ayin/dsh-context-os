/**
 * @dsh-external/dsh-context-budget-realm — realm 侧换窗执行器。
 *
 * 背景：压缩引擎（CompactionEngine，服务名 'compaction'）被 preset 的 compaction 组
 * isolate 在 realm 内；主包（root 注入）裸属性读解析不到。本包按 command-compact 的
 * 已验证同款路径：inject = ['compaction'] 声明式等待服务就绪，apply 内 ctx.compaction
 * 必然可解析。只挂在 preset compaction 组内（config 行见 agent.cordis.yml），不做
 * root 注入——root 侧无引擎可等，声明式 inject 会永久 pending（2026-09-16 事故教训）。
 *
 * 职责单一：agent/pre-step 消费 ~/.dsh/context-budget/rollover/<sid>.json 标志
 * （由主包 new_window 工具写入）→ compactIfNeeded(agent,'context-overflow') →
 * 结果落 notes（与主包共享同一 notes 目录/格式）。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = '@dsh-external/dsh-context-budget-realm'
export const inject = ['compaction']

export interface Config {
  enabled: boolean
  staleMinutes: number
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  staleMinutes: z.number().default(10),
})

const FLAG_DIR = path.join(os.homedir(), '.dsh', 'context-budget', 'rollover')
const NOTES_DIR = path.join(os.homedir(), '.dsh', 'context-budget', 'notes')
const safe = (s: string): string => String(s).replace(/[^A-Za-z0-9_.-]/g, '_')

function readFlag(id: string): { ts: number } | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(FLAG_DIR, safe(id) + '.json'), 'utf8'))
    return v && typeof v.ts === 'number' ? v : null
  } catch { return null }
}

function deleteFlag(id: string): void {
  try { fs.rmSync(path.join(FLAG_DIR, safe(id) + '.json'), { force: true }) } catch { /* noop */ }
}

function appendNote(id: string, entry: { source: string; tag?: string; text: string }): void {
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true })
    fs.appendFileSync(path.join(NOTES_DIR, safe(id) + '.jsonl'), JSON.stringify({ ts: Date.now(), ...entry }) + '\n', 'utf8')
  } catch { /* notes 失败不阻塞轮次 */ }
}

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  const anyCtx = ctx as any
  ctx.effect(() => anyCtx.on('agent/pre-step', async (payload: any, next: () => Promise<any>) => {
    try {
      const agent = payload?.agent
      const id = String(agent?.session?.id ?? '')
      const flag = id ? readFlag(id) : null
      if (flag && Date.now() - flag.ts < config.staleMinutes * 60 * 1000) {
        deleteFlag(id)
        const engine = anyCtx.compaction
        if (!engine || typeof engine.compactIfNeeded !== 'function') {
          appendNote(id, { source: 'auto', tag: 'new-window', text: '换窗失败：realm 内 inject 声明后 compaction 仍不可用。' })
        } else {
          try {
            const result = await engine.compactIfNeeded(agent, 'context-overflow', payload.signal)
            if (result) {
              appendNote(id, { source: 'auto', tag: 'new-window', text: `换窗已执行：shadowed seq ${result.shadowedRange?.start}-${result.shadowedRange?.end}（约 ${result.shadowedTokenCount} tokens）。旧轮次可用 history_search 检索。` })
            } else {
              appendNote(id, { source: 'auto', tag: 'new-window', text: '换窗请求已处理：引擎判定当前无可安全压缩的范围（返回 null，常见于会话内容全部处于保留区），继续原上下文。' })
            }
          } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e)
            appendNote(id, { source: 'auto', tag: 'new-window', text: `换窗失败：压缩引擎异常 — ${String(msg).slice(0, 200)}` })
          }
        }
      }
    } catch { /* 永不阻塞轮次 */ }
    return next()
  }), 'dsh-context-budget-realm: rollover listener')
}
