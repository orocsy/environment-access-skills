import { Blocked, GREEN, RED, readEnvValue } from "../lib/context.mjs";

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

async function api(ctx, cap, path) {
	const response = await ctx.fetch(`${API}${path}`, {
		headers: { authorization: `Bearer ${await token(ctx, cap)}` },
	});
	const body = await response.json().catch(() => ({}));
	if (response.status === 401 || response.status === 403)
		throw new Blocked(`Cloudflare refused ${path.split("?")[0]} (${response.status}); the token lacks this permission`, TOKEN_GATE);
	if (!response.ok || body.success === false)
		throw new Error(`Cloudflare ${path.split("?")[0]}: ${body.errors?.[0]?.message ?? response.status}`);
	return body.result;
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

export default {
	provider: "cloudflare",
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
