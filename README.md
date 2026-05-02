# agentmemory-cn | agentmemory-cn

> 基于 rohitg00/agentmemory v0.9.3 改造的中文语义增强版 | Chinese semantic enhanced fork based on rohitg00/agentmemory v0.9.3
>
> 当前基线: v0.9.4 | Current baseline: v0.9.4

---

## 项目由来 | Project Origin

原项目 [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) 是为 AI 编程代理设计的持久化记忆引擎，支持 Claude Code、Cursor、Gemini CLI、Hermes、OpenCode 等主流 AI 代理。 | The original [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) is a persistent memory engine for AI coding agents, supporting Claude Code, Cursor, Gemini CLI, Hermes, OpenCode, etc.
但其搜索和嵌入层仅针对英文优化（BM25 分词 + all-MiniLM-L6-v2 嵌入模型），中文记忆检索效果差。 | However, its search and embedding layers are optimized only for English (BM25 tokenizer + all-MiniLM-L6-v2 embeddings), resulting in poor Chinese memory retrieval.
本项目在 v0.9.3 基础上进行了 13 项针对性改造，使其具备中英文混合语义搜索能力。 | This project applies 13 targeted modifications on top of v0.9.3 to enable Chinese-English hybrid semantic search.

---

## 核心改造 | Core Modifications

### 1. 嵌入模型升级 | Embedding Model Upgrade
将 all-MiniLM-L6-v2（384维，英文）替换为 bge-m3（1024维，多语言，Q4 量化） | Replaced all-MiniLM-L6-v2 (384-dim, English-only) with bge-m3 (1024-dim, multilingual, Q4 quantized)
支持中英文跨语言语义搜索，且无需 GPU，本地 CPU 即可运行 | Enables cross-lingual Chinese-English semantic search, runs on CPU without GPU
配置了 HuggingFace 镜像端点，适配国内网络环境 | Configured HuggingFace mirror endpoint for China network conditions

### 2. CJK 中文分词 | CJK Bigram Tokenization
在 BM25 全文索引中增加 CJK 二字组（Bigram）分词 | Added CJK bigram tokenization to BM25 full-text index
覆盖 CJK 统一表意文字区间（U+4E00-U+9FFF, U+3400-U+4DBF, U+F900-U+FAFF） | Covers CJK Unified Ideographs ranges (U+4E00-U+9FFF, U+3400-U+4DBF, U+F900-U+FAFF)
中文搜索不再漏检，"人工智能"可以命中"人工"和"智能" | Chinese search no longer misses results; "人工智能" can match "人工" and "智能"

### 3. 向量索引集成 | Vector Index Integration
将 bge-m3 向量索引集成到观察（observe）、合成（synthetic）、停止（stop）三个关键生命周期 | Integrated bge-m3 vector index into three critical lifecycles: observe, synthetic, and stop
每个记忆录入时自动生成 1024 维语义向量，无需手动调用 | Auto-generates 1024-dim semantic vectors on every memory ingestion, no manual invocation needed

### 4. 智能搜索格式增强 | Smart-Search Format Enhancement
为 mem::smart-search 添加 format 参数（full / narrative / compact） | Added format parameter to mem::smart-search (full / narrative / compact)
与上游 mem::search 的格式体系对齐，支持按需返回不同详细程度的搜索结果 | Aligns with upstream mem::search format system, supports returning results at different detail levels on demand

### 5. 稳定性加固 | Stability Hardening
多处 trigger 调用包裹 try-catch，防止单个 observer 失败导致整个管道崩溃 | Wrapped multiple trigger calls in try-catch to prevent single observer failure from crashing entire pipeline
内存阈值上调至 98%（原 95%），内存底线提升至 1.5GB（原 512MB），减少误报 | Raised memory critical threshold to 98% (was 95%), RSS floor to 1.5GB (was 512MB), reducing false alarms
添加 10 秒优雅关闭超时，防止进程僵死 | Added 10-second graceful shutdown timeout to prevent zombie processes

### 6. iii-sdk 兼容 | iii-sdk Compatibility
注册 stream::* 桩函数（set/send/get/delete/list/list_groups），满足 iii-sdk 依赖 | Registered stream::* stub functions (set/send/get/delete/list/list_groups) to satisfy iii-sdk dependency

