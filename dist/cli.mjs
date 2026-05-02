#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import * as p from "@clack/prompts";
import { createHash } from "node:crypto";

//#region src/state/schema.ts
const KV = {
	sessions: "mem:sessions",
	observations: (sessionId) => `mem:obs:${sessionId}`,
	memories: "mem:memories",
	summaries: "mem:summaries",
	config: "mem:config",
	metrics: "mem:metrics",
	health: "mem:health",
	embeddings: (obsId) => `mem:emb:${obsId}`,
	bm25Index: "mem:index:bm25",
	relations: "mem:relations",
	profiles: "mem:profiles",
	claudeBridge: "mem:claude-bridge",
	graphNodes: "mem:graph:nodes",
	graphEdges: "mem:graph:edges",
	semantic: "mem:semantic",
	procedural: "mem:procedural",
	teamShared: (teamId) => `mem:team:${teamId}:shared`,
	teamUsers: (teamId, userId) => `mem:team:${teamId}:users:${userId}`,
	teamProfile: (teamId) => `mem:team:${teamId}:profile`,
	audit: "mem:audit",
	actions: "mem:actions",
	actionEdges: "mem:action-edges",
	leases: "mem:leases",
	routines: "mem:routines",
	routineRuns: "mem:routine-runs",
	signals: "mem:signals",
	checkpoints: "mem:checkpoints",
	mesh: "mem:mesh",
	sketches: "mem:sketches",
	facets: "mem:facets",
	sentinels: "mem:sentinels",
	crystals: "mem:crystals",
	lessons: "mem:lessons",
	insights: "mem:insights",
	graphEdgeHistory: "mem:graph:edge-history",
	enrichedChunks: (sessionId) => `mem:enriched:${sessionId}`,
	latentEmbeddings: (obsId) => `mem:latent:${obsId}`,
	retentionScores: "mem:retention",
	accessLog: "mem:access",
	imageRefs: "mem:image-refs",
	imageEmbeddings: "mem:image-embeddings",
	slots: "mem:slots",
	globalSlots: "mem:slots:global",
	state: "mem:state"
};
const STREAM = {
	name: "mem-live",
	group: (sessionId) => sessionId,
	viewerGroup: "viewer"
};
function generateId(prefix) {
	return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
function fingerprintId(prefix, content) {
	return `${prefix}_${createHash("sha256").update(content).digest("hex").slice(0, 16)}`;
}
function jaccardSimilarity(a, b) {
	const setA = new Set(a.split(/\s+/).filter((t) => t.length > 2));
	const setB = new Set(b.split(/\s+/).filter((t) => t.length > 2));
	if (setA.size === 0 && setB.size === 0) return 1;
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const word of setA) if (setB.has(word)) intersection++;
	return intersection / (setA.size + setB.size - intersection);
}

