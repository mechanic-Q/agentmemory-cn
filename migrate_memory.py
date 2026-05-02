#!/usr/bin/env python3
"""
mem0 → agentmemory 迁移脚本
把 MEMORY.md / USER.md 内容迁移进 agentmemory REST API
"""
import urllib.request, urllib.error, json, os
from datetime import datetime

BASE = 'http://localhost:3111/agentmemory'
AGENTMEMORY_DIR = os.path.expanduser('~/.agentmemory')

def api(path, payload=None, method=None):
    url = BASE + path
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data,
        headers={'Content-Type': 'application/json'})
    if method:
        req.get_method = lambda: method
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'body': e.read().decode()[:500]}
    except Exception as e:
        return {'error': str(e)}

def start_session():
    result = api('/session/start', {
        'session_id': f'migration-{datetime.now().strftime("%Y%m%d-%H%M%S")}',
        'metadata': {'source': 'mem0-migration', 'timestamp': datetime.now().isoformat()}
    })
    return result

def remember(content, metadata=None):
    payload = {
        'content': content,
        'metadata': metadata or {}
    }
    return api('/remember', payload)

def observe(content, session_id):
    payload = {
        'content': content,
        'session_id': session_id,
    }
    return api('/observe', payload)

# ============ 迁移内容 ============

memory_entries = [
    {
        "type": "fact",
        "content": "日报PNG截图：chromium固定viewport(5000)→输出10000px带大量空白；Playwright `fullPage: true`可精确生成HTML内容尺寸PNG(1080×1201)，零空白。用户明确要求\"按HTML原生尺寸截图，不做任何改动\"。"
    },
    {
        "type": "fact",
        "content": "环境：Linux Mint，网络限速（flatpak~135KB/s，GitHub超时）。包管理用 uv，PyPI镜像 UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/。优先AppImage/Snap/deb。"
    },
    {
        "type": "fact",
        "content": "r.jina.ai 不可用（IP层100%丢包）。替代抓取：✅ Crawl4AI（crawl4ai-skill pip已装）、✅ Playwright+Chromium 147、✅ urllib。camoufox未装（config有但无binary）。MiniMax TTS不支持(2061)，免费替代 edge-tts。"
    },
    {
        "type": "fact",
        "content": "用户偏好免费方案（不接受付费API）。r.jina.ai 已从本网络不可达（128.242.240.218 100%丢包，2025-04测试），替代方案用本地 Chromium 147 + Playwright 渲染抓取。用户直接给出中文新闻源URL即可触发抓取+生成报纸流程。"
    },
    {
        "type": "fact",
        "content": "每日新中国采集铁律：子任务不能生成新闻内容——会构造假URL和假正文；所有链接必须逐个验证HTTP 200；内容必须与实际页面一致。JSON生成铁律：必须用 columns（非 sections）触发双排布局；issue留空让脚本自动计算（基准日2026-04-19）。"
    },
    {
        "type": "fact",
        "content": "MiniMax Token Plan MCP（minimax-coding-plan-mcp）已安装到 ~/.hermes/config.yaml，包含 web_search 和 understand_image。搜索端点 /v1/coding_plan/search，API Key 格式 sk-cp-，HOST 国内 https://api.minimaxi.com。配置后需 /reload-mcp 生效。"
    },
    {
        "type": "fact",
        "content": "newspaper-brief：Playwright full_page截图(不裁剪)→CSS备份.bak20260423→JSON用columns双栏；1新闻_链接.md全文不截断"
    },
    {
        "type": "fact",
        "content": "信息源：新华社urllib 央视browser 社科院/中科院urllib 人民日报browser 参考消息browser(SPA) 中核集团chromium--virtual-time-budget=15000(绕WAF)。fetch_sources.py支持cnnc_links。"
    },
    {
        "type": "fact",
        "content": "render_newspaper.py CSS 备份在 .bak20260423。当前CSS被压缩（li font-size 25px/lh2.1/黑点left:32），备份正常（24px/lh1.73/left:4）。JSON必须含paper_name/tagline/中文date/summary/footer_note/columns/issue空。"
    },
    {
        "type": "fact",
        "content": "日报项目文件管理：输出统一在 ~/Desktop/每日新中国/YYYY-MM-DD/，共享py存技能目录，任务专属文件进工作目录。执行前先date确认日期陷阱。"
    },
    {
        "type": "fact",
        "content": "SkillClaw: `skillclaw start --daemon`启动，MiniMax M2.5后端。已修：max_context_tokens→204800，max_tokens→8092。注意api_key截断bug、M2.7-250428→M2.7。"
    },
    {
        "type": "fact",
        "content": "DeepSeek 关闭思维链：只在 custom_providers 中配 `thinking: {type: disabled}`，绝不设全局 `agent.reasoning_effort: none`。前者通过 _get_custom_provider_extra_body() 的 base_url 精确匹配只对 api.deepseek.com 生效；后者关闭所有模型思维链。已清空 reasoning_effort 为 ''。追踪报告：~/Desktop/hermes-deepseek-thinking-trace.md"
    },
    {
        "type": "fact",
        "content": "用户做《每日新中国》新闻报纸项目（手机壁纸版，1080×2340px），用 newspaper-brief skill 生成。要求全部内容100%真实新闻，拒绝模拟内容。偏好免费方案，直接说、不绕弯，迭代式调整（喜欢频繁看渲染效果再逐步改）。"
    },
    {
        "type": "fact",
        "content": "用户偏好 technical 人格风格（~/.hermes/config.yaml agent.personality: technical），未设置 AGENT.md soul 文件。已安装 agency-agents-zh（211个智能体，22个分类）到 ~/.hermes/skills/。"
    },
    {
        "type": "fact",
        "content": "PNG截图铁律：禁止对截图做任何PIL缩放/裁剪/后处理。chromium截图用 --window-size=1080,2500（不能用scrollHeight精确值，browser量的是1280px宽的高度，chromium在1080px宽会更高，会截掉footer）。直接输出不做任何处理。"
    },
    {
        "type": "fact",
        "content": "《每日新中国》日报项目操作规范：不用子代理执行任务（用户明确要求）；browser_snapshot对长页面有截断需用browser_console提取；正文必须是完整内容；browser_console JS提取完整正文方法：const ps = document.querySelectorAll('p')过滤版权声明。"
    },
]