---

## 补丁清单 | Patch Inventory

| # | 补丁 | Patch | 类型 | Type |
|---|------|-------|------|------|
| 1 | bge-m3 嵌入模型 + HF 镜像 | bge-m3 embedding + HF mirror | 模型 | Model |
| 2 | CJK Bigram 中文分词 | CJK Bigram tokenizer | 搜索 | Search |
| 3 | 向量索引集成 (observe) | Vector index integration (observe) | 架构 | Architecture |
| 4 | 向量索引集成 (synthetic) | Vector index integration (synthetic) | 架构 | Architecture |
| 5 | 向量索引集成 (stop) | Vector index integration (stop) | 架构 | Architecture |
| 6 | trigger try-catch (4处) | trigger try-catch (4 sites) | 防御 | Defense |
| 7 | 内存阈值上调 | Memory threshold raised | 本地 | Local |
| 8 | 10s shutdown timeout | 10s shutdown timeout | 本地 | Local |
| 9 | stream::* 桩函数 | stream::* stubs | 兼容 | Compat |
| 10 | Smart-search format 参数 | Smart-search format parameter | 功能 | Feature |
| 11 | 向量索引全局暴露 | Vector index globals | 架构 | Architecture |
| 12 | 嵌入模型本地路径 | Embedding model local path | 部署 | Deploy |
| 13 | 健康检查阈值调整 | Health check threshold adjustment | 本地 | Local |

---

## 安装 | Installation

```bash
# 克隆本仓库 | Clone this repo
git clone https://github.com/mechanic-Q/agentmemory-cn.git ~/.agentmemory

# 安装依赖 | Install dependencies
cd ~/.agentmemory && npm install

# 启动服务 | Start the service
node dist/cli.mjs start

# 或使用 systemd 管理 | Or use systemd
systemctl --user enable --now agentmemory.service
systemctl --user enable --now iii-engine.service
```

## 上游同步 | Upstream Sync

本仓库是编译产物仓库（非 TS 源码），与上游 rohitg00/agentmemory 的 TS 源码 Fork 分离维护。 | This is a compiled artifact repo (not TS source), maintained separately from the TS source fork of rohitg00/agentmemory.
上游更新时需手动对比新版 dist/index.mjs 并重新应用补丁。 | When upstream updates, manually diff the new dist/index.mjs and re-apply patches.
通用改进（如 smart-search format 参数）通过 PR 回馈上游，以减少未来维护负担。 | Generic improvements (e.g. smart-search format parameter) are contributed back via PR to reduce future maintenance burden.

## 被上游覆盖后如何恢复 | Recovery After Upstream Overwrite

### 场景 | Scenario

你的 `~/.agentmemory/` 是 npm 全局安装目录，以下操作会**整体覆盖**已打补丁的文件： | Your `~/.agentmemory/` is a global npm install directory. These actions will **overwrite** patched files:

```bash
npx @agentmemory/agentmemory@latest     # 拉取最新 npm 包 | Pull latest npm package
npm update -g @agentmemory/agentmemory   # 全局更新 | Global update
# 某些自动化脚本可能触发重装 | Some automation scripts may trigger reinstall
```

覆盖后，`dist/index.mjs` 退回到上游原始版本（无 CJK 分词、无 bge-m3、无 smart-search format）。 | After overwrite, `dist/index.mjs` reverts to upstream original (no CJK bigram, no bge-m3, no smart-search format).

### 检测 | Detection

```bash
# 快速检测：看 smart-search 是否还有 format 参数 | Quick check: does smart-search still have format parameter?
grep 'typeof data.format' ~/.agentmemory/dist/index.mjs

# 有输出 = 补丁还在 | Has output = patches intact
# 无输出 = 已被覆盖 | No output = overwritten

# 或者检查嵌入模型 | Or check embedding model
grep 'bge-m3' ~/.agentmemory/dist/index.mjs

# 有输出 = 补丁还在 | Has output = patches intact
# 无输出 = 已被覆盖 | No output = overwritten
```

