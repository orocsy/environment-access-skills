import { GREEN, RED } from "../lib/context.mjs";

const LOGIN_GATE = "resend.login";
const resend = (ctx, cap, args) => ctx.json("resend", [...args, "--profile", cap.profile, "--json"], { gate: LOGIN_GATE });
const domainName = (ctx, cap) => `${cap.subdomain}.${ctx.stack.domain}`;

async function findDomain(ctx, cap) {
	const known = ctx.state.resources["resend.domain"]?.id;
	if (known) return resend(ctx, cap, ["domains", "get", known]);
	const { data = [] } = await resend(ctx, cap, ["domains", "list"]);
	const found = data.find((d) => d.name === domainName(ctx, cap));
	return found ? resend(ctx, cap, ["domains", "get", found.id]) : null;
}

export default {
	provider: "resend",
	tools: [{ cmd: "resend", args: ["--version"] }],
	validate(cap) {
		const errors = [];
		if (!/^[a-z0-9-]+$/.test(cap.profile ?? "")) errors.push("profile: the resend CLI profile for this app");
		if (!/^[a-z0-9-]+$/.test(cap.subdomain ?? "")) errors.push("subdomain: the sending subdomain, like mail");
		return errors;
	},
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
	async import(ctx, name, cap) {
		const domain = await findDomain(ctx, cap);
		if (!domain) return [];
		const { data: keys = [] } = await resend(ctx, cap, ["api-keys", "list"]);
		return [
			{ key: "resend.domain", fields: { id: domain.id, name: domain.name, region: domain.region } },
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
