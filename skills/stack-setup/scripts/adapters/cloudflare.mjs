import { Blocked, GREEN, RED, readEnvValue } from "../lib/context.mjs";
import { recordCreated } from "../lib/state.mjs";
import { updateEnv } from "../lib/envfile.mjs";
import { assertPrivateLocation } from "../lib/stores.mjs";

const API = "https://api.cloudflare.com/client/v4";
const TOKEN_GATE = "cloudflare.token";
const BOOTSTRAP_GATE = "cloudflare.bootstrap";
const AGENT_TOKEN = "cloudflare.agent-token";

// Two tokens: the agent's own (token_file, CLOUDFLARE_API_TOKEN), and optionally
// the owner's one-time bootstrap token (bootstrap_token_file,
// CLOUDFLARE_BOOTSTRAP_TOKEN), which can only create and delete tokens. With
// the bootstrap token the agent mints its own token with exactly what the stack needs.
async function token(ctx, cap, as = "agent") {
	return ctx.once(`cloudflare.token.${as}`, async () => {
		if (as === "bootstrap") {
			const value = cap.bootstrap_token_file && (await readEnvValue(ctx, cap.bootstrap_token_file, "CLOUDFLARE_BOOTSTRAP_TOKEN"));
			if (!value) throw new Blocked(`no CLOUDFLARE_BOOTSTRAP_TOKEN in ${cap.bootstrap_token_file}`, BOOTSTRAP_GATE);
			return value;
		}
		const value = process.env.CLOUDFLARE_API_TOKEN || (cap.token_file && (await readEnvValue(ctx, cap.token_file, "CLOUDFLARE_API_TOKEN")));
		if (!value) throw new Blocked(`no CLOUDFLARE_API_TOKEN in ${cap.token_file}`, cap.bootstrap_token_file ? BOOTSTRAP_GATE : TOKEN_GATE);
		return value;
	});
}

async function api(ctx, cap, path, { method = "GET", body, as = "agent", bearer } = {}) {
	const response = await ctx.fetch(`${API}${path}`, {
		method,
		headers: { authorization: `Bearer ${bearer ?? (await token(ctx, cap, as))}`, ...(body && { "content-type": "application/json" }) },
		...(body && { body: JSON.stringify(body) }),
	});
	const reply = await response.json().catch(() => ({}));
	if (response.status === 401 || response.status === 403)
		throw new Blocked(
			`Cloudflare refused ${method} ${path.split("?")[0]} (${response.status}); the ${as === "bootstrap" ? "bootstrap" : "agent's"} token lacks this permission`,
			as === "bootstrap" || cap.bootstrap_token_file ? BOOTSTRAP_GATE : TOKEN_GATE,
		);
	if (!response.ok || reply.success === false) throw new Error(`Cloudflare ${method} ${path.split("?")[0]}: ${reply.errors?.[0]?.message ?? response.status}`);
	return reply.result;
}

export { api as cfApi };

// The root MX/SPF that Cloudflare Email Routing needs, and whether anything else receives mail there.
export async function routingRecords(ctx, cap) {
	const z = await zone(ctx, cap);
	const mx = await api(ctx, cap, `/zones/${z.id}/dns_records?type=MX&name=${encodeURIComponent(ctx.stack.domain)}`);
	const txt = await api(ctx, cap, `/zones/${z.id}/dns_records?type=TXT&name=${encodeURIComponent(ctx.stack.domain)}`);
	const ours = mx.filter((r) => /^route\d\.mx\.cloudflare\.net$/.test(r.content));
	return {
		cloudflare: ours.length >= 3 && txt.some((r) => r.content.includes("include:_spf.mx.cloudflare.net")),
		other: mx.filter((r) => !ours.includes(r)).map((r) => r.content),
		mx: ours.length,
	};
}

// Capabilities that publish a hostname through a Cloudflare Tunnel.
const tunnelled = (stack) => Object.entries(stack.capabilities).filter(([, c]) => c.ingress === "cloudflare-tunnel" && c.hostname);

