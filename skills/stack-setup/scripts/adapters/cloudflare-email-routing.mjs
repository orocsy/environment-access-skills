// Forwarding mail at the app's domain (support@, hello@ …) to real inboxes with
// Cloudflare Email Routing. It uses the DNS capability's token (named by `on:`).
// A destination address must confirm Cloudflare's email once; that's the only
// step a person does, and it closes itself when the address shows as verified.
import { Blocked, GREEN, RED } from "../lib/context.mjs";
import { recordCreated } from "../lib/state.mjs";
import { cfApi, routingRecords, withTemporaryToken, zone } from "./cloudflare.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const routesOf = (cap) => Object.entries(cap.routes ?? {}).map(([local, to]) => ({ local, to: [to].flat() }));
const dnsCap = (ctx, cap) => ctx.stack.capabilities[cap.on];
const ruleName = (local, to) => `${local} to ${to.join(", ")} (stack-setup)`;

async function state(ctx, cap) {
	const dns = dnsCap(ctx, cap);
	const z = await zone(ctx, dns);
	if (!z) throw new Blocked(`no Cloudflare zone for ${ctx.stack.domain}`);
	const [records, rules, addresses] = await Promise.all([
		routingRecords(ctx, dns),
		cfApi(ctx, dns, `/zones/${z.id}/email/routing/rules`),
		cfApi(ctx, dns, `/accounts/${z.account.id}/email/routing/addresses`),
	]);
	return { z, records, rules, addresses };
}

const findRule = (rules, address) => rules.find((r) => (r.matchers ?? []).some((m) => m.type === "literal" && m.field === "to" && m.value === address));
const forwardsTo = (rule) => (rule?.actions ?? []).filter((a) => a.type === "forward").flatMap((a) => a.value ?? []);
const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();