user_entries = [
    {
        "type": "preference",
        "content": "Terminal: Alacritty (PID 2247), display :0.0, decorations was 'None' (no title bar), changed to 'Full'"
    },
    {
        "type": "preference",
        "content": "用户做\"每日新中国\"新闻报纸项目（手机壁纸版），用 newspaper-brief skill 生成。偏好免费方案，直接说、不绕弯，迭代式调整（喜欢频繁看渲染效果再逐步改）。"
    },
    {
        "type": "preference",
        "content": "用户说\"什么都不要改动，只是按现在的HTML尺寸截图\"→直接截不调CSS。用户明确说\"删掉对截图的尺寸要求\"→不要在 skill 里写任何固定尺寸约束。"
    },
    {
        "type": "preference",
        "content": "用户说\"还原上一版\"→立即mv回退，不做任何改动。"
    },
]

# ============ 执行迁移 ============

print("=== 开始迁移 ===")
print(f"时间: {datetime.now().isoformat()}")
print(f"API: {BASE}")

# Health check
health = api('/health')
print(f"Health: {health.get('status', health)}")

# Start migration session
session = start_session()
session_id = session.get('session_id') or session.get('id', 'unknown')
print(f"Session: {session_id}")

# Migrate memory entries
print(f"\n--- 迁移 MEMORY ({len(memory_entries)} 条) ---")
for i, entry in enumerate(memory_entries):
    result = remember(
        content=entry['content'],
        metadata={
            'type': entry['type'],
            'source': 'MEMORY.md-migration',
            'migration_date': datetime.now().isoformat(),
            'index': i
        }
    )
    if 'error' in result:
        print(f"  [{i}] ERROR: {result['error']}")
    else:
        print(f"  [{i}] OK: {entry['content'][:60]}...")

# Migrate user entries
print(f"\n--- 迁移 USER_PROFILE ({len(user_entries)} 条) ---")
for i, entry in enumerate(user_entries):
    result = remember(
        content=entry['content'],
        metadata={
            'type': entry['type'],
            'source': 'USER.md-migration',
            'migration_date': datetime.now().isoformat(),
            'index': i
        }
    )
    if 'error' in result:
        print(f"  [{i}] ERROR: {result['error']}")
    else:
        print(f"  [{i}] OK: {entry['content'][:60]}...")

# End session
api('/session/end', {'session_id': session_id})

print(f"\n=== 迁移完成 ===")
print(f"共迁移: {len(memory_entries)} 条 MEMORY + {len(user_entries)} 条 USER_PROFILE")

# Verify
result = api('/search', {'query': '日报项目', 'limit': 3})
print(f"\n验证搜索 '日报项目': {len(result.get('results', []))} 条结果")