export async function zone(ctx, cap) {
	return ctx.once("cloudflare.zone", async () => {
		const [found] = await api(ctx, cap, `/zones?name=${encodeURIComponent(ctx.stack.domain)}`);
		return found ?? null;
	});
}

async function tunnel(ctx, cap, accountId, name) {
	const known = ctx.state.resources[`cloudflare.tunnel.${name}`]?.id;
	if (known) return api(ctx, cap, `/accounts/${accountId}/cfd_tunnel/${known}`);
	const [found] = await api(ctx, cap, `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
	return found ?? null;
}

const fqdn = (stack, name) => (name === "@" || name === stack.domain ? stack.domain : name.endsWith(`.${stack.domain}`) ? name : `${name}.${stack.domain}`);
const sameContent = (a, b) => a.replace(/^"|"$/g, "").toLowerCase() === b.replace(/^"|"$/g, "").toLowerCase();

async function existing(ctx, cap, zoneId, record) {
	return api(ctx, cap, `/zones/${zoneId}/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`);
}

// Records another adapter needs (for example Resend's DKIM and SPF). Each is
// created only when missing; a different value already there is a conflict to
// resolve by hand, never something to overwrite.
export async function missingRecords(ctx, cap, records) {
	const z = await zone(ctx, cap);
	if (!z) throw new Error(`no zone for ${ctx.stack.domain} on this token`);
	const out = [];
	for (const wanted of records) {
		const record = { ...wanted, name: fqdn(ctx.stack, wanted.name) };
		const found = await existing(ctx, cap, z.id, record);
		if (found.some((r) => sameContent(r.content, record.content))) continue;
		if (["CNAME"].includes(record.type) && found.length) throw new Blocked(`${record.name} already has a ${record.type} to ${found[0].content}; resolve it by hand`);
		out.push(record);
	}
	return out;
}

export async function ensureRecords(ctx, cap, records, owner) {
	const z = await zone(ctx, cap);
	const created = [];
	for (const record of await missingRecords(ctx, cap, records)) {
		const result = await api(ctx, cap, `/zones/${z.id}/dns_records`, {
			method: "POST",
			body: {
				type: record.type,
				name: record.name,
				content: record.content,
				ttl: record.ttl ?? 1,
				proxied: record.proxied ?? false,
				...(record.priority !== undefined && { priority: record.priority }),
				comment: `stack-setup: ${owner}`,
			},
		});
		recordCreated(ctx, `cloudflare.record.${result.id}`, "cloudflare", { id: result.id, zone: z.id, type: record.type, name: record.name, for: owner });
		created.push(record);
	}
	return created;
}

// The connector token a new host needs. Returned to the caller only, never printed.
export async function tunnelToken(ctx, cap, name) {
	const z = await zone(ctx, cap);
	const t = await tunnel(ctx, cap, z.account.id, name);
	if (!t) throw new Blocked(`no tunnel named ${name}`);
	return api(ctx, cap, `/accounts/${z.account.id}/cfd_tunnel/${t.id}/token`);
}

// What the agent's token must allow, from the capabilities that use this zone.
// Names are Cloudflare's permission groups; they're looked up by name when minting.
export function requiredPermissions(stack, { enableRouting = false } = {}) {
	const zoneLevel = ["Zone Read", "DNS Write"];
	const accountLevel = [];
	if (tunnelled(stack).length) accountLevel.push("Cloudflare Tunnel Write");
	if (Object.values(stack.capabilities).some((c) => c.provider === "cloudflare-email-routing")) {
		zoneLevel.push("Email Routing Rules Write", "Zone Settings Read");
		accountLevel.push("Email Routing Addresses Write");
		if (enableRouting) zoneLevel.push("Zone Settings Write");
	}
	return { zone: [...new Set(zoneLevel)].sort(), account: [...new Set(accountLevel)].sort() };
}

const permissionKey = (p) => JSON.stringify({ zone: [...p.zone].sort(), account: [...p.account].sort() });

// Zone and account IDs without the agent's token: from state, or by minting a
// short-lived read-only lookup token with the bootstrap token, then revoking it.
async function zoneIds(ctx, cap) {
	const known = ctx.state.resources["cloudflare.zone"];
	if (known?.id && known.account) return { zoneId: known.id, accountId: known.account };
	const agent = await zone(ctx, cap).catch(() => null);
	if (agent) return { zoneId: agent.id, accountId: agent.account.id };
	const groups = await api(ctx, cap, "/user/tokens/permission_groups", { as: "bootstrap" });
	const read = groups.find((g) => g.name === "Zone Read");
	if (!read) throw new Blocked('Cloudflare\'s permission groups have no "Zone Read"');
	const temp = await api(ctx, cap, "/user/tokens", {
		method: "POST",
		as: "bootstrap",
		body: {
			name: `stack-setup ${ctx.stack.app} lookup (deleted after use)`,
			policies: [{ effect: "allow", resources: { "com.cloudflare.api.account.zone.*": "*" }, permission_groups: [{ id: read.id }] }],
		},
	});
	try {
		const [found] = await api(ctx, cap, `/zones?name=${encodeURIComponent(ctx.stack.domain)}`, { bearer: temp.value });
		if (!found) throw new Blocked(`no Cloudflare zone for ${ctx.stack.domain}; add the site in the dashboard first`);
		return { zoneId: found.id, accountId: found.account.id };
	} finally {
		await api(ctx, cap, `/user/tokens/${temp.id}`, { method: "DELETE", as: "bootstrap" });
	}
}

// For a rare job the agent's token deliberately lacks (switching a zone feature
// off during teardown): a token with just that, used once, then revoked.
export async function withTemporaryToken(ctx, cap, zoneNames, fn) {
	const groups = await api(ctx, cap, "/user/tokens/permission_groups", { as: "bootstrap" });
	const { zoneId } = await zoneIds(ctx, cap);
	const ids = zoneNames.map((name) => {
		const g = groups.find((x) => x.name === name);
		if (!g) throw new Blocked(`Cloudflare has no permission group "${name}"`);
		return { id: g.id };
	});
	const temp = await api(ctx, cap, "/user/tokens", {
		method: "POST",
		as: "bootstrap",
		body: { name: `stack-setup ${ctx.stack.app} one-off (deleted after use)`, policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" }, permission_groups: ids }] },
	});
	try {
		return await fn(temp.value);
	} finally {
		await api(ctx, cap, `/user/tokens/${temp.id}`, { method: "DELETE", as: "bootstrap" });
	}
}

async function mintAgentToken(ctx, cap, wanted) {
	const groups = await api(ctx, cap, "/user/tokens/permission_groups", { as: "bootstrap" });
	const pick = (names) =>
		names.map((name) => {
			const g = groups.find((x) => x.name === name);
			if (!g) {
				const near = groups.filter((x) => x.name.toLowerCase().includes(name.split(" ")[0].toLowerCase())).map((x) => x.name);
				throw new Blocked(`Cloudflare has no permission group "${name}"${near.length ? `; similar: ${near.slice(0, 5).join(", ")}` : ""}`);
			}
			return { id: g.id };
		});
	const { zoneId, accountId } = await zoneIds(ctx, cap);
	// The current token, if any, is replaced; its ID is read before the file changes.
	const old = await api(ctx, cap, "/user/tokens/verify").catch(() => null);
	const made = await api(ctx, cap, "/user/tokens", {
		method: "POST",
		as: "bootstrap",
		body: {
			name: `stack-setup ${ctx.stack.app} agent`,
			policies: [
				{ effect: "allow", resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" }, permission_groups: pick(wanted.zone) },
				...(wanted.account.length ? [{ effect: "allow", resources: { [`com.cloudflare.api.account.${accountId}`]: "*" }, permission_groups: pick(wanted.account) }] : []),
			],
		},
	});
	if (!made?.id || typeof made.value !== "string") throw new Error("Cloudflare did not return the new token");
	for (let attempt = 0; ; attempt++) {
		const check = await api(ctx, cap, "/user/tokens/verify", { bearer: made.value }).catch(() => null);
		if (check?.status === "active") break;
		if (attempt >= 4) throw new Error("the new Cloudflare token isn't active yet; the old one was kept");
		await ctx.sleep(3000);
	}
	await assertPrivateLocation(ctx, cap.token_file);
	const before = await ctx.readText(cap.token_file).catch(() => "");
	await ctx.writeSecretFile(cap.token_file, updateEnv(before, { CLOUDFLARE_API_TOKEN: made.value }));
	ctx.cache.clear();
	recordCreated(ctx, AGENT_TOKEN, "cloudflare", { id: made.id, name: `stack-setup ${ctx.stack.app} agent`, permissions: wanted, credential: true });
	ctx.state.resources["cloudflare.zone"] ??= { id: zoneId, account: accountId, name: ctx.stack.domain };
	if (old?.id && old.id !== made.id) await api(ctx, cap, `/user/tokens/${old.id}`, { method: "DELETE", as: "bootstrap" });
	return { id: made.id, replaced: old?.id ?? null };
}

export default {
	provider: "cloudflare",
	missingRecords,
	ensureRecords,
	tunnelToken,
	tools: [],
	validate(cap) {
		const errors = [];
		if (!cap.token_file && !process.env.CLOUDFLARE_API_TOKEN) errors.push("token_file: path of an env file holding CLOUDFLARE_API_TOKEN");
		if (cap.bootstrap_token_file !== undefined && !cap.token_file) errors.push("token_file: where the agent's minted token is kept");
		if (cap.bootstrap_token_file !== undefined && cap.bootstrap_token_file === cap.token_file) errors.push("bootstrap_token_file must differ from token_file");
		return errors;
	},
	gates(cap, stack, name) {
		const gates = cap.bootstrap_token_file
			? [
					{
						id: BOOTSTRAP_GATE,
						bundle: "preflight",
						type: "consent",
						who: "you",
						title: "Create one Cloudflare token the agent uses to make its own",
						where: "https://dash.cloudflare.com/profile/api-tokens",
						steps: [
							'Create Token → the "Create additional tokens" template → Use template',
							"Leave its permission as it is (API Tokens: Edit); add nothing else → Continue to summary → Create Token",
							"Hand it back with secure-key-handoff, then: stack gates pickup cloudflare.bootstrap --file <the decrypted file> --confirm",
						],
						receive: ["CLOUDFLARE_BOOTSTRAP_TOKEN"],
						pickupTo: cap.bootstrap_token_file,
						note: "It can create tokens, so it stays only on this computer (0600), never in the repo or on a server. The agent mints its own narrow token with it, and replaces that token when the stack needs more. Revoke it any time; the agent's token keeps working.",
						closedBy: "cloudflare.bootstrap",
					},
				]
			: [
					{
						id: TOKEN_GATE,
						bundle: "preflight",
						type: "consent",
						title: "Create a Cloudflare API token for this zone",
						link: "https://dash.cloudflare.com/profile/api-tokens",
						prefill: { permissions: "Zone Read, DNS Edit, Cloudflare Tunnel Edit", zone: "this domain only" },
						receive: ["CLOUDFLARE_API_TOKEN"],
						note: "Or add bootstrap_token_file: to stack.yaml, and the agent mints its own tokens from one you create once.",
						closedBy: "cloudflare.login",
					},
				];
		if (cap.registrar && cap.registrar !== "cloudflare")
			gates.push({
				id: `${name}.nameservers`,
				bundle: "app",
				type: "console",
				title: `Point the domain's nameservers at Cloudflare in ${cap.registrar}`,
				closedBy: `${name}.zone`,
			});
		return gates;
	},
	async doctor(ctx, name, cap) {
		const result = await api(ctx, cap, "/user/tokens/verify");
		return [{ id: "cloudflare.login", status: result?.status === "active" ? GREEN : RED, detail: `token ${result?.status ?? "unknown"}` }];
	},
	async import(ctx, name, cap) {
		const found = await zone(ctx, cap);
		if (!found) return [];
		const out = [{ key: "cloudflare.zone", fields: { id: found.id, name: found.name, account: found.account?.id } }];
		for (const [, other] of tunnelled(ctx.stack)) {
			const t = await tunnel(ctx, cap, found.account.id, other.tunnel);
			if (t) out.push({ key: `cloudflare.tunnel.${other.tunnel}`, fields: { id: t.id, name: t.name } });
		}
		return out;
	},
	async plan(ctx, name, cap) {
		const steps = [];
		if (cap.bootstrap_token_file) {
			const hasBootstrap = await token(ctx, cap, "bootstrap").then(
				() => true,
				() => false,
			);
			const routingOff = Object.values(ctx.stack.capabilities).some((c) => c.provider === "cloudflare-email-routing") && !(await routingRecords(ctx, cap).catch(() => null))?.cloudflare;
			const wanted = requiredPermissions(ctx.stack, { enableRouting: routingOff });
			const recorded = ctx.state.resources[AGENT_TOKEN];
			const describe = `${[...wanted.zone, ...wanted.account].join(", ")}`;
			if (recorded && permissionKey(recorded.permissions) === permissionKey(wanted)) steps.push({ id: `${name}.agent-token`, kind: "noop", summary: `the agent's own token (${describe})` });
			else if (!hasBootstrap) steps.push({ id: `${name}.agent-token`, kind: "blocked", summary: `the agent's token needs ${describe}; hand over the bootstrap token first`, gate: BOOTSTRAP_GATE });
			else
				steps.push({
					id: `${name}.agent-token`,
					kind: recorded ? "update" : "create",
					summary: `the agent's own token with ${describe}, limited to this zone and account; it replaces and revokes the current one`,
					run: () => mintAgentToken(ctx, cap, wanted),
					replan: true,
				});
		}
		const z = await zone(ctx, cap).catch((error) => {
			if (cap.bootstrap_token_file && error instanceof Blocked) return undefined;
			throw error;
		});
		if (z === undefined) return steps; // the agent token comes first; the rest is planned after it exists
		if (!z) return [...steps, { id: `${name}.zone`, kind: "blocked", summary: `add ${ctx.stack.domain} to Cloudflare first (the zone is a console step)` }];
		try {
			await planTunnels(ctx, name, cap, z, steps);
		} catch (error) {
			// Missing permissions that the planned token step adds don't hide that step.
			if (!(error instanceof Blocked) || !steps.some((s) => s.replan)) throw error;
			steps.push({ id: `${name}.tunnels`, kind: "blocked", summary: error.message, gate: error.gate });
		}
		return steps;
	},
	async remove(ctx, key, resource) {
		return removeResource(ctx, key, resource);
	},
	async verify(ctx, name, cap) {
		return verifyZone(ctx, name, cap);
	},
};

