# Pi Assistant — Obsidian 官方插件（本机 Pi 助手）

用 JSONL RPC 调用本机 `pi-rs`（pi.dev 框架的 Rust 移植），作为 Obsidian 侧边栏助手。
仅桌面端（需要本地进程）。

## 功能

- 侧边栏流式聊天（`message_update/text_delta` 逐字渲染）
- 工具栏：连接 Pi / 中断 / 新会话 / 压缩 / 问当前笔记 / 总结笔记
- 发送问题时可自动拼接当前笔记（可关，可截断）
- 命令面板：`打开 Pi Assistant`
- 设置：pi-rs 路径、模型、额外参数、是否带笔记、笔记最大字符数

## 前置条件

```bash
pi-rs --help        # 能跑就行
pi-rs --mode rpc    # JSONL RPC 常驻模式
```

本机验证过的协议（pi-rs 0.1.0）：

- stdin 一行一命令：`{"type":"prompt","message":"hi"}`

  ```json
  {"type":"prompt","message":"..."}
  {"type":"steer","message":"..."}
  {"type":"follow_up","message":"..."}
  {"type":"abort"}
  {"type":"clear_queue"}
  {"type":"new_session"}
  {"type":"set_model","model":"MiniMax-M3.1-Flash"}
  {"type":"get_state"}
  {"type":"get_available_models"}
  {"type":"get_available_thinking_levels"}
  {"type":"compact"}
  {"type":"get_session_stats"}
  {"type":"bash","command":"ls"}
  {"type":"get_last_assistant_text"}
  ```

  完整命令表（非法命令的 error 即会吐出）：`prompt, steer, follow_up, abort, clear_queue, new_session, set_model, cycle_model, set_thinking_level, cycle_thinking_level, get_state, get_available_models, get_available_thinking_levels, set_steering_mode, set_follow_up_mode, compact, set_auto_compaction, set_auto_retry, abort_retry, bash, abort_bash, get_session_stats, switch_session, fork, clone, get_fork_messages, get_entries, get_tree, get_last_assistant_text, set_session_name, get_messages, get_commands, export_html`

- stdout 一行一消息：`response` / `agent_start` / `turn_start` / `message_start` / `message_update`（文本增量）/ `message_end` / `turn_end` / `agent_end` / `agent_settled`

  ```json
  {"type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}
  {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}
  {"type":"agent_settled","aborted":false}
  ```

注意：`pi-rs/crates/coding` 那套 `--json -p` 一次性模式与本 RPC 模式不同；本插件用的是上游 `--mode rpc` 常驻模式。

## 构建与安装

```bash
cd /Users/andi/ws/oc/obsidian-pi-assistant
npm install
npm run build
# 产物：main.js + manifest.json + styles.css

# 安装到你的 vault：
mkdir -p "<你的Vault>/.obsidian/plugins/obsidian-pi-assistant"
cp main.js manifest.json styles.css "<你的Vault>/.obsidian/plugins/obsidian-pi-assistant/"
# Obsidian → 设置 → 插件 → 开启 Pi Assistant
```

开发调试：

```bash
npm run dev     # esbuild watch
npm run typecheck
```

## 使用

1. 设置里填 `pi-rs` 路径（默认 `/Users/andi/.local/bin/pi-rs`）和模型（留空用默认 `MiniMax-M3.1-Flash`）。
2. 点侧边栏 ✨ 图标打开面板，点「连接 Pi」。
3. 输入问题，`Ctrl/⌘+Enter` 发送；或点「📄 问当前笔记 / ∑ 总结笔记」。
4. vault 路径作为 Pi 的 `cwd`，Pi 的 `read/write/edit/bash` 工具默认在这个目录下工作（YOLO 风格，和 pi-rs 本身一致）。

## 项目结构

```
manifest.json          插件元数据（isDesktopOnly）
main.ts                插件入口：registerView、ribbon、command、设置页
src/pi-protocol.ts     RPC 协议类型与解析（text_delta 归一化）
src/pi-client.ts       spawn pi-rs --mode rpc，长连接 JSONL 读写
src/view.ts            侧边栏 ItemView：消息流、工具栏、当前笔记拼接
styles.css esbuild.config.mjs tsconfig.json
```

## TODO

- [ ] Markdown 渲染（当前为纯文本 pre-wrap）
- [ ] 代码块流式高亮 + 「插入到笔记」按钮
- [ ] 模型/思考等级切换 UI（接 `set_model` / `set_thinking_level`）
- [ ] `abort_bash` / `bash` 按钮
- [ ] 多轮上下文显式切换（`switch_session` / `fork`）
