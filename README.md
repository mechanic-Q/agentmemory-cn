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

## 许可证 | License

Apache-2.0 © 原始项目 rohitg00/agentmemory | Apache-2.0 © original rohitg00/agentmemory
本仓库为衍生作品，保留原始版权声明 | This repo is a derivative work, original copyright retained
