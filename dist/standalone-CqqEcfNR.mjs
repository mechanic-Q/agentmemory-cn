import { i as generateId } from "./cli.mjs";
import { c as getStandalonePersistPath, n as getVisibleTools, r as VERSION } from "./tools-registry-Co8VIL4t.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

//#region src/mcp/in-memory-kv.ts
var InMemoryKV = class {
	store = /* @__PURE__ */ new Map();
	constructor(persistPath) {
		this.persistPath = persistPath;
		if (persistPath && existsSync(persistPath)) try {
			const data = JSON.parse(readFileSync(persistPath, "utf-8"));
			for (const [scope, entries] of Object.entries(data)) {
				const map = /* @__PURE__ */ new Map();
				for (const [key, value] of Object.entries(entries)) map.set(key, value);
				this.store.set(scope, map);
			}
		} catch {}
	}
	async get(scope, key) {
		return this.store.get(scope)?.get(key) ?? null;
	}
	async set(scope, key, data) {
		if (!this.store.has(scope)) this.store.set(scope, /* @__PURE__ */ new Map());
		this.store.get(scope).set(key, data);
		return data;
	}
	async delete(scope, key) {
		this.store.get(scope)?.delete(key);
	}
	async list(scope) {
		const entries = this.store.get(scope);
		return entries ? Array.from(entries.values()) : [];
	}
	persist() {
		if (!this.persistPath) return;
		try {
			const dir = dirname(this.persistPath);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			const data = {};
			for (const [scope, entries] of this.store) data[scope] = Object.fromEntries(entries);
			writeFileSync(this.persistPath, JSON.stringify(data), "utf-8");
		} catch (err) {
			process.stderr.write(`[@agentmemory/mcp] Persist failed: ${err instanceof Error ? err.message : String(err)}\n`);
		}
	}
};

//#endregion
//#region src/mcp/transport.ts
function isNotification(req) {
	return req.id === void 0 || req.id === null;
}
function isValidId(id) {
	return id === void 0 || id === null || typeof id === "string" || typeof id === "number";
}
async function processLine(line, handler, writeOut, writeErr = (msg) => process.stderr.write(msg)) {
	const trimmed = line.trim();
	if (!trimmed) return;
	let parsed;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		writeOut({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32700,
				message: "Parse error"
			}
		});
		return;
	}
	const request = parsed;
	const rawId = request?.id;
	if (!request || typeof request !== "object" || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
		if (typeof rawId === "string" || typeof rawId === "number") writeOut({
			jsonrpc: "2.0",
			id: rawId,
			error: {
				code: -32600,
				message: "Invalid Request"
			}
		});
		return;
	}
	if (!isValidId(rawId)) {
		writeOut({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32600,
				message: "Invalid Request: id must be string, number, or null"
			}
		});
		return;
	}
	const notification = isNotification(request);
	try {
		const result = await handler(request.method, request.params || {});
		if (notification) return;
		writeOut({
			jsonrpc: "2.0",
			id: request.id,
			result
		});
	} catch (err) {
		if (notification) {
			writeErr(`[mcp-transport] notification handler error for ${request.method}: ${err instanceof Error ? err.message : String(err)}\n`);
			return;
		}
		writeOut({
			jsonrpc: "2.0",
			id: request.id,
			error: {
				code: -32603,
				message: err instanceof Error ? err.message : String(err)
			}
		});
	}
}
function createStdioTransport(handler) {
	let rl = null;
	const writeResponse = (response) => {
		process.stdout.write(JSON.stringify(response) + "\n");
	};
	const onLine = (line) => processLine(line, handler, writeResponse);
	return {
		start() {
			rl = createInterface({ input: process.stdin });
			rl.on("line", onLine);
		},
		stop() {
			rl?.close();
			rl = null;
		}
	};
}

