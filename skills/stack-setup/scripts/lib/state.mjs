import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { assertNoSecrets } from "./guard.mjs";

// .stack/state.json holds IDs, gate status and last checks. Never secret values.
export function emptyState(app) {
	return { version: 1, app, resources: {}, gates: {}, checks: {}, created: 0 };
}

export async function loadState(path, app) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return emptyState(app);
		throw error;
	}
	const state = JSON.parse(text);
	if (state?.version !== 1) throw new Error(`${path}: unknown state version`);
	if (state.app !== app)
		throw new Error(`${path} belongs to "${state.app}", not "${app}"`);
	return { ...emptyState(app), ...state };
}

const sorted = (value) =>
	Array.isArray(value)
		? value.map(sorted)
		: value && typeof value === "object"
			? Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((k) => [k, sorted(value[k])]),
				)
			: value;

// Sorted keys keep diffs of the committed file small and stable.
export async function saveState(path, state) {
	assertNoSecrets(state, "state.json");
	const { version, app, ...rest } = state;
	const text = `${JSON.stringify({ version, app, ...sorted(rest) }, null, "\t")}\n`;
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	await writeFile(temp, text, { mode: 0o644 });
	await rename(temp, path);
}

// Merges what an adapter found, keeping the earlier first-seen time.
export function recordResource(state, key, fields, now) {
	const before = state.resources[key];
	state.resources[key] = {
		...before,
		...fields,
		firstSeen: before?.firstSeen ?? now,
		lastSeen: now,
	};
}

// Something stack-setup made. Only these can be removed by `stack teardown`;
// resources found by import or made by hand are never deleted.
export function recordCreated(ctx, key, provider, fields) {
	ctx.state.created = (ctx.state.created ?? 0) + 1;
	recordResource(ctx.state, key, { ...fields, provider, createdBy: "stack-setup", order: ctx.state.created }, ctx.now().toISOString());
}
