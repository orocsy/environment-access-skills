import { Blocked, GREEN, RED } from "./context.mjs";
import { findSecret } from "./guard.mjs";
import { hostShell } from "../adapters/aws-ec2-docker.mjs";

// Every name the app's contract promises, in the order the stack lists them.
const contractNames = (stack) => [...new Set(Object.values(stack.contract ?? {}).flat())];

// Names present in the canonical store. Values never leave the store.
async function storeNames(ctx, canonical) {
	if (canonical.type === "server-env") {
		const result = await hostShell(ctx, canonical.host, `grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' ${canonical.path}`);
		if (result.code === 2) throw new Error(`${canonical.path} is missing on ${canonical.host}`);
		return result.stdout.split("\n").filter(Boolean).map((line) => line.slice(0, -1));
	}
	const result = await ctx.run("op", ["item", "get", canonical.item, "--vault", canonical.vault, "--format", "json"]);
	if (result.missing) throw new Blocked("op (1Password CLI) is not installed", "1password.login");
	if (result.code !== 0) throw new Blocked("1Password CLI is not signed in, or the item is missing", "1password.login");
	// Parsed here and reduced to labels at once; values are dropped.
	return (JSON.parse(result.stdout).fields ?? []).map((f) => f.label).filter(Boolean);
}

// A config value is not secret, so its exact text may be compared.
async function serverValue(ctx, canonical, name) {
	const result = await hostShell(ctx, canonical.host, `grep -E '^${name}=' ${canonical.path}`);
	const line = result.stdout.split("\n")[0] ?? "";
	if (findSecret(line)) throw new Error(`${name} on the host looks like a secret; it can't be a config value`);
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
	if (canonical.type === "server-env")
		for (const c of (ctx.stack.secrets.config ?? []).filter((c) => c.target === "server-env" && c.value !== undefined)) {
			const value = await serverValue(ctx, canonical, c.name);
			checks.push({
				id: `secrets.config.${c.name}`,
				status: value === c.value ? GREEN : RED,
				detail: value === c.value ? `${c.name}=${c.value}` : `${c.name} is ${value === null ? "missing" : "different"}; expected ${c.value}`,
			});
		}
	return checks;
}