//#endregion
//#region src/mcp/rest-proxy.ts
const DEFAULT_URL = "http://localhost:3111";
const HEALTH_PROBE_TIMEOUT_MS = 500;
const CALL_TIMEOUT_MS = 15e3;
const LOCAL_MODE_TTL_MS = 3e4;
let cached = null;
let cachedAt = 0;
let probeInFlight = null;
function baseUrl() {
	return (process.env["AGENTMEMORY_URL"] || DEFAULT_URL).replace(/\/+$/, "");
}
function authHeader() {
	const secret = process.env["AGENTMEMORY_SECRET"];
	return secret ? { authorization: `Bearer ${secret}` } : {};
}
async function probe(url) {
	try {
		return (await fetch(`${url}/agentmemory/livez`, {
			method: "GET",
			headers: authHeader(),
			signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)
		})).ok;
	} catch {
		return false;
	}
}
function invalidateHandle() {
	cached = null;
	cachedAt = 0;
}
async function resolveHandle() {
	const now = Date.now();
	if (cached) if (cached.mode === "local" && now - cachedAt >= LOCAL_MODE_TTL_MS) {
		cached = null;
		cachedAt = 0;
	} else return cached;
	if (probeInFlight) return probeInFlight;
	const url = baseUrl();
	probeInFlight = (async () => {
		if (await probe(url)) {
			const handle = {
				mode: "proxy",
				baseUrl: url,
				call: async (path, init) => {
					const res = await fetch(`${url}${path}`, {
						...init,
						headers: {
							"content-type": "application/json",
							...authHeader(),
							...init?.headers
						},
						signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
					});
					if (!res.ok) throw new Error(`${init?.method || "GET"} ${path} -> ${res.status} ${res.statusText}`);
					const text = await res.text();
					return text ? JSON.parse(text) : null;
				}
			};
			cached = handle;
			cachedAt = Date.now();
			return handle;
		}
		const local = { mode: "local" };
		cached = local;
		cachedAt = Date.now();
		return local;
	})();
	try {
		return await probeInFlight;
	} finally {
		probeInFlight = null;
	}
}