async function planTunnels(ctx, name, cap, z, steps) {
	for (const [capName, other] of tunnelled(ctx.stack)) {
		const t = await tunnel(ctx, cap, z.account.id, other.tunnel);
		if (!t) {
			steps.push({ id: `${capName}.tunnel`, kind: "blocked", summary: `no tunnel named ${other.tunnel}; host bootstrap (M3) creates it` });
			continue;
		}
		const record = { type: "CNAME", name: `${other.hostname}.${ctx.stack.domain}`, content: `${t.id}.cfargotunnel.com`, proxied: true };
		const missing = await missingRecords(ctx, cap, [record]);
		steps.push(
			missing.length
				? { id: `${capName}.dns`, kind: "create", summary: `CNAME ${record.name} → tunnel ${t.name} (proxied)`, run: () => ensureRecords(ctx, cap, [record], capName) }
				: { id: `${capName}.dns`, kind: "noop", summary: `CNAME ${record.name} → tunnel ${t.name}` },
		);
	}
}

async function removeResource(ctx, key, resource) {
	const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "cloudflare");
	if (key === AGENT_TOKEN) {
		await api(ctx, cap, `/user/tokens/${resource.id}`, { method: "DELETE", as: "bootstrap" });
		const before = await ctx.readText(cap.token_file).catch(() => "");
		await ctx.writeSecretFile(cap.token_file, updateEnv(before, {}, ["CLOUDFLARE_API_TOKEN"]));
		return `Cloudflare token ${resource.name} (revoked)`;
	}
	await api(ctx, cap, `/zones/${resource.zone}/dns_records/${resource.id}`, { method: "DELETE" });
	return `${resource.type} ${resource.name}`;
}

