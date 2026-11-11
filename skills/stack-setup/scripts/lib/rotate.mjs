import { rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { expandHome } from "./context.mjs";
import { envNames, envValue, updateEnv } from "./envfile.mjs";
import { assertPrivateLocation, readStore, writeStore } from "./stores.mjs";
import { hostShell } from "../adapters/aws-ec2-docker.mjs";
import { setSecret } from "../adapters/github.mjs";

// Puts values into the canonical store, refreshes every mirror, then asks the
// app to pick them up. Values arrive here from a provider or a hand-off file
// and are only ever passed on stdin.
export async function storeAndSpread(ctx, values) {
	const canonical = ctx.stack.secrets?.canonical;
	if (!canonical) throw new Error("this stack has no secrets.canonical store to write to");
	const text = updateEnv(await readStore(ctx, canonical), values);
	await writeStore(ctx, canonical, text);
	const github = Object.values(ctx.stack.capabilities).find((c) => c.provider === "github");
	for (const m of ctx.stack.secrets.mirrors ?? []) await setSecret(ctx, m.repo ?? github?.repo, m.name, text);
	if (canonical.reload) {
		const result = await hostShell(ctx, canonical.host, canonical.reload);
		if (result.code !== 0) throw new Error(`the store was written but reloading the app failed: ${result.stderr.trim().split("\n")[0] ?? ""}`);
	}
	return { names: Object.keys(values), mirrors: (ctx.stack.secrets.mirrors ?? []).map((m) => m.name), reloaded: Boolean(canonical.reload) };
}

// A replacement only reaches the running app if the store can tell it to reload.
export function canRevokeSafely(stack) {
	const canonical = stack.secrets?.canonical;
	return canonical?.type !== "server-env" || Boolean(canonical.reload);
}

export async function rotate(ctx, adapters, target, options) {
	for (const [name, cap] of Object.entries(ctx.stack.capabilities)) {
		const message = await adapters[cap.provider]?.rotate?.(ctx, name, cap, target, options);
		if (message) return message;
	}
	throw new Error(`nothing in this stack rotates "${target}". Try an env name a provider mints (like RESEND_API_KEY) or agent-key`);
}

// Reads what a person handed back: Google's client JSON, or a KEY=value file
// (such as secure-key-handoff's --dotenv output). Only the names a gate expects
// are taken.
export function parseHandoff(text, wanted) {
	let values = {};
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		const data = JSON.parse(trimmed);
		const client = data.web ?? data.installed;
		if (client?.client_id) values = { GOOGLE_CLIENT_ID: client.client_id, GOOGLE_CLIENT_SECRET: client.client_secret };
		else values = data;
	} else if (wanted.length === 1 && !/[\r\n]/.test(trimmed) && !envNames(trimmed).length) {
		values[wanted[0]] = trimmed; // a bare value, as secure-key-handoff's receive writes it
	} else for (const name of envNames(trimmed)) values[name] = envValue(trimmed, name);
	const picked = Object.fromEntries(wanted.filter((n) => typeof values[n] === "string" && values[n]).map((n) => [n, values[n]]));
	const missing = wanted.filter((n) => !(n in picked));
	if (missing.length) throw new Error(`the file doesn't have ${missing.join(", ")}`);
	return picked;
}

async function writeLocal(ctx, path, values) {
	await assertPrivateLocation(ctx, path);
	const before = await ctx.readText(path).catch(() => "");
	await ctx.writeSecretFile(path, updateEnv(before, values));
	return { names: Object.keys(values), mirrors: [], reloaded: false, local: path };
}

export async function pickup(ctx, gate, file) {
	if (!gate.receive?.length) throw new Error(`${gate.id} doesn't receive any values`);
	const values = parseHandoff(await ctx.readText(file), gate.receive);
	// Some values are for the agent on this computer only (a bootstrap token), not the app's store.
	const result = gate.pickupTo ? await writeLocal(ctx, gate.pickupTo, values) : await storeAndSpread(ctx, values);
	// The plain copy has done its job; the Trash keeps it recoverable for a while.
	const full = expandHome(file);
	const trashed = join(homedir(), ".Trash", `${Date.now()}-${basename(full)}`);
	await (ctx.moveToTrash ?? ((from) => rename(from, trashed)))(full);
	return result;
}