//#endregion
//#region src/mcp/standalone.ts
const IMPLEMENTED_TOOLS = new Set([
	"memory_save",
	"memory_recall",
	"memory_smart_search",
	"memory_sessions",
	"memory_export",
	"memory_audit",
	"memory_governance_delete"
]);
const SERVER_INFO = {
	name: "agentmemory",
	version: VERSION,
	protocolVersion: "2024-11-05"
};
const kv = new InMemoryKV(getStandalonePersistPath());
let modeAnnounced = false;
function announceMode(handle) {
	if (modeAnnounced) return;
	modeAnnounced = true;
	if (handle.mode === "proxy") process.stderr.write(`[@agentmemory/mcp] proxying to agentmemory server at ${handle.baseUrl}\n`);
	else process.stderr.write(`[@agentmemory/mcp] no server reachable at ${process.env["AGENTMEMORY_URL"] || "http://localhost:3111"}; falling back to local InMemoryKV\n`);
}
function normalizeList(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((v) => typeof v === "string" ? v.trim() : "").filter((v) => v.length > 0);
	if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
	return [];
}
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
function parseLimit(raw, fallback = DEFAULT_LIMIT) {
	if (typeof raw !== "number" && typeof raw !== "string") return fallback;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(Math.floor(n), MAX_LIMIT);
}
function textResponse(payload, pretty = false) {
	return { content: [{
		type: "text",
		text: JSON.stringify(payload, null, pretty ? 2 : 0)
	}] };
}
function validate(toolName, args) {
	if (!IMPLEMENTED_TOOLS.has(toolName)) throw new Error(`Unknown tool: ${toolName}`);
	const v = { tool: toolName };
	switch (toolName) {
		case "memory_save": {
			const content = args["content"];
			if (typeof content !== "string" || !content.trim()) throw new Error("content is required");
			v.content = content;
			v.type = args["type"] || "fact";
			v.concepts = normalizeList(args["concepts"]);
			v.files = normalizeList(args["files"]);
			return v;
		}
		case "memory_recall":
		case "memory_smart_search": {
			const query = args["query"];
			if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
			v.query = query.trim();
			v.limit = parseLimit(args["limit"]);
			return v;
		}
		case "memory_sessions":
			v.limit = parseLimit(args["limit"], 20);
			return v;
		case "memory_governance_delete": {
			const ids = normalizeList(args["memoryIds"]);
			if (ids.length === 0) throw new Error("memoryIds is required");
			v.memoryIds = ids;
			v.reason = args["reason"] || "plugin skill request";
			return v;
		}
		case "memory_export": return v;
		case "memory_audit":
			v.limit = parseLimit(args["limit"], 50);
			return v;
		default: throw new Error(`Unknown tool: ${toolName}`);
	}
}
async function handleProxy(v, handle) {
	switch (v.tool) {
		case "memory_save": return textResponse(await handle.call("/agentmemory/remember", {
			method: "POST",
			body: JSON.stringify({
				content: v.content,
				type: v.type,
				concepts: v.concepts,
				files: v.files
			})
		}));
		case "memory_recall":
		case "memory_smart_search": return textResponse(await handle.call("/agentmemory/smart-search", {
			method: "POST",
			body: JSON.stringify({
				query: v.query,
				limit: v.limit,
				format: "narrative"
			})
		}), true);
		case "memory_sessions": return textResponse(await handle.call(`/agentmemory/sessions?limit=${v.limit}`, { method: "GET" }), true);
		case "memory_governance_delete": return textResponse(await handle.call("/agentmemory/governance/memories", {
			method: "POST",
			body: JSON.stringify({
				memoryIds: v.memoryIds,
				reason: v.reason
			})
		}));
		case "memory_export": return textResponse(await handle.call("/agentmemory/export", { method: "GET" }), true);
		case "memory_audit": return textResponse(await handle.call(`/agentmemory/audit?limit=${v.limit}`, { method: "GET" }), true);
		default: throw new Error(`Unknown tool: ${v.tool}`);
	}
}
async function handleLocal(v, kvInstance) {
	switch (v.tool) {
		case "memory_save": {
			const id = generateId("mem");
			const isoNow = (/* @__PURE__ */ new Date()).toISOString();
			await kvInstance.set("mem:memories", id, {
				id,
				type: v.type,
				title: (v.content || "").slice(0, 80),
				content: v.content,
				concepts: v.concepts,
				files: v.files,
				createdAt: isoNow,
				updatedAt: isoNow,
				strength: 7,
				version: 1,
				isLatest: true,
				sessionIds: []
			});
			kvInstance.persist();
			return textResponse({ saved: id });
		}
		case "memory_recall":
		case "memory_smart_search": {
			const query = (v.query || "").toLowerCase();
			const limit = v.limit ?? DEFAULT_LIMIT;
			return textResponse({
				mode: "compact",
				results: (await kvInstance.list("mem:memories")).filter((m) => {
					const text = [
						typeof m["title"] === "string" ? m["title"] : "",
						typeof m["content"] === "string" ? m["content"] : "",
						Array.isArray(m["files"]) ? m["files"].join(" ") : "",
						Array.isArray(m["concepts"]) ? m["concepts"].join(" ") : "",
						Array.isArray(m["sessionIds"]) ? m["sessionIds"].join(" ") : "",
						typeof m["id"] === "string" ? m["id"] : ""
					].join(" ").toLowerCase();
					return query.split(/\s+/).every((word) => text.includes(word));
				}).slice(0, limit)
			}, true);
		}
		case "memory_sessions": {
			const sessions = await kvInstance.list("mem:sessions");
			const limit = v.limit ?? 20;
			return textResponse({ sessions: sessions.slice(0, limit) }, true);
		}
		case "memory_governance_delete": {
			let deleted = 0;
			for (const id of v.memoryIds || []) if (await kvInstance.get("mem:memories", id)) {
				await kvInstance.delete("mem:memories", id);
				deleted++;
			}
			kvInstance.persist();
			return textResponse({
				deleted,
				requested: (v.memoryIds || []).length,
				reason: v.reason
			});
		}
		case "memory_export": return textResponse({
			version: VERSION,
			memories: await kvInstance.list("mem:memories"),
			sessions: await kvInstance.list("mem:sessions")
		}, true);
		case "memory_audit": {
			const entries = await kvInstance.list("mem:audit");
			const limit = v.limit ?? 50;
			return textResponse({ entries: entries.slice(0, limit) }, true);
		}
		default: throw new Error(`Unknown tool: ${v.tool}`);
	}
}
async function handleToolCall(toolName, args, kvInstance = kv) {
	const validated = validate(toolName, args);
	const handle = await resolveHandle();
	announceMode(handle);
	if (handle.mode === "proxy") try {
		return await handleProxy(validated, handle);
	} catch (err) {
		process.stderr.write(`[@agentmemory/mcp] proxy call failed for ${toolName}: ${err instanceof Error ? err.message : String(err)}; invalidating handle and falling back to local KV\n`);
		invalidateHandle();
	}
	return handleLocal(validated, kvInstance);
}
const transport = createStdioTransport(async (method, params) => {
	switch (method) {
		case "initialize": return {
			protocolVersion: SERVER_INFO.protocolVersion,
			capabilities: { tools: { listChanged: false } },
			serverInfo: {
				name: SERVER_INFO.name,
				version: SERVER_INFO.version
			}
		};
		case "notifications/initialized": return {};
		case "tools/list": return { tools: getVisibleTools().filter((t) => IMPLEMENTED_TOOLS.has(t.name)) };
		case "tools/call": {
			const toolName = params.name;
			const toolArgs = params.arguments || {};
			try {
				return await handleToolCall(toolName, toolArgs);
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `Error: ${err instanceof Error ? err.message : String(err)}`
					}],
					isError: true
				};
			}
		}
		default: throw new Error(`Unknown method: ${method}`);
	}
});
process.stderr.write(`[@agentmemory/mcp] Standalone MCP server v${SERVER_INFO.version} starting...\n`);
transport.start();
process.on("SIGINT", () => {
	kv.persist();
	process.exit(0);
});
process.on("SIGTERM", () => {
	kv.persist();
	process.exit(0);
});

//#endregion
export {  };
//# sourceMappingURL=standalone-CqqEcfNR.mjs.map