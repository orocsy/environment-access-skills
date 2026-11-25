import { GREEN, RED } from "../lib/context.mjs";
import { recordCreated } from "../lib/state.mjs";
import { canRevokeSafely, storeAndSpread } from "../lib/rotate.mjs";

const LOGIN_GATE = "resend.login";
const resend = (ctx, cap, args) => ctx.json("resend", [...args, "--profile", cap.profile, "--json"], { gate: LOGIN_GATE });
const change = (ctx, cap, args) => ctx.call("resend", [...args, "--profile", cap.profile, "--json"]);
const domainName = (ctx, cap) => `${cap.subdomain}.${ctx.stack.domain}`;
const keyEnv = (cap) => cap.key_env ?? "RESEND_API_KEY";
const keyName = (ctx, cap) => `${ctx.stack.app} ${domainName(ctx, cap)} send-only (stack-setup)`;
const WAIT_STEP_MS = 15000;

async function findDomain(ctx, cap) {
	const known = ctx.state.resources[`resend.domain.${domainName(ctx, cap)}`];
	if (known?.id) return resend(ctx, cap, ["domains", "get", known.id]);
	const { data = [] } = await resend(ctx, cap, ["domains", "list"]);
	const found = data.find((d) => d.name === domainName(ctx, cap));
	return found ? resend(ctx, cap, ["domains", "get", found.id]) : null;
}

// Resend names records relative to the root domain ("send.mail"); DNS wants them whole.
const dnsRecords = (domain) =>
	(domain.records ?? []).map((r) => ({ type: r.type, name: r.name, content: r.value, ...(r.priority !== undefined && { priority: r.priority }), ...(r.ttl && r.ttl !== "Auto" && { ttl: Number(r.ttl) || 1 }) }));

async function waitVerified(ctx, cap, id, minutes) {
	await change(ctx, cap, ["domains", "verify", id]);
	const deadline = ctx.now().getTime() + minutes * 60000;
	for (;;) {
		const domain = await resend(ctx, cap, ["domains", "get", id]);
		if (domain.status === "verified") return domain;
		if (domain.status === "failed") throw new Error(`Resend could not verify ${domain.name}; check its DNS records`);
		if (ctx.now().getTime() >= deadline) return null;
		await ctx.sleep(WAIT_STEP_MS);
	}
}