//#endregion
//#region src/cli.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const IS_WINDOWS = platform() === "win32";
const IS_VERBOSE = args.includes("--verbose") || args.includes("-v");
function vlog(msg) {
	if (IS_VERBOSE) p.log.info(`[verbose] ${msg}`);
}
if (args.includes("--help") || args.includes("-h")) {
	console.log(`
agentmemory — persistent memory for AI coding agents

Usage: agentmemory [command] [options]

Commands:
  (default)          Start agentmemory worker
  status             Show connection status, memory count, flags, and health
  doctor             Run diagnostic checks (server, flags, graph, providers)
  demo               Seed sample sessions and show recall in action
  upgrade            Upgrade local deps + iii runtime (best effort)
  mcp                Start standalone MCP server (no engine required)
  import-jsonl [p]   Import Claude Code JSONL transcripts (default: ~/.claude/projects)
                     --max-files <N> | --max-files=<N>: override scan cap (default 200, max 1000;
                     out-of-range is rejected; for trees >1000 files, batch by subdirectory)

Options:
  --help, -h         Show this help
  --verbose, -v      Show engine stderr and diagnostic info on startup
  --tools all|core   Tool visibility (default: core = 7 tools)
  --no-engine        Skip auto-starting iii-engine
  --port <N>         Override REST port (default: 3111)

Environment:
  AGENTMEMORY_URL    Full REST base URL (e.g. http://localhost:3111).
                     Honored by status, doctor, and MCP shim commands.

Quick start:
  npx @agentmemory/agentmemory          # start with local iii-engine or Docker
  npx @agentmemory/agentmemory demo     # see semantic recall in 30 seconds
  npx @agentmemory/agentmemory doctor   # diagnose config + feature flags
  npx @agentmemory/agentmemory status   # health + memory count + flags
  npx @agentmemory/agentmemory upgrade  # upgrade agentmemory + iii runtime
  npx @agentmemory/agentmemory mcp      # standalone MCP server (no engine)
  npx @agentmemory/mcp                  # same as above (shim package)
`);
	process.exit(0);
}
const toolsIdx = args.indexOf("--tools");
if (toolsIdx !== -1 && args[toolsIdx + 1]) process.env["AGENTMEMORY_TOOLS"] = args[toolsIdx + 1];
const portIdx = args.indexOf("--port");
if (portIdx !== -1 && args[portIdx + 1]) process.env["III_REST_PORT"] = args[portIdx + 1];
const skipEngine = args.includes("--no-engine");
function getRestPort() {
	const url = process.env["AGENTMEMORY_URL"];
	if (url) try {
		const parsed = new URL(url).port;
		if (parsed) return parseInt(parsed, 10);
	} catch {}
	return parseInt(process.env["III_REST_PORT"] || "3111", 10) || 3111;
}
function getBaseUrl() {
	const url = process.env["AGENTMEMORY_URL"];
	if (url) return url.replace(/\/+$/, "");
	return `http://localhost:${getRestPort()}`;
}
function getViewerUrl() {
	const envUrl = process.env["AGENTMEMORY_VIEWER_URL"];
	if (envUrl) return envUrl.replace(/\/+$/, "");
	try {
		const u = new URL(getBaseUrl());
		const vPort = (parseInt(u.port || "3111", 10) || 3111) + 2;
		return `${u.protocol}//${u.hostname}:${vPort}`;
	} catch {
		return `http://localhost:${getRestPort() + 2}`;
	}
}
async function isEngineRunning() {
	try {
		await fetch(`${getBaseUrl()}/`, { signal: AbortSignal.timeout(2e3) });
		return true;
	} catch {
		return false;
	}
}
async function isAgentmemoryReady() {
	try {
		return (await fetch(`${getBaseUrl()}/agentmemory/livez`, { signal: AbortSignal.timeout(2e3) })).ok;
	} catch {
		return false;
	}
}
function findIiiConfig() {
	const candidates = [
		join(__dirname, "iii-config.yaml"),
		join(__dirname, "..", "iii-config.yaml"),
		join(process.cwd(), "iii-config.yaml")
	];
	for (const c of candidates) if (existsSync(c)) return c;
	return "";
}
function whichBinary(name) {
	const cmd = IS_WINDOWS ? "where" : "which";
	try {
		return execFileSync(cmd, [name], { encoding: "utf-8" }).split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? null;
	} catch {
		return null;
	}
}
function fallbackIiiPaths() {
	if (IS_WINDOWS) {
		const userProfile = process.env["USERPROFILE"];
		if (!userProfile) return [];
		return [join(userProfile, ".local", "bin", "iii.exe"), join(userProfile, "bin", "iii.exe")];
	}
	const home = process.env["HOME"];
	if (!home) return ["/usr/local/bin/iii"];
	return [join(home, ".local", "bin", "iii"), "/usr/local/bin/iii"];
}
let startupFailure = null;
function spawnEngineBackground(bin, spawnArgs, label) {
	vlog(`spawn: ${bin} ${spawnArgs.join(" ")}`);
	const child = spawn(bin, spawnArgs, {
		detached: true,
		stdio: [
			"ignore",
			"ignore",
			"pipe"
		],
		windowsHide: true
	});
	const stderrChunks = [];
	let stderrBytes = 0;
	const MAX_STDERR_CAPTURE = 16 * 1024;
	child.stderr?.on("data", (chunk) => {
		if (stderrBytes >= MAX_STDERR_CAPTURE) return;
		const slice = chunk.subarray(0, MAX_STDERR_CAPTURE - stderrBytes);
		stderrChunks.push(slice);
		stderrBytes += slice.length;
	});
	child.on("exit", (code, signal) => {
		if (code !== null && code !== 0 || code === null && signal !== null) {
			const stderr = Buffer.concat(stderrChunks).toString("utf-8");
			startupFailure = {
				kind: label.includes("Docker") ? "docker-crashed" : "engine-crashed",
				stderr: stderr.trim() || (signal ? `process killed by signal ${signal}` : `process exited with code ${code}`),
				binary: bin
			};
			vlog(`engine exited early: code=${code} signal=${signal}`);
			if (IS_VERBOSE && stderr.trim()) p.log.error(`engine stderr:\n${stderr}`);
		}
	});
	child.unref();
	return child;
}
async function startEngine() {
	const configPath = findIiiConfig();
	let iiiBin = whichBinary("iii");
	vlog(`iii binary: ${iiiBin ?? "(not on PATH)"}, config: ${configPath || "(not found)"}`);
	if (iiiBin && configPath) {
		const s = p.spinner();
		s.start(`Starting iii-engine: ${iiiBin}`);
		spawnEngineBackground(iiiBin, ["--config", configPath], "iii-engine");
		s.stop("iii-engine process started");
		return true;
	}
	const dockerBin = whichBinary("docker");
	vlog(`docker binary: ${dockerBin ?? "(not on PATH)"}`);
	const composeFile = [
		join(__dirname, "..", "docker-compose.yml"),
		join(__dirname, "docker-compose.yml"),
		join(process.cwd(), "docker-compose.yml")
	].find((c) => existsSync(c));
	vlog(`docker-compose.yml: ${composeFile ?? "(not found)"}`);
	if (dockerBin && composeFile) {
		const s = p.spinner();
		s.start("Starting iii-engine via Docker...");
		spawnEngineBackground(dockerBin, [
			"compose",
			"-f",
			composeFile,
			"up",
			"-d"
		], "iii-engine via Docker");
		s.stop("Docker compose started");
		return true;
	}
	for (const iiiPath of fallbackIiiPaths()) if (existsSync(iiiPath)) {
		p.log.info(`Found iii at: ${iiiPath}`);
		process.env["PATH"] = `${dirname(iiiPath)}${delimiter}${process.env["PATH"] ?? ""}`;
		iiiBin = iiiPath;
		break;
	}
	if (iiiBin && configPath) {
		const s = p.spinner();
		s.start(`Starting iii-engine: ${iiiBin}`);
		spawnEngineBackground(iiiBin, ["--config", configPath], "iii-engine");
		s.stop("iii-engine process started");
		return true;
	}
	if (!iiiBin && (!dockerBin || !composeFile)) startupFailure = { kind: "no-engine" };
	else if (!composeFile && dockerBin) startupFailure = { kind: "no-docker-compose" };
	return false;
}
async function waitForEngine(timeoutMs) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await isEngineRunning()) return true;
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}
function installInstructions() {
	if (IS_WINDOWS) return [
		"agentmemory requires the `iii-engine` runtime. Pick one:",
		"",
		"  A) Download the prebuilt Windows binary:",
		"     1. Open https://github.com/iii-hq/iii/releases/latest",
		"     2. Download iii-x86_64-pc-windows-msvc.zip",
		"        (or iii-aarch64-pc-windows-msvc.zip on ARM)",
		"     3. Extract iii.exe and either add its folder to PATH",
		"        or move it to %USERPROFILE%\\.local\\bin\\iii.exe",
		"     4. Re-run: npx @agentmemory/agentmemory",
		"",
		"  B) Docker Desktop:",
		"     1. Install Docker Desktop for Windows",
		"     2. Start Docker Desktop (engine must be running)",
		"     3. Re-run: npx @agentmemory/agentmemory",
		"",
		"Or skip the engine entirely for standalone MCP:",
		"  npx @agentmemory/agentmemory mcp"
	];
	return [
		"agentmemory requires the `iii-engine` runtime. Pick one:",
		"",
		"  A) curl -fsSL https://install.iii.dev/iii/main/install.sh | sh",
		"     (installs the prebuilt iii binary into ~/.local/bin/iii)",
		"",
		"  B) Docker: install Docker Desktop or docker-ce, then re-run",
		"",
		"Or skip the engine entirely for standalone MCP:",
		"  npx @agentmemory/agentmemory mcp",
		"",
		"Docs: https://iii.dev/docs"
	];
}
function portInUseDiagnostic(port) {
	return IS_WINDOWS ? `  netstat -ano | findstr :${port}` : `  lsof -i :${port}   # or: ss -tlnp | grep :${port}`;
}
async function main() {
	p.intro("agentmemory");
	if (skipEngine) {
		p.log.info("Skipping engine check (--no-engine)");
		await import("./src-uDy2jLO-.mjs");
		return;
	}
	if (await isEngineRunning()) {
		p.log.success("iii-engine is running");
		await import("./src-uDy2jLO-.mjs");
		return;
	}
	if (!await startEngine()) {
		p.log.error("Could not start iii-engine.");
		const lines = installInstructions();
		if (startupFailure?.kind === "no-docker-compose") lines.unshift("Docker is installed but docker-compose.yml is missing from this", "install. Re-install with: npm install -g @agentmemory/agentmemory", "");
		p.note(lines.join("\n"), "Setup required");
		process.exit(1);
	}
	const s = p.spinner();
	s.start("Waiting for iii-engine to be ready...");
	if (!await waitForEngine(15e3)) {
		const port = getRestPort();
		s.stop("iii-engine did not become ready within 15s");
		if (startupFailure?.kind === "engine-crashed" || startupFailure?.kind === "docker-crashed") {
			p.log.error("The iii-engine process crashed on startup.");
			if (startupFailure.binary) p.log.info(`Binary: ${startupFailure.binary}`);
			if (startupFailure.stderr) p.note(startupFailure.stderr, "engine stderr");
			else p.log.info("No stderr was captured. Re-run with --verbose for more detail.");
			p.note([
				"Common causes:",
				"  - iii-engine version mismatch — reinstall the latest binary",
				"    (sh script on macOS/Linux, GitHub release zip on Windows)",
				"  - Docker Desktop not running (if you're using the Docker path)",
				"  - Port already in use (see below)",
				"",
				"See https://iii.dev/docs for current install instructions."
			].join("\n"), "Troubleshooting");
		} else {
			p.log.error("The engine process started but the REST API never responded.");
			p.note([
				`Check whether port ${port} is already bound by another process:`,
				portInUseDiagnostic(port),
				"",
				"If it is, free the port or override: agentmemory --port <N>",
				"",
				"If it isn't, a firewall may be blocking 127.0.0.1:" + port + ".",
				"Re-run with --verbose to see engine stderr."
			].join("\n"), "Troubleshooting");
		}
		process.exit(1);
	}
	s.stop("iii-engine is ready");
	await import("./src-uDy2jLO-.mjs");
}
async function apiFetch(base, path, timeoutMs = 5e3) {
	try {
		return await (await fetch(`${base}/agentmemory/${path}`, { signal: AbortSignal.timeout(timeoutMs) })).json();
	} catch {
		return null;
	}
}
async function runStatus() {
	getRestPort();
	const base = getBaseUrl();
	p.intro("agentmemory status");
	if (!await isEngineRunning()) {
		p.log.error(`Not running — no response at ${base}`);
		p.log.info("Start with: npx @agentmemory/agentmemory");
		process.exit(1);
	}
	try {
		const [healthRes, sessionsRes, graphRes, memoriesRes, flagsRes] = await Promise.all([
			apiFetch(base, "health"),
			apiFetch(base, "sessions"),
			apiFetch(base, "graph/stats"),
			apiFetch(base, "export"),
			apiFetch(base, "config/flags")
		]);
		const h = healthRes?.health;
		const status = healthRes?.status || "unknown";
		const version = healthRes?.version || "?";
		const sessions = Array.isArray(sessionsRes?.sessions) ? sessionsRes.sessions.length : 0;
		const nodes = Number(graphRes?.totalNodes ?? graphRes?.nodes ?? graphRes?.nodeCount ?? 0);
		const edges = Number(graphRes?.totalEdges ?? graphRes?.edges ?? graphRes?.edgeCount ?? 0);
		const cb = healthRes?.circuitBreaker?.state || "closed";
		const heapMB = h?.memory ? Math.round(h.memory.heapUsed / 1048576) : 0;
		const uptime = h?.uptimeSeconds ? Math.round(h.uptimeSeconds) : 0;
		const obsCount = memoriesRes?.observations?.length || 0;
		const memCount = memoriesRes?.memories?.length || 0;
		const estFullTokens = obsCount * 80;
		const estInjectedTokens = Math.min(obsCount, 50) * 38;
		const tokensSaved = estFullTokens - estInjectedTokens;
		const pctSaved = estFullTokens > 0 ? Math.round(tokensSaved / estFullTokens * 100) : 0;
		p.log.success(`Connected — v${version} at ${base}`);
		const lines = [
			`Health:       ${status === "healthy" ? "✓ healthy" : status}`,
			`Sessions:     ${sessions}`,
			`Observations: ${obsCount}`,
			`Memories:     ${memCount}`,
			`Graph:        ${nodes} nodes, ${edges} edges`,
			`Circuit:      ${cb}`,
			`Heap:         ${heapMB} MB`,
			`Uptime:       ${uptime}s`,
			`Viewer:       ${getViewerUrl()}`
		];
		if (obsCount > 0) {
			lines.push("");
			lines.push(`Token savings: ~${tokensSaved.toLocaleString()} tokens saved (${pctSaved}% reduction)`);
			lines.push(`  Full context: ~${estFullTokens.toLocaleString()} tokens`);
			lines.push(`  Injected:     ~${estInjectedTokens.toLocaleString()} tokens`);
		}
		if (flagsRes) {
			const provider = flagsRes.provider === "llm" ? "✓ llm" : "✗ noop (no key)";
			const embed = flagsRes.embeddingProvider === "embeddings" ? "✓ embeddings" : "bm25-only";
			const flagRows = (flagsRes.flags || []).map((f) => `  ${f.enabled ? "✓" : "✗"} ${f.key.padEnd(32)} ${f.label}`);
			lines.push("");
			lines.push(`Provider:     ${provider}`);
			lines.push(`Embeddings:   ${embed}`);
			lines.push(`Flags:`);
			flagRows.forEach((r) => lines.push(r));
		}
		p.note(lines.join("\n"), "agentmemory");
	} catch (err) {
		p.log.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
function formatChecks(checks) {
	return checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${c.hint ? `\n   ${c.hint}` : ""}`).join("\n");
}
function findLatestDebugLog(debugDir) {
	const latestLink = join(debugDir, "latest");
	try {
		if (existsSync(latestLink)) {
			const target = readlinkSync(latestLink);
			const resolved = target.startsWith("/") ? target : join(debugDir, target);
			if (existsSync(resolved)) return resolved;
		}
	} catch {}
	try {
		const newest = readdirSync(debugDir).filter((f) => f.endsWith(".txt")).map((f) => ({
			f,
			m: statSync(join(debugDir, f)).mtimeMs
		})).sort((a, b) => b.m - a.m)[0];
		if (newest) return join(debugDir, newest.f);
	} catch {}
}
function checkClaudeCodeHooks() {
	const debugDir = join(homedir(), ".claude", "debug");
	if (!existsSync(debugDir)) return { state: "no-cc-dir" };
	const logPath = findLatestDebugLog(debugDir);
	if (!logPath) return { state: "no-debug-log" };
	let content;
	try {
		content = readFileSync(logPath, "utf8");
	} catch {
		return { state: "no-debug-log" };
	}
	const match = content.match(/Loaded hooks from standard location for plugin agentmemory:\s*(\S+)/);
	if (match) return {
		state: "loaded",
		manifestPath: match[1]
	};
	if (content.includes("Loading hooks from plugin: agentmemory")) return { state: "loaded" };
	return { state: "not-loaded" };
}
async function runDoctor() {
	p.intro("agentmemory doctor");
	const base = getBaseUrl();
	const viewerUrl = getViewerUrl();
	const checks = [];
	const serverUp = await isEngineRunning();
	checks.push({
		name: "Server reachable",
		ok: serverUp,
		hint: serverUp ? void 0 : `Start with: npx @agentmemory/agentmemory (tried ${base})`
	});
	if (!serverUp) {
		p.note(formatChecks(checks), "server unreachable");
		process.exit(1);
	}
	const [health, flags, graph] = await Promise.all([
		apiFetch(base, "health", 3e3),
		apiFetch(base, "config/flags", 3e3),
		apiFetch(base, "graph/stats", 3e3)
	]);
	const viewerUp = await fetch(viewerUrl, { signal: AbortSignal.timeout(2e3) }).then((r) => r.ok).catch(() => false);
	const hasLlm = flags?.provider === "llm";
	const hasEmbed = flags?.embeddingProvider === "embeddings";
	const graphHas = Number(graph?.totalNodes ?? graph?.nodes ?? graph?.nodeCount ?? 0) > 0;
	checks.push({
		name: "Health status",
		ok: health?.status === "healthy",
		hint: health?.status === "healthy" ? void 0 : `Status: ${health?.status || "unknown"}`
	}, {
		name: "Viewer reachable",
		ok: viewerUp,
		hint: viewerUp ? void 0 : `${viewerUrl} not responding`
	}, {
		name: "LLM provider",
		ok: hasLlm,
		hint: hasLlm ? void 0 : "export ANTHROPIC_API_KEY=sk-ant-... (or GEMINI/OPENROUTER/MINIMAX) then restart"
	}, {
		name: "Embedding provider",
		ok: hasEmbed,
		hint: hasEmbed ? void 0 : "Running BM25-only. Add OPENAI_API_KEY / VOYAGE_API_KEY / COHERE_API_KEY / OLLAMA_HOST for semantic recall"
	});
	for (const f of flags?.flags || []) checks.push({
		name: f.label,
		ok: f.enabled,
		hint: f.enabled ? void 0 : f.enableHow
	});
	const cc = checkClaudeCodeHooks();
	const ccCheck = (() => {
		switch (cc.state) {
			case "loaded": return {
				ok: true,
				hint: cc.manifestPath ? `manifest: ${cc.manifestPath}` : void 0
			};
			case "not-loaded": return {
				ok: false,
				hint: "Plugin enabled but hooks not loaded by Claude Code. Try: /plugin uninstall agentmemory@agentmemory && /plugin install agentmemory@agentmemory, then restart the session. CC must be >= 2.1.x for plugin-hook auto-load."
			};
			case "no-debug-log": return {
				ok: false,
				hint: "Cannot verify — no Claude Code debug log found. Run once with `claude --debug -p \"x\"`, then re-run doctor."
			};
			case "no-cc-dir": return;
		}
	})();
	if (ccCheck) checks.push({
		name: "Claude Code plugin hooks registered",
		...ccCheck
	});
	checks.push({
		name: "Knowledge graph populated",
		ok: graphHas,
		hint: graphHas ? void 0 : "Graph is empty. Run a session with GRAPH_EXTRACTION_ENABLED=true, or POST /agentmemory/graph/extract"
	});
	const passed = checks.filter((c) => c.ok).length;
	const total = checks.length;
	p.note(formatChecks(checks), `${passed}/${total} checks passing`);
	if (passed === total) p.outro("✓ All checks passed. agentmemory is healthy.");
	else {
		p.outro(`${total - passed} issue(s) — follow hints above to fix.`);
		process.exit(1);
	}
}
function buildDemoSessions() {
	return [
		{
			id: generateId("demo"),
			title: "Session 1: JWT auth setup",
			observations: [
				{
					toolName: "Write",
					toolInput: { file_path: "src/middleware/auth.ts" },
					toolOutput: "Created JWT middleware using jose library. Tokens expire after 30 days. Chose jose over jsonwebtoken for Edge compatibility."
				},
				{
					toolName: "Write",
					toolInput: { file_path: "test/auth.test.ts" },
					toolOutput: "Added token validation tests covering expired, malformed, and valid cases."
				},
				{
					toolName: "Bash",
					toolInput: { command: "npm test" },
					toolOutput: "All 12 auth tests passing."
				}
			]
		},
		{
			id: generateId("demo"),
			title: "Session 2: Database migration debugging",
			observations: [{
				toolName: "Read",
				toolInput: { file_path: "prisma/schema.prisma" },
				toolOutput: "Found N+1 query issue in user relations. Need to add include on posts query."
			}, {
				toolName: "Edit",
				toolInput: { file_path: "src/api/users.ts" },
				toolOutput: "Fixed N+1 by adding Prisma include. Query time dropped from 450ms to 28ms."
			}]
		},
		{
			id: generateId("demo"),
			title: "Session 3: Rate limiting",
			observations: [{
				toolName: "Write",
				toolInput: { file_path: "src/middleware/ratelimit.ts" },
				toolOutput: "Added rate limiting middleware with 100 req/min default. Uses in-memory store for dev, Redis for prod."
			}]
		}
	];
}
async function postJson(url, body, timeoutMs = 5e3) {
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!res.ok) return null;
		return await res.json().catch(() => null);
	} catch {
		return null;
	}
}
async function postJsonStrict(url, body, timeoutMs = 5e3) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) {
		const errBody = await res.text().catch(() => "");
		const suffix = errBody ? ` — ${errBody.slice(0, 200)}` : "";
		throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}${suffix}`);
	}
	return await res.json().catch(() => null);
}
async function seedDemoSession(base, project, session) {
	await postJsonStrict(`${base}/agentmemory/session/start`, {
		sessionId: session.id,
		project,
		cwd: project
	});
	let stored = 0;
	for (const obs of session.observations) {
		const url = `${base}/agentmemory/observe`;
		const payload = {
			hookType: "post_tool_use",
			sessionId: session.id,
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			data: {
				tool_name: obs.toolName,
				tool_input: obs.toolInput,
				tool_output: obs.toolOutput
			}
		};
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(5e3)
			});
			if (res.ok) stored++;
			else {
				const body = await res.text().catch(() => "");
				p.log.warn(`observe failed for ${obs.toolName}: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
			}
		} catch (err) {
			p.log.warn(`observe request failed for ${obs.toolName}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	await postJsonStrict(`${base}/agentmemory/session/end`, { sessionId: session.id });
	return stored;
}
async function runDemoSearch(base, query) {
	const items = (await postJson(`${base}/agentmemory/smart-search`, {
		query,
		limit: 5
	}, 1e4))?.results ?? [];
	return {
		query,
		hits: items.length,
		topTitle: items[0]?.title ?? "(no results)"
	};
}
async function runDemo() {
	const port = getRestPort();
	const base = `http://localhost:${port}`;
	p.intro("agentmemory demo");
	if (!await isAgentmemoryReady()) {
		p.log.error(`agentmemory worker not reachable on port ${port} (livez probe failed). Something may be on the port but it isn't serving /agentmemory/*.`);
		p.log.info("Start it with: npx @agentmemory/agentmemory");
		process.exit(1);
	}
	const demoProject = "/tmp/agentmemory-demo";
	const sessions = buildDemoSessions();
	const sSeed = p.spinner();
	sSeed.start("Seeding 3 demo sessions with realistic observations...");
	let totalObs = 0;
	for (const session of sessions) totalObs += await seedDemoSession(base, demoProject, session);
	sSeed.stop(`Seeded ${totalObs} observations across ${sessions.length} sessions`);
	const queries = [
		"jwt auth middleware",
		"database performance optimization",
		"rate limiting"
	];
	const sQuery = p.spinner();
	sQuery.start(`Running ${queries.length} smart-search queries...`);
	const results = [];
	for (const query of queries) results.push(await runDemoSearch(base, query));
	sQuery.stop("Search complete");
	const lines = [
		`Project:       ${demoProject}`,
		`Sessions:      ${sessions.length} seeded (${totalObs} observations)`,
		"",
		"Search results:",
		...results.flatMap((r) => [`  "${r.query}"`, `    → ${r.hits} hit(s), top: ${r.topTitle.slice(0, 60)}`]),
		"",
		`Notice: searching "database performance optimization"`,
		`found the N+1 query fix — keyword matching can't do that.`,
		"",
		`Viewer:        ${getViewerUrl()}`,
		`Clean up with: curl -X DELETE "${base}/agentmemory/sessions?project=${demoProject}"`
	];
	p.note(lines.join("\n"), "demo complete");
	p.log.success("agentmemory is working. Point your agent at it and get back to coding.");
}
function runCommand(command, commandArgs, options = { label: "command" }) {
	const spinner = p.spinner();
	spinner.start(options.label);
	const result = spawnSync(command, commandArgs, {
		cwd: options.cwd || process.cwd(),
		stdio: "pipe",
		encoding: "utf-8"
	});
	if (result.status === 0) {
		spinner.stop(`${options.label} ✓`);
		return true;
	}
	const stderr = (result.stderr || "").toString().trim();
	const stdout = (result.stdout || "").toString().trim();
	const msg = stderr || stdout || "unknown error";
	if (options.optional) {
		spinner.stop(`${options.label} (skipped)`);
		p.log.warn(msg.slice(0, 300));
		return false;
	}
	spinner.stop(`${options.label} ✗`);
	p.log.error(msg.slice(0, 300));
	return false;
}
async function runUpgrade() {
	p.intro("agentmemory upgrade");
	const cwd = process.cwd();
	const hasPackageJson = existsSync(join(cwd, "package.json"));
	const hasPnpmLock = existsSync(join(cwd, "pnpm-lock.yaml"));
	const pnpmBin = whichBinary("pnpm");
	const npmBin = whichBinary("npm");
	const dockerBin = whichBinary("docker");
	p.log.info(`Working directory: ${cwd}`);
	const requireSuccess = (ok, label) => {
		if (!ok) {
			p.log.error(`Upgrade aborted: ${label} failed.`);
			process.exit(1);
		}
	};
	if (hasPackageJson) if (!!pnpmBin && hasPnpmLock && pnpmBin) {
		requireSuccess(runCommand(pnpmBin, ["install"], { label: "Refreshing dependencies (pnpm install)" }), "pnpm install");
		runCommand(pnpmBin, ["up", "iii-sdk@latest"], {
			label: "Upgrading iii-sdk to latest",
			optional: true
		});
	} else if (npmBin) {
		requireSuccess(runCommand(npmBin, ["install"], { label: "Refreshing dependencies (npm install)" }), "npm install");
		runCommand(npmBin, ["install", "iii-sdk@latest"], {
			label: "Upgrading iii-sdk to latest",
			optional: true
		});
	} else p.log.warn("No package manager found (pnpm/npm). Skipping JS dependency upgrade.");
	else p.log.warn("No package.json in current directory. Skipping JS dependency upgrade.");
	const shBin = whichBinary("sh");
	const curlBin = whichBinary("curl");
	if (shBin && curlBin) {
		const upgradeEngine = await p.confirm({
			message: "Re-run the iii-engine install script (curl | sh)?",
			initialValue: true
		});
		if (p.isCancel(upgradeEngine)) {
			p.cancel("Cancelled.");
			return process.exit(0);
		}
		if (upgradeEngine === true) {
			if (!runCommand(shBin, ["-c", "curl -fsSL https://install.iii.dev/iii/main/install.sh | sh"], {
				label: "Upgrading iii-engine via installer",
				optional: true
			})) p.log.warn("iii-engine installer failed. Fallbacks: Docker (`docker pull iiidev/iii:latest`) or releases at https://github.com/iii-hq/iii/releases/latest.");
		} else p.log.info("Skipped iii-engine installer.");
	} else p.log.warn("curl or sh not found. Skipping iii-engine installer.");
	if (dockerBin) runCommand(dockerBin, ["pull", "iiidev/iii:latest"], {
		label: "Pulling latest iii Docker image",
		optional: true
	});
	else p.log.info("Docker not found. Skipping Docker image refresh.");
	p.note([
		"Upgrade flow completed.",
		"",
		"Recommended next steps:",
		"  1) agentmemory status",
		"  2) npm/pnpm test",
		"  3) restart agentmemory process"
	].join("\n"), "agentmemory upgrade");
}
async function runMcp() {
	await import("./standalone-CqqEcfNR.mjs");
}
async function runImportJsonl() {
	const VALUE_FLAGS = new Set(["--port", "--tools"]);
	let maxFiles;
	const tail = args.slice(1);
	const positional = [];
	for (let i = 0; i < tail.length; i++) {
		const a = tail[i];
		if (a === "--max-files") {
			const raw = tail[i + 1];
			const parsed = raw !== void 0 ? parseInt(raw, 10) : NaN;
			if (Number.isInteger(parsed) && parsed > 0) maxFiles = parsed;
			else if (raw !== void 0) p.log.warn(`Ignoring --max-files ${raw}: expected a positive integer.`);
			i++;
			continue;
		}
		if (a.startsWith("--max-files=")) {
			const raw = a.slice(12);
			const parsed = parseInt(raw, 10);
			if (Number.isInteger(parsed) && parsed > 0) maxFiles = parsed;
			else p.log.warn(`Ignoring --max-files=${raw}: expected a positive integer.`);
			continue;
		}
		if (VALUE_FLAGS.has(a)) {
			i++;
			continue;
		}
		if (a.startsWith("-")) continue;
		positional.push(a);
	}
	const pathArg = positional[0];
	const port = getRestPort();
	const base = `http://localhost:${port}`;
	let probeOk = false;
	let probeDetail = "";
	try {
		const probe = await fetch(`${base}/agentmemory/livez`, { signal: AbortSignal.timeout(2e3) });
		probeOk = probe.ok;
		if (!probeOk) {
			const probeBody = await probe.text().catch(() => "");
			probeDetail = `reachable but unhealthy (HTTP ${probe.status}${probeBody ? `: ${probeBody.slice(0, 200)}` : ""})`;
		}
	} catch (err) {
		probeOk = false;
		probeDetail = `unreachable (${err instanceof Error ? err.message : String(err)})`;
	}
	if (!probeOk) {
		p.log.error(`agentmemory livez probe failed on port ${port}: ${probeDetail}. Start it with \`npx @agentmemory/agentmemory\` in another terminal, then re-run this command.`);
		process.exit(1);
	}
	const body = {};
	if (pathArg) body["path"] = pathArg;
	if (maxFiles !== void 0) body["maxFiles"] = maxFiles;
	const headers = { "content-type": "application/json" };
	const secret = process.env["AGENTMEMORY_SECRET"];
	if (secret) headers["authorization"] = `Bearer ${secret}`;
	p.log.info(`Importing JSONL from ${pathArg || "~/.claude/projects"}…`);
	const spinner = p.spinner();
	spinner.start("scanning files");
	try {
		const res = await fetch(`${base}/agentmemory/replay/import-jsonl`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(12e4)
		});
		const text = await res.text();
		let json = {};
		if (text.length > 0) try {
			json = JSON.parse(text);
		} catch {
			spinner.stop("failed");
			p.log.error(`server returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
			process.exit(1);
		}
		if (!res.ok || json.success !== true) {
			spinner.stop("failed");
			const detail = json.error || (text.length === 0 ? "empty response body" : json.success === void 0 ? `HTTP ${res.status} (response missing success field)` : `HTTP ${res.status}`);
			if (res.status === 401) p.log.error(`${detail}. Set AGENTMEMORY_SECRET to match the server's secret and re-run.`);
			else if (res.status === 404) p.log.error(`${detail}. The running agentmemory server does not expose /agentmemory/replay/import-jsonl — upgrade to v0.8.13 or later.`);
			else p.log.error(detail);
			process.exit(1);
		}
		spinner.stop(`imported ${json.imported ?? 0} file(s), ${json.observations ?? 0} observation(s) across ${json.sessionIds?.length || 0} session(s)`);
		if (json.truncated) {
			const cap = json.maxFiles ?? 200;
			const upper = json.maxFilesUpperBound ?? 1e3;
			const discovered = json.discovered ?? 0;
			const baseMsg = `Hit the ${cap}-file scan cap; ${discovered - (json.imported ?? 0)} of ${json.traversalCapped ? `${discovered}+ (traversal halted at safety cap)` : String(discovered)} discovered file(s) were skipped.`;
			if (discovered > upper || json.traversalCapped) p.log.warn(`${baseMsg} Tree exceeds the server's --max-files limit of ${upper}; batch by subdirectory (run import-jsonl once per project under ~/.claude/projects).`);
			else {
				const suggested = Math.min(Math.max((discovered || cap) + 100, cap * 2), upper);
				p.log.warn(`${baseMsg} Re-run with --max-files=${suggested} (max ${upper}) or batch by subdirectory.`);
			}
		}
		if (json.sessionIds && json.sessionIds.length > 0) p.log.info(`View at ${getViewerUrl()} → Replay tab`);
	} catch (err) {
		spinner.stop("failed");
		if (err instanceof Error && err.name === "TimeoutError") p.log.error("import timed out after 2 minutes");
		else p.log.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
({
	status: runStatus,
	doctor: runDoctor,
	demo: runDemo,
	upgrade: runUpgrade,
	mcp: runMcp,
	"import-jsonl": runImportJsonl
}[args[0] ?? ""] ?? main)().catch((err) => {
	p.log.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});

//#endregion
export { jaccardSimilarity as a, generateId as i, STREAM as n, fingerprintId as r, KV as t };
//# sourceMappingURL=cli.mjs.map