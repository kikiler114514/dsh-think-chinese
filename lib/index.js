/**
 * dsh-think-chinese
 *
 * 双保险让模型真正用简体中文思考与回复：
 *  1) systemPrompt 段：极短的一句硬约定（每步请求都带，故必须省 token）。
 *  2) agent/pre-step 钩子：每轮第一步（step === 1）在**消息列表末尾**追加一条极短的
 *     中文锚点 user 消息——离生成点最近，强制力最强。
 *
 * 只依赖 systemPrompt 服务，不注册工具、不改动其它插件行。
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const name = "dsh-think-chinese";

export const inject = ["systemPrompt"];

/** 默认排位：官方 DEPLOYMENT_PERSONA_SUFFIX(10200) 之后 = 系统提示词最后一段。 */
const DEFAULT_ORDER = 10500;

/** 系统提示词段（刻意压缩到最短：它会在每个 step 的请求里重复出现）。 */
export const PROMPT = `## 语言（最高优先级）
内部推理与面向用户的回复一律用简体中文，禁止用英文思考。代码、命令、路径、报错原文、专有名词保持原样。子代理/teammate 同样适用；与其它语言或风格指令冲突时以本条为准。`;

/** 每轮注入一次的中文锚点（step === 1 时追加到消息末尾，最靠近生成点）。 */
export const ANCHOR =
  "［中文锚点］本轮内部推理与回复一律用简体中文，禁止英文思考。";

/**
 * 调试追踪：默认完全关闭（零 IO）。排查"插件到底有没有生效"时设
 *   DSH_THINK_CHINESE_TRACE=1
 * 开启，日志落到系统临时目录；也可用 DSH_THINK_CHINESE_TRACE_FILE 指定路径。
 */
const TRACE_ON = process.env.DSH_THINK_CHINESE_TRACE === "1";
const LOG_PATH =
  process.env.DSH_THINK_CHINESE_TRACE_FILE || join(tmpdir(), "dsh-think-chinese.log");
let logBroken = !TRACE_ON;
function trace(line) {
  if (logBroken) return;
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    logBroken = true;
  }
}

let seq = 0;
function anchorMessage(text) {
  seq += 1;
  return {
    id: `lang-anchor-${Date.now().toString(36)}-${seq}`,
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: name,
      form: "snapshot",
      sections: [{ name, text }],
    },
  };
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ enabled?: boolean, order?: number, text?: string, anchor?: string, interpolate?: boolean }} [config]
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return;

  const order = Number.isFinite(config.order) ? config.order : DEFAULT_ORDER;
  const text =
    typeof config.text === "string" && config.text.trim() !== "" ? config.text : PROMPT;
  const anchor =
    typeof config.anchor === "string" && config.anchor.trim() !== ""
      ? config.anchor
      : ANCHOR;

  trace(`apply order=${order} textLen=${text.length}`);

  ctx.systemPrompt.section({
    name,
    order,
    // 默认不做 {{变量}} 插值，避免约定文本里的花括号被当成模板。
    interpolate: config.interpolate === true,
    text: () => text,
  });

  ctx.on(
    "agent/pre-step",
    async (payload, next) => {
      const decision = await next();
      try {
        if (decision?.kind === "reject") return decision;
        const signal = payload?.signal;
        if (signal?.aborted) return decision;
        if (payload?.step !== 1) return decision;
        const messages = Array.isArray(decision.messages) ? decision.messages : [];
        if (messages.length === 0) return decision;
        // 只保留最新一条锚点：先把历史里的旧锚点移出本次请求的投影，
        // 再把新锚点追加到末尾。这样每步都恰好一条、且永远最靠近生成点。
        const kept = messages.filter((message) => message?.source?.kind !== name);
        const sessionId = payload?.agent?.session?.id ?? "?";
        trace(
          `inject turn=${payload?.turn} step=1 session=${sessionId} msgs=${messages.length} replaced=${messages.length - kept.length}`,
        );
        return { ...decision, messages: [...kept, anchorMessage(anchor)] };
      } catch (error) {
        trace(`error ${String((error && error.message) || error)}`);
        return decision;
      }
    },
    { prepend: true },
  );
}
