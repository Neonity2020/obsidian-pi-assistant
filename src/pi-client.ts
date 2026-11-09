import { ChildProcess, spawn } from "child_process";
import { parseEvent, textDelta, type PiEvent, type PiState, type RpcCommand } from "./pi-protocol";

export interface PiClientOptions {
  binary: string; // pi-rs 绝对路径，如 /Users/andi/.local/bin/pi-rs
  cwd: string; // vault 路径作为 cwd，会话与文件工具以此为根
  model?: string; // --model
  extraArgs?: string; // 透传，如 "--no-session --no-context-files"
}

export interface PiClientHandlers {
  onDelta: (delta: string) => void;
  onEvent: (e: PiEvent) => void;
  onError: (msg: string) => void;
  onExit: (code: number | null) => void;
  onSettled: (aborted: boolean) => void;
}

/**
 * 长连接 RPC 客户端：常驻一个 pi-rs 子进程，stdin 写命令、stdout 读 JSONL 事件。
 * pi-rs 官方支持 `--mode rpc` / `--rpc` 常驻模式，所以不需要每次 spawn 一次性模式。
 */
export class PiClient {
  private proc: ChildProcess | null = null;
  private buf = "";
  private handlers: PiClientHandlers;

  constructor(
    private opts: PiClientOptions,
    handlers: PiClientHandlers,
  ) {
    this.handlers = handlers;
  }

  start() {
    this.stop();
    const args = ["--mode", "rpc"];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.extraArgs) args.push(...this.opts.extraArgs.split(/\s+/).filter(Boolean));

    this.proc = spawn(this.opts.binary, args, {
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString().trim();
      if (s) this.handlers.onError(s);
    });
    this.proc.on("exit", (code) => this.handlers.onExit(code));
    this.proc.on("error", (err) => this.handlers.onError(`spawn pi-rs 失败: ${err.message}`));
  }

  private onData(chunk: Buffer) {
    this.buf += chunk.toString("utf-8");
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      const e = parseEvent(line);
      if (!e) continue;
      this.handlers.onEvent(e);
      const d = textDelta(e);
      if (d) this.handlers.onDelta(d);
      if (e.type === "agent_settled") {
        this.handlers.onSettled(Boolean((e as { aborted?: boolean }).aborted));
      }
      if (e.type === "response" && !(e as { success?: boolean }).success) {
        const err = (e as { error?: string }).error;
        if (err) this.handlers.onError(err);
      }
    }
  }

  send(cmd: RpcCommand) {
    const line = JSON.stringify(cmd) + "\n";
    this.proc?.stdin?.write(line);
  }

  prompt(message: string) {
    this.send({ type: "prompt", message });
  }

  abort() {
    this.send({ type: "abort" });
  }

  getState() {
    this.send({ type: "get_state" });
  }

  /** 从 response 中取出 get_state 数据 */
  static stateOf(e: PiEvent): PiState | null {
    if (e.type !== "response") return null;
    const r = e as { command?: string; data?: unknown };
    if (r.command !== "get_state") return null;
    return r.data as PiState;
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.stdin?.end();
        this.proc.kill();
      } catch {
        // ignore
      }
      this.proc = null;
    }
  }

  get running() {
    return !!this.proc;
  }
}
