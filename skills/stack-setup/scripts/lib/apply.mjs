import { Blocked, alreadyGone } from "./context.mjs";
import { capabilityOrder } from "./schema.mjs";
import { envNames, envValue, updateEnv } from "./envfile.mjs";
import { readStore, writeStore } from "./stores.mjs";
import { recordCreated } from "./state.mjs";
import { setSecret } from "../adapters/github.mjs";
import { configValue } from "../adapters/vercel.mjs";

// A step is one change, described before it runs:
//   { id, capability, kind: create | update | sync | wait | noop | blocked, summary, run?, mints? }
// `plan` only reads. `apply` runs the steps in order and stops at the first
// failure or wait, so a re-run picks up where it stopped.

export const CHANGES = ["create", "update", "sync", "wait"];

// What other adapters may ask of the DNS capability, if the stack has one.
function dnsBridge(ctx, adapters) {
	const entry = Object.entries(ctx.stack.capabilities).find(([, c]) => adapters[c.provider]?.ensureRecords);
	if (!entry) {
		const none = () => {
			throw new Blocked("this stack has no DNS capability that can write records");
		};
		return { provider: "no DNS provider", missing: none, ensure: none, tunnelToken: none };
	}
	const [, cap] = entry;
	const adapter = adapters[cap.provider];
	return {
		provider: cap.provider,
		missing: (records) => adapter.missingRecords(ctx, cap, records),
		ensure: (records, owner) => adapter.ensureRecords(ctx, cap, records, owner),
		tunnelToken: (name) => adapter.tunnelToken(ctx, cap, name),
	};
}

export async function plan(ctx, adapters, { mirrors = false, waitMinutes } = {}) {
	ctx.minted ??= new Map();
	ctx.dns ??= dnsBridge(ctx, adapters);
	const canonical = ctx.stack.secrets?.canonical;
	let storeText = null;
	let storeProblem = null;
	if (canonical)
		try {
			storeText = await readStore(ctx, canonical);
		} catch (error) {
			storeProblem = error;
		}
	const storeHas = (name) => (storeText === null ? true : envNames(storeText).includes(name));
	const steps = [];
	if (storeProblem)
		steps.push({ id: "secrets.store", capability: "secrets", kind: "blocked", summary: `can't read the secret store: ${storeProblem.message}` });

	for (const name of capabilityOrder(ctx.stack)) {
		const cap = ctx.stack.capabilities[name];
		const adapter = adapters[cap.provider];
		if (!adapter?.plan) continue;
		try {
			steps.push(...(await adapter.plan(ctx, name, cap, { storeHas, storeReadable: storeText !== null, waitMinutes })).map((s) => ({ capability: name, ...s })));
		} catch (error) {
			if (!(error instanceof Blocked)) throw error;
			steps.push({ id: name, capability: name, kind: "blocked", summary: error.message, gate: error.gate });
		}
	}

	// Steps blocked only for want of permissions that a planned token step adds are
	// planned again, in the same apply, once that token exists.
	if (steps.some((s) => s.replan && CHANGES.includes(s.kind)))
		for (const s of steps) if (s.kind === "blocked" && /lacks this permission/.test(s.summary)) s.summary = `planned again after the token step, in the same apply (${s.summary})`;
	if (!canonical || storeText === null) return steps;
	// Config the store should hold: written in stack.yaml, or given by an adapter.
	const config = {};
	for (const c of ctx.stack.secrets.config ?? []) if (c.target === canonical.type && configValue(ctx.stack, c) !== undefined) config[c.name] = configValue(ctx.stack, c);
	for (const cap of Object.values(ctx.stack.capabilities)) Object.assign(config, adapters[cap.provider]?.provides?.(cap, ctx.stack) ?? {});
	const changed = Object.entries(config).filter(([name, value]) => envValue(storeText, name) !== value);
	const minting = steps.filter((s) => s.mints?.length).flatMap((s) => s.mints);
	if (changed.length || minting.length)
		steps.push({
			id: "secrets.store.write",
			capability: "secrets",
			kind: "sync",
			summary: `${canonical.type} ${canonical.path}: set ${[...minting, ...changed.map(([n, v]) => `${n}=${v}`)].join(", ")}`,
			run: async () => {
				const updates = Object.fromEntries(changed);
				for (const name of minting) if (ctx.minted.has(name)) updates[name] = ctx.minted.get(name);
				const before = await readStore(ctx, canonical);
				await writeStore(ctx, canonical, updateEnv(before, updates));
				const fresh = Object.keys(updates).filter((n) => !envNames(before).includes(n));
				for (const n of fresh) recordCreated(ctx, `store.${n}`, "store", { name: n, store: canonical.type });
			},
		});
	const mirrorsNeeded = mirrors || changed.length || minting.length;
	for (const m of ctx.stack.secrets.mirrors ?? []) {
		const repo = m.repo ?? Object.values(ctx.stack.capabilities).find((c) => c.provider === "github")?.repo;
		steps.push(
			mirrorsNeeded
				? {
						id: `secrets.mirror.${m.name}`,
						capability: "secrets",
						kind: "sync",
						summary: `copy the store to GitHub secret ${m.name} in ${repo}`,
						run: async () => setSecret(ctx, repo, m.name, await readStore(ctx, canonical)),
					}
				: { id: `secrets.mirror.${m.name}`, capability: "secrets", kind: "noop", summary: `GitHub secret ${m.name} (store unchanged)` },
		);
	}
	return steps;
}

