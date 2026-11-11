import { dirname } from "node:path";
import { Blocked, GREEN, RED, expandHome } from "./context.mjs";
import { findSecret } from "./guard.mjs";
import { envNames, envValue } from "./envfile.mjs";
import { hostShell } from "../adapters/aws-ec2-docker.mjs";

// Every name the app's contract promises, in the order the stack lists them.
const contractNames = (stack) => [...new Set(Object.values(stack.contract ?? {}).flat())];

// Names present in the canonical store. For server-env, values never leave the host.
async function storeNames(ctx, canonical) {
	if (canonical.type === "server-env") {
		const result = await hostShell(ctx, canonical.host, `grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' ${canonical.path}`);
		if (result.code === 2) throw new Error(`${canonical.path} is missing on ${canonical.host}`);
		return result.stdout.split("\n").filter(Boolean).map((line) => line.slice(0, -1));
	}
	if (canonical.type === "local-env") return envNames(await readLocal(ctx, canonical));
	const result = await ctx.run("op", ["item", "get", canonical.item, "--vault", canonical.vault, "--format", "json"]);
	if (result.missing) throw new Blocked("op (1Password CLI) is not installed", "1password.login");
	if (result.code !== 0) throw new Blocked("1Password CLI is not signed in, or the item is missing", "1password.login");
	// Parsed here and reduced to labels at once; values are dropped.
	return (JSON.parse(result.stdout).fields ?? []).map((f) => f.label).filter(Boolean);
}

async function readLocal(ctx, canonical) {
	try {
		return await ctx.readText(canonical.path);
	} catch (error) {
		if (error.code === "ENOENT") return "";
		throw error;
	}
}

// The whole canonical file, held in memory only to rewrite it or copy it to a mirror.
export async function readStore(ctx, canonical) {
	if (canonical.type === "local-env") return readLocal(ctx, canonical);
	if (canonical.type === "server-env") {
		const result = await hostShell(ctx, canonical.host, `cat ${canonical.path}`);
		if (result.code !== 0) throw new Error(`can't read ${canonical.path} on ${canonical.host}`);
		return result.stdout;
	}
	throw new Blocked("writing to 1Password arrives in M3; use server-env or local-env for now");
}

// Replaces the canonical file in one step, keeping a dated copy of the old one.
export async function writeStore(ctx, canonical, text) {
	if (canonical.type === "local-env") {
		await assertPrivateLocation(ctx, canonical.path);
		await ctx.writeSecretFile(canonical.path, text);
		return;
	}
	if (canonical.type === "server-env") {
		const p = canonical.path;
		const result = await hostShell(
			ctx,
			canonical.host,
			`umask 077 && cat > ${p}.stack-tmp && { [ ! -f ${p} ] || cp -p ${p} ${p}.bak-$(date +%Y%m%d%H%M%S)-stack; } && mv ${p}.stack-tmp ${p}`,
			{ input: text },
		);
		if (result.code !== 0) throw new Error(`writing ${p} on ${canonical.host} failed`);
		return;
	}
	throw new Blocked("writing to 1Password arrives in M3; use server-env or local-env for now");
}

// A local secret file must not be somewhere Git would pick it up.
export async function assertPrivateLocation(ctx, path) {
	const full = expandHome(path);
	const top = await ctx.run("git", ["-C", dirname(full), "rev-parse", "--show-toplevel"]);
	if (top.code !== 0 || top.missing) return;
	const ignored = await ctx.run("git", ["-C", dirname(full), "check-ignore", "-q", full]);
	if (ignored.code !== 0)
		throw new Error(`${path} is inside a Git checkout and not ignored; put local secrets outside Git or in an ignored file`);
}

// A config value is not secret, so its exact text may be compared.
export async function storeValue(ctx, canonical, name) {
	let line;
	if (canonical.type === "server-env") {
		const result = await hostShell(ctx, canonical.host, `grep -E '^${name}=' ${canonical.path}`);
		line = result.stdout.split("\n")[0] ?? "";
	} else {
		const value = envValue(await readLocal(ctx, canonical), name);
		line = value === null ? "" : `${name}=${value}`;
	}
	if (findSecret(line)) throw new Error(`${name} in the store looks like a secret; it can't be a config value`);
	return line ? line.slice(name.length + 1).replace(/^(['"])(.*)\1$/, "$2") : null;
}

export function storeGates(stack) {
	return stack.secrets?.canonical?.type === "1password"
		? [
				{
					id: "1password.login",
					bundle: "preflight",
					type: "consent",
					title: "Install the 1Password CLI and turn on desktop app integration",
					prefill: { install: "brew install 1password-cli", command: "op signin" },
					closedBy: "secrets.store",
				},
			]
		: [];
}

export async function verifyStores(ctx) {
	const canonical = ctx.stack.secrets?.canonical;
	if (!canonical) return [];
	const checks = [];
	const names = await storeNames(ctx, canonical);
	const wanted = contractNames(ctx.stack);
	const missing = wanted.filter((n) => !names.includes(n));
	checks.push({
		id: "secrets.store",
		status: missing.length ? RED : GREEN,
		detail: `${canonical.type}: ${names.length} names${missing.length ? `; missing from the contract: ${missing.join(", ")}` : `, all ${wanted.length} contract names present`}`,
	});
	if (canonical.type !== "1password")
		for (const c of (ctx.stack.secrets.config ?? []).filter((c) => c.target === canonical.type && c.value !== undefined)) {
			const value = await storeValue(ctx, canonical, c.name);
			checks.push({
				id: `secrets.config.${c.name}`,
				status: value === c.value ? GREEN : RED,
				detail: value === c.value ? `${c.name}=${c.value}` : `${c.name} is ${value === null ? "missing" : "different"}; expected ${c.value}`,
			});
		}
	return checks;
}