export default {
	provider: "cloudflare-email-routing",
	tools: [],
	validate(cap, stack) {
		const errors = [];
		if (stack.capabilities?.[cap.on]?.provider !== "cloudflare") errors.push("on: the Cloudflare DNS capability whose token this uses");
		const routes = routesOf(cap);
		if (!routes.length) errors.push("routes: { support: you@example.com }");
		for (const r of routes) {
			if (!/^[a-z0-9._+-]+$/i.test(r.local)) errors.push(`routes.${r.local}: the part before @`);
			if (!r.to.every((t) => EMAIL.test(t))) errors.push(`routes.${r.local}: an email address to forward to`);
		}
		return errors;
	},
	gates(cap, stack, name) {
		return [...new Set(routesOf(cap).flatMap((r) => r.to))].map((to) => ({
			id: `${name}.confirm.${to}`,
			track: "email",
			bundle: "app",
			type: "consent",
			who: `whoever reads ${to}`,
			title: `Confirm ${to} as a forwarding address`,
			where: `the inbox of ${to}: an email from Cloudflare, "Verify your email address"`,
			steps: ["Open the email from Cloudflare", "Click the verification link", "Nothing else: the next stack verify sees it"],
			takes: "a minute, after stack apply adds the address",
			closedBy: `${name}.destination.${to}`,
		}));
	},
	async import(ctx, name, cap) {
		const { z, rules, addresses } = await state(ctx, cap);
		const out = [];
		for (const r of routesOf(cap)) {
			const rule = findRule(rules, `${r.local}@${ctx.stack.domain}`);
			if (rule) out.push({ key: `cloudflare.email-rule.${rule.id}`, fields: { id: rule.id, zone: z.id, name: rule.name || `${r.local}@` } });
		}
		for (const a of addresses.filter((a) => routesOf(cap).some((r) => r.to.includes(a.email))))
			out.push({ key: `cloudflare.email-address.${a.id}`, fields: { id: a.id, account: z.account.id, name: a.email } });
		return out;
	},
	async plan(ctx, name, cap) {
		const dns = dnsCap(ctx, cap);
		const { z, records, rules, addresses } = await state(ctx, cap);
		const steps = [];
		if (!records.cloudflare) {
			if (records.other.length)
				return [{ id: `${name}.routing`, kind: "blocked", summary: `${ctx.stack.domain} already receives mail at ${records.other.join(", ")}; move it or remove those MX records by hand first` }];
			steps.push({
				id: `${name}.routing`,
				kind: "create",
				summary: `turn on Email Routing for ${ctx.stack.domain} (Cloudflare adds its MX and SPF records)`,
				replan: true, // once it's on, the agent's token no longer needs Zone Settings Write
				run: async () => {
					await cfApi(ctx, dns, `/zones/${z.id}/email/routing/enable`, { method: "POST", body: {} });
					recordCreated(ctx, `cloudflare.email-routing.${z.id}`, "cloudflare-email-routing", { id: z.id, zone: z.id, name: `Email Routing on ${ctx.stack.domain}` });
				},
			});
		} else steps.push({ id: `${name}.routing`, kind: "noop", summary: `Email Routing on for ${ctx.stack.domain}` });
		for (const to of [...new Set(routesOf(cap).flatMap((r) => r.to))]) {
			const found = addresses.find((a) => a.email === to);
			steps.push(
				found
					? { id: `${name}.destination.${to}`, kind: "noop", summary: `${to}${found.verified ? " (confirmed)" : " (waiting for its confirmation email)"}` }
					: {
							id: `${name}.destination.${to}`,
							kind: "create",
							summary: `add ${to} as a forwarding address; Cloudflare emails it a confirmation link`,
							run: async () => {
								const made = await cfApi(ctx, dns, `/accounts/${z.account.id}/email/routing/addresses`, { method: "POST", body: { email: to } });
								recordCreated(ctx, `cloudflare.email-address.${made.id ?? made.tag}`, "cloudflare-email-routing", { id: made.id ?? made.tag, account: z.account.id, name: to });
							},
						},
			);
		}
		for (const r of routesOf(cap)) {
			const address = `${r.local}@${ctx.stack.domain}`;
			const rule = findRule(rules, address);
			const body = { name: ruleName(r.local, r.to), enabled: true, matchers: [{ type: "literal", field: "to", value: address }], actions: [{ type: "forward", value: r.to }] };
			if (!rule)
				steps.push({
					id: `${name}.route.${r.local}`,
					kind: "create",
					summary: `forward ${address} → ${r.to.join(", ")}`,
					run: async () => {
						const made = await cfApi(ctx, dns, `/zones/${z.id}/email/routing/rules`, { method: "POST", body });
						recordCreated(ctx, `cloudflare.email-rule.${made.id ?? made.tag}`, "cloudflare-email-routing", { id: made.id ?? made.tag, zone: z.id, name: address });
					},
				});
			else if (!rule.enabled || !sameSet(forwardsTo(rule), r.to))
				steps.push({
					id: `${name}.route.${r.local}`,
					kind: "update",
					summary: `forward ${address} → ${r.to.join(", ")} (now ${rule.enabled ? forwardsTo(rule).join(", ") || "no forward" : "off"})`,
					run: () => cfApi(ctx, dns, `/zones/${z.id}/email/routing/rules/${rule.id ?? rule.tag}`, { method: "PUT", body: { ...body, name: rule.name || body.name } }),
				});
			else steps.push({ id: `${name}.route.${r.local}`, kind: "noop", summary: `${address} → ${r.to.join(", ")}` });
		}
		return steps;
	},
	async remove(ctx, key, resource) {
		const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "cloudflare-email-routing");
		const dns = dnsCap(ctx, cap);
		if (key.startsWith("cloudflare.email-rule.")) {
			await cfApi(ctx, dns, `/zones/${resource.zone}/email/routing/rules/${resource.id}`, { method: "DELETE" });
			return `forwarding rule for ${resource.name}`;
		}
		if (key.startsWith("cloudflare.email-address.")) {
			await cfApi(ctx, dns, `/accounts/${resource.account}/email/routing/addresses/${resource.id}`, { method: "DELETE" });
			return `forwarding address ${resource.name}`;
		}
		const disable = (bearer) => cfApi(ctx, dns, `/zones/${resource.zone}/email/routing/disable`, { method: "POST", body: {}, bearer });
		await disable().catch(async (error) => {
			if (!(error instanceof Blocked) || !dns.bootstrap_token_file) throw error;
			await withTemporaryToken(ctx, dns, ["Zone Settings Write"], disable);
		});
		return resource.name;
	},
	async verify(ctx, name, cap) {
		const { records, rules, addresses } = await state(ctx, cap);
		const checks = [
			{
				id: `${name}.routing`,
				status: records.cloudflare ? GREEN : RED,
				detail: records.cloudflare ? `${ctx.stack.domain} receives mail through Cloudflare (${records.mx} MX, SPF)` : records.other.length ? `mail goes to ${records.other.join(", ")}` : "Email Routing isn't on",
			},
		];
		for (const to of [...new Set(routesOf(cap).flatMap((r) => r.to))]) {
			const a = addresses.find((x) => x.email === to);
			checks.push({
				id: `${name}.destination.${to}`,
				status: a?.verified ? GREEN : RED,
				detail: a ? (a.verified ? `${to} confirmed ${String(a.verified).slice(0, 10)}` : `${to} hasn't confirmed Cloudflare's email yet`) : `${to} isn't a forwarding address yet`,
			});
		}
		for (const r of routesOf(cap)) {
			const address = `${r.local}@${ctx.stack.domain}`;
			const rule = findRule(rules, address);
			const ok = rule?.enabled && sameSet(forwardsTo(rule), r.to);
			checks.push({
				id: `${name}.route.${r.local}`,
				status: ok ? GREEN : RED,
				detail: rule ? `${address} → ${forwardsTo(rule).join(", ") || "nothing"}${rule.enabled ? "" : " (rule off)"}` : `no rule for ${address}`,
			});
		}
		return checks;
	},
};