export async function apply(ctx, steps, { acceptCost = false } = {}) {
	const done = [];
	// Spending money needs the owner's yes, given as --accept-cost after they saw
	// the plan. Checked before anything runs, so a refusal leaves nothing half-built.
	const costly = steps.find((s) => s.cost && CHANGES.includes(s.kind));
	if (costly && !acceptCost) return { done, failed: { ...costly, error: `this costs money (${costly.cost}); nothing was changed. Run again with --accept-cost once the owner agrees` } };
	for (const step of steps) {
		// Blocked steps are skipped: they only stop their own capability. A key is
		// never minted unless the store it goes into could be read.
		if (!CHANGES.includes(step.kind)) continue;
		try {
			const result = await step.run();
			ctx.cache.clear();
			if (result?.waiting) {
				ctx.state.gates[result.waiting.id] = { status: "waiting", at: ctx.now().toISOString(), note: result.waiting.title };
				return { done, waiting: { ...step, note: result.waiting.title } };
			}
			done.push(step);
		} catch (error) {
			return { done, failed: { ...step, error: error.message } };
		} finally {
			ctx.cache.clear();
		}
	}
	return { done };
}

// Removes only what stack-setup itself created, newest first. Anything found by
// import or made by hand is never touched.
export function teardownList(state) {
	return Object.entries(state.resources)
		.filter(([, r]) => r.createdBy === "stack-setup")
		// The agent's own credentials go last: everything before needs them to be removed.
		.sort(([, a], [, b]) => (a.credential ? 1 : 0) - (b.credential ? 1 : 0) || b.order - a.order);
}

export async function teardown(ctx, adapters) {
	const removed = [];
	for (const [key, resource] of teardownList(ctx.state)) {
		try {
			if (resource.provider === "store") {
				const canonical = ctx.stack.secrets.canonical;
				await writeStore(ctx, canonical, updateEnv(await readStore(ctx, canonical), {}, [resource.name]));
				removed.push(`${resource.name} from the ${canonical.type} store`);
			} else removed.push(await adapters[resource.provider].remove(ctx, key, resource));
		} catch (error) {
			if (!alreadyGone(error)) return { removed, failed: { key, error: error.message } };
			removed.push(`${resource.name ?? resource.key ?? key} (already gone)`);
		}
		delete ctx.state.resources[key];
	}
	return { removed };
}