async function verifyZone(ctx, name, cap) {
	const checks = [];
	if (cap.bootstrap_token_file) {
		const boot = await api(ctx, cap, "/user/tokens/verify", { as: "bootstrap" }).catch((error) => error);
		checks.push(
			boot instanceof Error
				? { id: "cloudflare.bootstrap", status: "blocked", detail: boot.message, gate: BOOTSTRAP_GATE }
				: { id: "cloudflare.bootstrap", status: boot.status === "active" ? GREEN : RED, detail: `bootstrap token ${boot.status}` },
		);
		const recorded = ctx.state.resources[AGENT_TOKEN];
		const current = await api(ctx, cap, "/user/tokens/verify").catch(() => null);
		const wanted = requiredPermissions(ctx.stack);
		const fits = recorded && current?.id === recorded.id && [...wanted.zone, ...wanted.account].every((n) => [...recorded.permissions.zone, ...recorded.permissions.account].includes(n));
		checks.push({
			id: `${name}.agent-token`,
			status: fits ? GREEN : RED,
			detail: fits
				? `the agent's own token, ${[...recorded.permissions.zone, ...recorded.permissions.account].length} permissions`
				: recorded
					? "the token in use isn't the one the agent minted, or lacks what the stack needs; run stack apply"
					: "not minted yet; run stack apply",
		});
	}
	const z = await zone(ctx, cap);
	checks.push({ id: "cloudflare.login", status: GREEN, detail: "token accepted" });
	if (!z) return [...checks, { id: `${name}.zone`, status: RED, detail: `no zone for ${ctx.stack.domain} on this token` }];
	checks.push({
		id: `${name}.zone`,
		status: z.status === "active" ? GREEN : RED,
		detail: `${z.name} ${z.status}, nameservers ${(z.name_servers ?? []).join(", ")}`,
	});
	for (const [capName, other] of tunnelled(ctx.stack)) {
		const fqdn = `${other.hostname}.${ctx.stack.domain}`;
		const t = await tunnel(ctx, cap, z.account.id, other.tunnel);
		if (!t) {
			checks.push({ id: `${capName}.tunnel`, status: RED, detail: `no tunnel named ${other.tunnel}` });
			continue;
		}
		const connections = (t.connections ?? []).length;
		checks.push({
			id: `${capName}.tunnel`,
			status: t.status === "healthy" ? GREEN : RED,
			detail: `tunnel ${t.name} ${t.status}, ${connections} connection${connections === 1 ? "" : "s"}`,
		});
		const config = await api(ctx, cap, `/accounts/${z.account.id}/cfd_tunnel/${t.id}/configurations`);
		const rule = (config?.config?.ingress ?? []).find((r) => r.hostname === fqdn);
		checks.push({
			id: `${capName}.ingress`,
			status: rule ? GREEN : RED,
			detail: rule ? `${fqdn} → ${rule.service}` : `tunnel has no ingress rule for ${fqdn}`,
		});
		const [record] = await api(ctx, cap, `/zones/${z.id}/dns_records?type=CNAME&name=${encodeURIComponent(fqdn)}`);
		const target = `${t.id}.cfargotunnel.com`;
		checks.push({
			id: `${capName}.dns`,
			status: record?.content === target && record.proxied ? GREEN : RED,
			detail: record ? `${fqdn} CNAME ${record.content === target ? "→ tunnel" : record.content}${record.proxied ? ", proxied" : ", not proxied"}` : `no CNAME for ${fqdn}`,
		});
	}
	return checks;
}