### 恢复方法一：从本仓库直接还原 | Recovery Method 1: Direct Restore from This Repo

适合：没有在本地额外修改 `~/.agentmemory/` 的情况 | For: when you haven't made additional local changes to `~/.agentmemory/`

```bash
# 拉取本仓库最新版 | Pull latest from this repo
cd ~/.agentmemory
git fetch origin main
git checkout origin/main -- dist/index.mjs dist/image-refs-BfT7XAa-.mjs dist/image-store-Cn9eD-7D.mjs

# 重启服务使改动生效 | Restart services to apply
systemctl --user restart agentmemory.service
systemctl --user restart iii-engine.service

# 验证 | Verify
grep 'bge-m3' ~/.agentmemory/dist/index.mjs && echo "OK: 补丁已恢复 | OK: patches restored"
```

### 恢复方法二：精确恢复（保留本机配置） | Recovery Method 2: Precision Restore (Preserve Local Config)

适合：`~/.agentmemory/` 里除了补丁文件，还有你的本机配置（iii-config.yaml、.env 等） | For: when `~/.agentmemory/` also has your local config (iii-config.yaml, .env, etc.)

```bash
cd ~/.agentmemory

# 1. 先把当前状态存个快照，防止误操作 | Snapshot current state first
git stash

# 2. 从本仓库拉取最新补丁版 | Pull latest patched version from this repo
git fetch origin main

# 3. 只还原被打补丁的核心文件，不碰你的本机配置 | Only restore patched core files, leave config alone
git checkout origin/main -- dist/index.mjs
git checkout origin/main -- dist/image-refs-BfT7XAa-.mjs
git checkout origin/main -- dist/image-store-Cn9eD-7D.mjs

# 4. 如果你在本机也改过 index.mjs，现在合并 | If you also patched index.mjs locally, merge now
git stash pop

# 5. 如果 stash pop 有冲突，手动解决后继续 | If stash pop has conflicts, resolve manually then proceed
# vim dist/index.mjs   # 解决冲突 | resolve conflicts
# git add dist/index.mjs

# 6. 重启 | Restart
systemctl --user restart agentmemory.service
systemctl --user restart iii-engine.service
```

### 恢复后验证 | Post-Recovery Verification

```bash
# 运行五项核心检查 | Run five core checks
echo "=== 1. 嵌入模型 | Embedding model ===" && grep 'bge-m3' ~/.agentmemory/dist/index.mjs | head -1
echo "=== 2. CJK 分词 | CJK tokenizer ===" && grep '\\u4e00-\\u9fff' ~/.agentmemory/dist/index.mjs | head -1
echo "=== 3. smart-search format | Smart-search format ===" && grep 'typeof data.format' ~/.agentmemory/dist/index.mjs | head -1
echo "=== 4. 向量索引 | Vector index ===" && grep 'getVectorIndex' ~/.agentmemory/dist/index.mjs | head -1
echo "=== 5. 服务状态 | Service status ===" && systemctl --user is-active agentmemory.service iii-engine.service

# 预期：5 项全部有输出且服务 active | Expected: all 5 show output and services are active
```

### 预防措施 | Prevention

```bash
# 锁定 agentmemory 版本，防止意外升级 | Pin agentmemory version to prevent accidental upgrade
npm config set save-exact true

# 如果使用 systemd，确保 service 文件的 ExecStart 指向本仓库的 node 而不是 npx | If using systemd, ensure service ExecStart points to this repo's node, not npx
# ✅ ExecStart=node /home/lmr/.agentmemory/dist/cli.mjs start
# ❌ ExecStart=npx @agentmemory/agentmemory      ← 每次启动都可能拉新版本

# 日常更新流程（安全） | Safe daily update flow
# 1. 先 git pull 本仓库看有没有新版补丁 | First git pull this repo for new patches
# 2. 再决定要不要同步上游新版 | Then decide whether to sync upstream
```

---

## 许可证 | License

Apache-2.0 © 原始项目 rohitg00/agentmemory | Apache-2.0 © original rohitg00/agentmemory
本仓库为衍生作品，保留原始版权声明 | This repo is a derivative work, original copyright retained
