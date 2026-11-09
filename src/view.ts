import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf } from "obsidian";
import { PiClient } from "./pi-client";
import type { PiEvent } from "./pi-protocol";

export const VIEW_TYPE_PI = "pi-assistant-view";

interface ViewSettings {
  binary: string;
  model: string;
  extraArgs: string;
  includeCurrentNote: boolean;
  noteMaxChars: number;
}

export class PiAssistantView extends ItemView {
  private client: PiClient | null = null;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private streamingMd = "";
  private busy = false;

  constructor(leaf: WorkspaceLeaf, private settings: ViewSettings) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_PI;
  }
  getDisplayText() {
    return "Pi Assistant";
  }
  getIcon() {
    return "sparkles";
  }

  async onOpen() {
    try {
      const root = this.contentEl;
      (root as HTMLElement).empty?.();
      root.classList.add("pi-assistant-root");
      // 裸 DOM，避免 Obsidian 扩展方法在早期加载时不可用导致空白页
      root.innerHTML = `
        <div class="pi-assistant-header"><strong>Pi Assistant</strong><span class="pi-assistant-status">● 未连接</span></div>
        <div class="pi-assistant-messages"></div>
        <div class="pi-assistant-toolbar"></div>
        <textarea class="pi-assistant-input" rows="3" placeholder="问 Pi… (Ctrl+Enter 发送)"></textarea>
        <button class="mod-cta pi-assistant-send">发送</button>
      `;
      this.statusEl = root.querySelector(".pi-assistant-status") as HTMLElement;
      this.messagesEl = root.querySelector(".pi-assistant-messages") as HTMLElement;
      this.inputEl = root.querySelector(".pi-assistant-input") as HTMLTextAreaElement;
      this.sendBtn = root.querySelector(".pi-assistant-send") as HTMLButtonElement;

      const toolbar = root.querySelector(".pi-assistant-toolbar") as HTMLElement;
      const mkBtn = (label: string, fn: () => void) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.className = "pi-assistant-btn";
        b.onclick = fn;
        toolbar.appendChild(b);
      };
      mkBtn("连接 Pi", () => this.connect());
      mkBtn("■ 中断", () => this.client?.abort());
      mkBtn("＋ 新会话", () => this.client?.send({ type: "new_session" }));
      mkBtn("压缩", () => this.client?.send({ type: "compact" }));
      mkBtn("📄 问当前笔记", () => void this.askNote());
      mkBtn("∑ 总结笔记", () => void this.summarizeNote());

      this.sendBtn.onclick = () => void this.sendCurrent();
      this.inputEl.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          void this.sendCurrent();
        }
      });

      this.addMessage("system", "点「连接 Pi」启动本机 pi-rs RPC 进程。");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Pi Assistant] onOpen 失败", err);
      this.contentEl.innerHTML = `<div style="padding:16px;color:var(--text-error)">Pi Assistant 初始化失败：${String(err)}<br>请打开开发者控制台 (Cmd+Option+I) 查看 [Pi Assistant] 日志</div>`;
    }
  }

  async onClose() {
    this.client?.stop();
  }

  private vaultPath(): string {
    const adapter = (this.app.vault as unknown as { adapter?: { basePath?: string } }).adapter;
    return adapter?.basePath ?? "/";
  }

  private connect() {
    this.client?.stop();
    this.statusEl.textContent = "● 连接中…";
    this.client = new PiClient(
      {
        binary: this.settings.binary,
        cwd: this.vaultPath(),
        model: this.settings.model || undefined,
        extraArgs: this.settings.extraArgs,
      },
      {
        onDelta: (d) => this.appendDelta(d),
        onEvent: (e) => this.onEvent(e),
        onError: (m) => this.addMessage("error", m),
        onExit: (code) => {
          this.statusEl.textContent = `● 已退出 (code ${code})`;
          this.busy = false;
          this.updateSend();
        },
        onSettled: () => {
          this.finishAssistant();
          this.client?.getState();
        },
      },
    );
    this.client.start();
    this.statusEl.textContent = "● 已连接";
    this.client?.getState();
  }

  private onEvent(e: PiEvent) {
    const s = PiClient.stateOf(e);
    if (s?.model?.id) {
      this.statusEl.textContent = `● ${s.model.id}`;
      return;
    }
    if (e.type === "agent_start") {
      this.busy = true;
      this.streamingMd = "";
      this.updateSend();
    }
  }

  private addMessage(role: "user" | "assistant" | "error" | "system", text: string) {
    const div = document.createElement("div");
    div.className = `pi-msg pi-msg-${role}`;
    const r = document.createElement("div");
    r.className = "pi-msg-role";
    r.textContent = role.toUpperCase();
    const body = document.createElement("div");
    body.className = `pi-msg-body${role === "assistant" ? " markdown-preview-view" : ""}`;
    body.textContent = text;
    div.append(r, body);
    this.messagesEl.appendChild(div);
    this.scrollToBottom();
    return body;
  }

  /** 用 Obsidian 自带 MarkdownRenderer 把流式纯文本替换为渲染后的 HTML */
  private async renderMarkdownInto(el: HTMLElement, md: string) {
    if (!md.trim()) return;
    el.empty();
    const MR = MarkdownRenderer as unknown as {
      render?: (app: unknown, md: string, el: HTMLElement, source: string, comp: unknown) => Promise<void>;
      renderMarkdown?: (md: string, el: HTMLElement, source: string, comp: unknown) => Promise<void>;
    };
    try {
      if (typeof MR.render === "function") {
        // `this` 是 ItemView（本身是 Component），可作为渲染生命周期宿主
        await MR.render(this.app, md, el, "", this);
      } else if (typeof MR.renderMarkdown === "function") {
        await MR.renderMarkdown(md, el, "", this);
      } else {
        el.textContent = md;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Pi Assistant] Markdown 渲染失败，保留纯文本", err);
      el.textContent = md;
    }
    this.scrollToBottom();
  }

  private streamingBody: HTMLElement | null = null;

  private appendDelta(d: string) {
    if (!this.streamingBody) {
      this.streamingBody = this.addMessage("assistant", "");
    }
    this.streamingMd += d;
    this.streamingBody.textContent = this.streamingMd;
    this.scrollToBottom();
  }

  private finishAssistant() {
    this.busy = false;
    const body = this.streamingBody;
    const md = this.streamingMd;
    this.streamingBody = null;
    this.streamingMd = "";
    if (body && md) void this.renderMarkdownInto(body, md);
    this.updateSend();
    this.scrollToBottom();
  }

  private updateSend() {
    this.sendBtn.textContent = this.busy ? "■ 思考中…" : "发送";
    this.sendBtn.disabled = this.busy;
  }

  private scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async currentNoteText(): Promise<string | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    const text = await this.app.vault.read(file);
    const clipped = text.slice(0, this.settings.noteMaxChars);
    const suffix =
      text.length > this.settings.noteMaxChars
        ? `\n\n…（笔记较长，已截断至 ${this.settings.noteMaxChars} 字符）`
        : "";
    return `（当前笔记：${file.path}）\n\n${clipped}${suffix}`;
  }

  private async buildPrompt(raw: string): Promise<string> {
    if (this.settings.includeCurrentNote) {
      const note = await this.currentNoteText();
      if (note) return `${raw}\n\n${note}`;
    }
    return raw;
  }

  private async sendCurrent() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    if (!this.client?.running) {
      new Notice("Pi 未连接，请先点「连接 Pi」");
      return;
    }
    this.inputEl.value = "";
    this.addMessage("user", text);
    const full = await this.buildPrompt(text);
    this.client.prompt(full);
  }

  private async askNote() {
    const input = this.inputEl.value.trim();
    if (!input) {
      new Notice("请先在输入框写问题");
      return;
    }
    const note = await this.currentNoteText();
    if (!note) {
      new Notice("没有打开的笔记");
      return;
    }
    if (!this.client?.running) {
      new Notice("Pi 未连接，请先点「连接 Pi」");
      return;
    }
    this.inputEl.value = "";
    this.addMessage("user", `关于当前笔记：${input}`);
    this.client.prompt(`${input}\n\n${note}`);
  }

  private async summarizeNote() {
    const note = await this.currentNoteText();
    if (!note) {
      new Notice("没有打开的笔记");
      return;
    }
    if (!this.client?.running) {
      new Notice("Pi 未连接，请先点「连接 Pi」");
      return;
    }
    this.addMessage("user", "总结当前笔记");
    this.client.prompt(`请用简洁的 Markdown 总结下面的笔记，保留关键要点和待办项：\n\n${note}`);
  }
}
