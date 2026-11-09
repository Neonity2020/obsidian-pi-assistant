/**
 * Pi RPC 协议（JSONL over stdio）
 *
 * 本机 `pi-rs --mode rpc`（上游 pi.dev `--mode` 的 Rust 移植）：
 *  - stdin  一行一命令：{"type":"prompt","message":"..."}
 *  - stdout 一行一消息：response / agent_start / message_update(text_delta) / agent_end / agent_settled
 *
 * 协议依据（实测 pi-rs 0.1.0）：
 *  - 命令 type 取值见非法命令的 error 提示，共 35 种，详见 README。
 *  - 流式文本：{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"..."}}
 *  - 结束：{"type":"agent_settled","aborted":false}
 */

export type RpcCommand =
  | { type: "prompt"; message: string; streamingBehavior?: string }
  | { type: "steer"; message: string }
  | { type: "follow_up"; message: string }
  | { type: "abort" }
  | { type: "get_state" }
  | { type: "get_available_models" }
  | { type: "set_model"; model: string }
  | { type: "compact" }
  | { type: "new_session" }
  | { type: "get_session_stats" }
  | { type: "bash"; command: string; timeout?: number }
  | { type: "get_last_assistant_text" }
  | ({ type: string } & Record<string, unknown>);

export interface RpcResponse {
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
}

export interface PiState {
  model?: { id: string; name?: string; provider?: string };
  thinkingLevel?: string;
  isStreaming?: boolean;
  sessionFile?: string | null;
  sessionId?: string | null;
  messageCount?: number;
  [k: string]: unknown;
}

export type PiEvent =
  | RpcResponse
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "agent_end"; messages?: unknown }
  | { type: "agent_settled"; aborted?: boolean }
  | { type: "message_start"; message?: unknown }
  | { type: "message_end"; message?: { content?: Array<{ type: string; text?: string }> } }
  | {
      type: "message_update";
      assistantMessageEvent?: {
        type?: string;
        delta?: string;
        content?: string;
        contentIndex?: number;
      };
    }
  | { type: "turn_end" }
  | { type: string; [k: string]: unknown };

export function parseEvent(line: string): PiEvent | null {
  line = line.trim();
  if (!line) return null;
  try {
    return JSON.parse(line) as PiEvent;
  } catch {
    return null;
  }
}

/** 把各种 message_update 形态归一化为追加文本 */
export function textDelta(e: PiEvent): string | null {
  if (e.type !== "message_update") return null;
  const a = (e as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
  if (a?.type === "text_delta" && typeof a.delta === "string") return a.delta;
  return null;
}

/** message_end 时的完整文本（兜底 / 纠偏） */
export function fullText(e: PiEvent): string | null {
  if (e.type !== "message_end") return null;
  const m = (e as { message?: { content?: Array<{ type: string; text?: string }> } }).message;
  const parts = m?.content?.filter((c) => c.type === "text").map((c) => c.text ?? "") ?? [];
  return parts.join("");
}
