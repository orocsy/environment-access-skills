import { BLOCKED, Blocked, GREEN, RED, SKIPPED, firstLine } from "./context.mjs";
import { capabilityOrder } from "./schema.mjs";
import { recordResource } from "./state.mjs";
import { closeByChecks, ledger } from "./gates.mjs";
import { storeGates, verifyStores } from "./stores.mjs";
import { packs } from "../packs/index.mjs";
import { skillStatus } from "./skills.mjs";

const RANK = { [RED]: 3, [BLOCKED]: 2, [SKIPPED]: 1, [GREEN]: 0 };

// Provider deadlines that affect any app; each app adds its own in stack.yaml.
export const PROVIDER_DEADLINES = [
	{ date: "2026-11-30", what: "Stripe MCP needs agent-tagged restricted keys" },
	{ date: "2026-12-01", what: "Railway stops reading its old config files" },
];

function failure(name, error) {
	return error instanceof Blocked
		? { id: name, capability: name, status: BLOCKED, detail: error.message, ...(error.gate && { gate: error.gate }) }
		: { id: name, capability: name, status: RED, detail: `check failed: ${error.message}` };
}

// One entry per id, keeping the worst result when two adapters report the same login.
function merge(checks) {
	const byId = new Map();
	for (const check of checks) {
		const before = byId.get(check.id);
		if (!before || RANK[check.status] > RANK[before.status]) byId.set(check.id, check);
	}
	return [...byId.values()];
}

async function eachCapability(ctx, adapters, step, onResult) {
	for (const name of capabilityOrder(ctx.stack)) {
		const cap = ctx.stack.capabilities[name];
		const adapter = adapters[cap.provider];
		if (!adapter) {
			await onResult(name, null, { id: name, capability: name, status: SKIPPED, detail: `no adapter for provider "${cap.provider}" yet` });
			continue;
		}
		if (!adapter[step]) continue;
		try {
			await onResult(name, await adapter[step](ctx, name, cap));
		} catch (error) {
			await onResult(name, null, failure(name, error));
		}
	}
}

export const packFor = (stack) => (stack.jurisdiction ? packs[stack.jurisdiction] : null);

export function allGates(ctx, adapters) {
	return ledger(ctx.stack, ctx.state, adapters, [...storeGates(ctx.stack), ...(packFor(ctx.stack)?.gates(ctx.stack) ?? [])]);
}

export async function verify(ctx, adapters) {
	const checks = [];
	await eachCapability(ctx, adapters, "verify", (name, found, failed) => {
		if (failed) checks.push(failed);
		else checks.push(...found.map((c) => ({ capability: name, ...c })));
	});
	try {
		checks.push(...(await verifyStores(ctx)).map((c) => ({ capability: "secrets", ...c })));
	} catch (error) {
		checks.push({ ...failure("secrets", error), id: "secrets.store" });
	}
	const merged = merge(checks);
	const at = ctx.now().toISOString();
	ctx.state.checks = Object.fromEntries(merged.map((c) => [c.id, { status: c.status, at }]));
	const gates = allGates(ctx, adapters);
	closeByChecks(gates, ctx.state, merged, at);
	return { checks: merged, gates };
}

export async function importResources(ctx, adapters) {
	const found = [];
	const problems = [];
	const at = ctx.now().toISOString();
	await eachCapability(ctx, adapters, "import", (name, items, failed) => {
		if (failed) {
			if (failed.status !== SKIPPED) problems.push(failed);
			return;
		}
		for (const item of items) {
			recordResource(ctx.state, item.key, item.fields, at);
			found.push({ capability: name, ...item });
		}
	});
	return { found, problems };
}

export async function doctor(ctx, adapters) {
	const providers = new Set(Object.values(ctx.stack.capabilities).map((c) => c.provider));
	const tools = new Map([["node", ["--version"]]]);
	for (const provider of providers) for (const t of adapters[provider]?.tools ?? []) tools.set(t.cmd, t.args);
	if (ctx.stack.secrets?.canonical?.type === "1password") tools.set("op", ["--version"]);
	for (const t of packFor(ctx.stack)?.tools ?? []) tools.set(t.cmd, t.args);
	const checks = [];
	for (const [cmd, args] of tools) {
		const result = await ctx.run(cmd, args);
		checks.push({
			id: `tool.${cmd}`,
			capability: "tools",
			status: result.missing ? RED : GREEN,
			detail: result.missing ? `${cmd} is not installed` : firstLine(result.stdout || result.stderr),
		});
	}
	await eachCapability(ctx, adapters, "doctor", (name, found, failed) => {
		if (failed) checks.push(failed);
		else checks.push(...found.map((c) => ({ capability: name, ...c })));
	});
	const today = ctx.now();
	const deadlines = [...PROVIDER_DEADLINES, ...(ctx.stack.deadlines ?? [])]
		.map((d) => ({ ...d, days: Math.ceil((Date.parse(`${d.date}T00:00:00Z`) - today) / 86400000) }))
		.filter((d) => d.days >= 0)
		.sort((a, b) => a.days - b.days);
	const skills = await skillStatus(ctx.stack, { repoRoot: ctx.repoRoot, lookup: ctx.skillLookup });
	return { checks: merge(checks), deadlines, skills };
}

export const worst = (checks) => checks.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), GREEN);