export default {
	provider: "resend",
	tools: [{ cmd: "resend", args: ["--version"] }],
	validate(cap) {
		const errors = [];
		if (!/^[a-z0-9-]+$/.test(cap.profile ?? "")) errors.push("profile: the resend CLI profile for this app");
		if (!/^[a-z0-9-]+$/.test(cap.subdomain ?? "")) errors.push("subdomain: the sending subdomain, like mail");
		if (cap.sender !== undefined && !/^[a-z0-9._-]+$/.test(cap.sender)) errors.push("sender: the part before @, like no-reply");
		if (cap.from_name !== undefined && !/^[\w .'&-]+$/.test(cap.from_name)) errors.push("from_name: plain text, like WiggleTrail");
		return errors;
	},
	// Config values this capability gives the app; compared and written like any other config.
	provides(cap, stack) {
		if (!cap.sender) return {};
		const address = `${cap.sender}@${cap.subdomain}.${stack.domain}`;
		return { [cap.from_env ?? "EMAIL_FROM"]: cap.from_name ? `${cap.from_name} <${address}>` : address };
	},
	mints: (cap) => [keyEnv(cap)],
	gates(cap) {
		return [
			{
				id: LOGIN_GATE,
				bundle: "preflight",
				type: "consent",
				title: "Approve the Resend CLI login",
				prefill: { command: `resend login --web --profile ${cap.profile}` },
				closedBy: "resend.login",
			},
		];
	},
	async doctor(ctx, name, cap) {
		await resend(ctx, cap, ["domains", "list"]);
		return [{ id: "resend.login", status: GREEN, detail: `profile ${cap.profile}` }];
	},
	async plan(ctx, name, cap, { storeHas, waitMinutes = 10 }) {
		const host = domainName(ctx, cap);
		const domain = await findDomain(ctx, cap);
		const steps = [];
		if (!domain)
			steps.push({
				id: `${name}.domain`,
				kind: "create",
				summary: `Resend domain ${host} in ${cap.region ?? "the default region"}`,
				run: async () => {
					const made = await change(ctx, cap, ["domains", "create", "--name", host, ...(cap.region ? ["--region", cap.region] : [])]);
					recordCreated(ctx, `resend.domain.${made.name}`, "resend", { id: made.id, name: made.name, region: made.region });
				},
			});
		// Once Resend says verified, its records are in place, whatever their formatting in DNS.
		const missing = !domain ? null : domain.status === "verified" ? [] : await ctx.dns.missing(dnsRecords(domain));
		steps.push(
			missing === null || missing.length
				? {
						id: `${name}.records`,
						kind: "create",
						summary: missing ? `${missing.length} DNS records for ${host} (${missing.map((r) => r.type).join(", ")})` : `the new domain's DNS records in ${ctx.dns.provider}`,
						run: async () => ctx.dns.ensure(dnsRecords(await findDomain(ctx, cap)), name),
					}
				: { id: `${name}.records`, kind: "noop", summary: `DNS records for ${host}` },
		);
		steps.push(
			domain?.status === "verified"
				? { id: `${name}.verification`, kind: "noop", summary: `${host} verified` }
				: {
						id: `${name}.verification`,
						kind: "wait",
						summary: `ask Resend to verify ${host}, then wait up to ${waitMinutes} minutes`,
						run: async () => {
							const found = await findDomain(ctx, cap);
							return (await waitVerified(ctx, cap, found.id, waitMinutes))
								? undefined
								: { waiting: { id: `${name}.verification`, title: `DNS for ${host} is still propagating; run stack apply again later` } };
						},
					},
		);
		const env = keyEnv(cap);
		steps.push(
			storeHas(env)
				? { id: `${name}.key`, kind: "noop", summary: `${env} already in the store (replace it with stack rotate ${env})` }
				: {
						id: `${name}.key`,
						kind: "create",
						summary: `send-only key for ${host} → ${env}`,
						mints: [env],
						run: async () => {
							const found = await findDomain(ctx, cap);
							const made = await change(ctx, cap, ["api-keys", "create", "--name", keyName(ctx, cap), "--permission", "sending_access", "--domain-id", found.id]);
							if (typeof made.token !== "string" || !made.id) throw new Error("Resend did not return a key");
							recordCreated(ctx, `resend.key.${made.id}`, "resend", { id: made.id, name: keyName(ctx, cap), env });
							ctx.minted.set(env, made.token);
						},
					},
		);
		return steps;
	},
	// New key first, into the store and mirrors, then the old one revoked at Resend.
	async rotate(ctx, name, cap, target, { revoke = [] } = {}) {
		if (target !== keyEnv(cap)) return null;
		const domain = await findDomain(ctx, cap);
		if (!domain) throw new Error(`${domainName(ctx, cap)} doesn't exist yet; run stack apply first`);
		const old = [
			...Object.entries(ctx.state.resources).filter(([k, r]) => k.startsWith("resend.key.") && r.env === target).map(([, r]) => r.id),
			...revoke,
		];
		const made = await change(ctx, cap, ["api-keys", "create", "--name", keyName(ctx, cap), "--permission", "sending_access", "--domain-id", domain.id]);
		if (typeof made.token !== "string" || !made.id) throw new Error("Resend did not return a key");
		recordCreated(ctx, `resend.key.${made.id}`, "resend", { id: made.id, name: keyName(ctx, cap), env: target });
		await storeAndSpread(ctx, { [target]: made.token });
		if (!canRevokeSafely(ctx.stack))
			return `new ${target} is in the store and mirrors; the old key was kept because the app can't be told to reload (add secrets.canonical.reload), so revoke it after the next deploy: ${old.join(", ") || "none recorded"}`;
		for (const id of old) {
			await change(ctx, cap, ["api-keys", "delete", id, "--yes"]).catch((error) => {
				if (!/not found/i.test(error.message)) throw error;
			});
			delete ctx.state.resources[`resend.key.${id}`];
		}
		return `new ${target} (${made.id}) in the store, mirrors and app; revoked ${old.join(", ") || "nothing (pass --revoke <id> for a key made by hand)"}`;
	},
	async remove(ctx, key, resource) {
		const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "resend");
		const isDomain = key.startsWith("resend.domain.");
		await change(ctx, cap, isDomain ? ["domains", "delete", resource.id, "--yes"] : ["api-keys", "delete", resource.id, "--yes"]);
		return isDomain ? `Resend domain ${resource.name}` : `Resend key ${resource.name} (revoked)`;
	},
	async import(ctx, name, cap) {
		const domain = await findDomain(ctx, cap);
		if (!domain) return [];
		const { data: keys = [] } = await resend(ctx, cap, ["api-keys", "list"]);
		return [
			{ key: `resend.domain.${domain.name}`, fields: { id: domain.id, name: domain.name, region: domain.region } },
			...keys.map((k) => ({ key: `resend.key.${k.id}`, fields: { id: k.id, name: k.name } })),
		];
	},
	async verify(ctx, name, cap) {
		const checks = [{ id: "resend.login", status: GREEN, detail: `profile ${cap.profile}` }];
		const domain = await findDomain(ctx, cap);
		if (!domain) return [...checks, { id: `${name}.domain`, status: RED, detail: `${domainName(ctx, cap)} is not in this Resend team` }];
		const regionOk = !cap.region || domain.region === cap.region;
		checks.push({
			id: `${name}.domain`,
			status: domain.status === "verified" && regionOk && domain.capabilities?.sending === "enabled" ? GREEN : RED,
			detail: `${domain.name} ${domain.status}, sending ${domain.capabilities?.sending ?? "unknown"}, ${domain.region}${regionOk ? "" : ` (expected ${cap.region})`}`,
		});
		const unverified = (domain.records ?? []).filter((r) => r.status !== "verified");
		checks.push({
			id: `${name}.records`,
			status: unverified.length ? RED : GREEN,
			detail: unverified.length
				? `not verified: ${unverified.map((r) => `${r.type} ${r.name}`).join(", ")}`
				: `${domain.records?.length ?? 0} DNS records verified`,
		});
		const { data: keys = [] } = await resend(ctx, cap, ["api-keys", "list"]);
		const recorded = Object.values(ctx.state.resources).filter((r) => r.id && keys.some((k) => k.id === r.id));
		checks.push({
			id: `${name}.key`,
			status: keys.length ? GREEN : RED,
			detail: keys.length
				? `${keys.length} key${keys.length === 1 ? "" : "s"}${recorded.length ? `, ${recorded.length} recorded in state` : ""}; last used ${keys.map((k) => k.last_used_at?.slice(0, 10) ?? "never").join(", ")}`
				: "no API key; the app can't send",
		});
		return checks;
	},
};
