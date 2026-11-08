import { Blocked, GREEN, RED, readEnvValue } from "../lib/context.mjs";
import { recordCreated } from "../lib/state.mjs";

const API = "https://api.cloudflare.com/client/v4";
const TOKEN_GATE = "cloudflare.token";

async function token(ctx, cap) {
	return ctx.once("cloudflare.token", async () => {
		const value =
			process.env.CLOUDFLARE_API_TOKEN ||
			(cap.token_file && (await readEnvValue(ctx, cap.token_file, "CLOUDFLARE_API_TOKEN")));
		if (!value) throw new Blocked(`no CLOUDFLARE_API_TOKEN in ${cap.token_file}`, TOKEN_GATE);
		return value;
	});
}

async function api(ctx, cap, path, { method = "GET", body } = {}) {
	const response = await ctx.fetch(`${API}${path}`, {
		method,
		headers: { authorization: `Bearer ${await token(ctx, cap)}`, ...(body && { "content-type": "application/json" }) },
		...(body && { body: JSON.stringify(body) }),
	});
	const reply = await response.json().catch(() => ({}));
	if (response.status === 401 || response.status === 403)
		throw new Blocked(`Cloudflare refused ${method} ${path.split("?")[0]} (${response.status}); the token lacks this permission`, TOKEN_GATE);
	if (!response.ok || reply.success === false)
		throw new Error(`Cloudflare ${method} ${path.split("?")[0]}: ${reply.errors?.[0]?.message ?? response.status}`);
	return reply.result;
}

// Capabilities that publish a hostname through a Cloudflare Tunnel.
const tunnelled = (stack) =>
	Object.entries(stack.capabilities).filter(([, c]) => c.ingress === "cloudflare-tunnel" && c.hostname);

async function zone(ctx, cap) {
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
		if (["CNAME"].includes(record.type) && found.length)
			throw new Blocked(`${record.name} already has a ${record.type} to ${found[0].content}; resolve it by hand`);
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

export default {
	provider: "cloudflare",
	missingRecords,
	ensureRecords,
	tools: [],
	validate(cap) {
		const errors = [];
		if (!cap.token_file && !process.env.CLOUDFLARE_API_TOKEN)
			errors.push("token_file: path of an env file holding CLOUDFLARE_API_TOKEN");
		return errors;
	},
	gates(cap, stack, name) {
		const gates = [
			{
				id: TOKEN_GATE,
				bundle: "preflight",
				type: "consent",
				title: "Create a Cloudflare API token for this zone",
				link: "https://dash.cloudflare.com/profile/api-tokens",
				prefill: { permissions: "Zone Read, DNS Edit, Cloudflare Tunnel Edit", zone: "this domain only" },
				receive: ["CLOUDFLARE_API_TOKEN"],
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
		const z = await zone(ctx, cap);
		if (!z) return [{ id: `${name}.zone`, kind: "blocked", summary: `add ${ctx.stack.domain} to Cloudflare first (the zone is a console step)` }];
		const steps = [];
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
		return steps;
	},
	async remove(ctx, key, resource) {
		const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "cloudflare");
		await api(ctx, cap, `/zones/${resource.zone}/dns_records/${resource.id}`, { method: "DELETE" });
		return `${resource.type} ${resource.name}`;
	},
	async verify(ctx, name, cap) {
		const checks = [];
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
				detail: record
					? `${fqdn} CNAME ${record.content === target ? "→ tunnel" : record.content}${record.proxied ? ", proxied" : ", not proxied"}`
					: `no CNAME for ${fqdn}`,
			});
		}
		return checks;
	},
};
