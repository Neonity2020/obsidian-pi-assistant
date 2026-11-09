import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import { PiAssistantView, VIEW_TYPE_PI } from "./src/view";

interface PiAssistantSettings {
  binary: string;
  model: string;
  extraArgs: string;
  includeCurrentNote: boolean;
  noteMaxChars: number;
}

const DEFAULT_SETTINGS: PiAssistantSettings = {
  binary: "/Users/andi/.local/bin/pi-rs",
  model: "",
  extraArgs: "",
  includeCurrentNote: true,
  noteMaxChars: 12000,
};

export default class PiAssistantPlugin extends Plugin {
  settings: PiAssistantSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_PI, (leaf: WorkspaceLeaf) => new PiAssistantView(leaf, this.settings));

    this.addRibbonIcon("sparkles", "打开 Pi Assistant", () => this.openView());
    this.addCommand({
      id: "open-pi-assistant",
      name: "打开 Pi Assistant",
      callback: () => this.openView(),
    });
    this.addCommand({
      id: "ask-current-note",
      name: "Pi：问当前笔记",
      callback: async () => {
        await this.openView();
        new Notice("在侧边栏输入问题后点「📄 问当前笔记」");
      },
    });

    this.addSettingTab(new PiAssistantSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PI);
  }

  async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PI);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    // 新版 Obsidian（≥1.7.2）：ensureSideLeaf 是打开侧边栏视图的官方入口
    const ws = this.app.workspace as unknown as {
      ensureSideLeaf?: (type: string, side: string, opts?: object) => Promise<WorkspaceLeaf>;
      getRightLeaf?: (split: boolean) => WorkspaceLeaf | null;
    };
    if (typeof ws.ensureSideLeaf === "function") {
      const leaf = await ws.ensureSideLeaf(VIEW_TYPE_PI, "right", { reveal: true });
      this.app.workspace.revealLeaf(leaf);
      return;
    }
    // 兼容旧版：没有 setViewType，用 leaf.open(view) 直接挂载
    const leaf = ws.getRightLeaf ? ws.getRightLeaf(false) : null;
    if (leaf) {
      await leaf.open(new PiAssistantView(leaf, this.settings));
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class PiAssistantSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PiAssistantPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Pi Assistant 设置" });

    new Setting(containerEl)
      .setName("pi-rs 二进制路径")
      .setDesc("本机 Pi 的路径（需先能执行 `pi-rs --help`）")
      .addText((t) => t.setValue(this.plugin.settings.binary).onChange((v) => { this.plugin.settings.binary = v; this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("模型")
      .setDesc("留空用默认模型；或填 MiniMax-M3.1-Flash 等")
      .addText((t) => t.setValue(this.plugin.settings.model).onChange((v) => { this.plugin.settings.model = v; this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("额外参数")
      .setDesc("透传给 pi-rs，如 \"--no-session\"（空格分隔）")
      .addText((t) => t.setValue(this.plugin.settings.extraArgs).onChange((v) => { this.plugin.settings.extraArgs = v; this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("发送时带当前笔记")
      .setDesc("把当前笔记内容拼到问题后一起发给 Pi")
      .addToggle((t) => t.setValue(this.plugin.settings.includeCurrentNote).onChange((v) => { this.plugin.settings.includeCurrentNote = v; this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("笔记最大字符数")
      .setDesc("过长笔记截断，避免超上下文")
      .addText((t) => t.setValue(String(this.plugin.settings.noteMaxChars)).onChange((v) => { this.plugin.settings.noteMaxChars = parseInt(v, 10) || 12000; this.plugin.saveSettings(); }));

    containerEl.createEl("p", { text: "插件通过 JSONL RPC 调用：spawn `pi-rs --mode rpc`，stdin 写命令、stdout 读 message_update 流。vault 路径作为 cwd。", cls: "setting-item-description" });
  }
}
