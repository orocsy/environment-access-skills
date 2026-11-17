// Tencent Cloud adapters (read-only, C1): DNSPod and Lighthouse, through Tencent's
// official CLI, tccli, which prints JSON. The owner signs in once with
// `tccli auth login`; a narrow CAM agent key comes in C3.
import { GREEN, RED } from "../lib/context.mjs";
import { publicUrl } from "../lib/schema.mjs";

const LOGIN_GATE = "tencent.login";
const tc = (ctx, cap, service, action, params = {}) =>
	ctx.json(
		"tccli",
		[service, action, ...(cap.region ? ["--region", cap.region] : []), ...(cap.profile ? ["--profile", cap.profile] : []), ...Object.entries(params).flatMap(([k, v]) => [`--${k}`, typeof v === "string" ? v : JSON.stringify(v)])],
		{ gate: LOGIN_GATE },
	);

const loginGate = {
	id: LOGIN_GATE,
	bundle: "preflight",
	type: "consent",
	title: "Sign in to Tencent Cloud's CLI once",
	prefill: { install: "pip install tccli (asks first)", command: "tccli auth login" },
	note: "Opens the browser; approve once. Later the agent uses its own narrow CAM key.",
	closedBy: "tencent.login",
};

async function whoAmI(ctx, cap) {
	return ctx.once("tencent.whoami", async () => {
		const me = await tc(ctx, cap, "cam", "GetUserAppId");
		return [{ id: "tencent.login", status: GREEN, detail: `signed in, account ${me.OwnerUin ?? me.Uin}` }];
	});
}

export const dnspod = {
	provider: "dnspod",
	tools: [{ cmd: "tccli", args: ["--version"] }],
	validate() {
		return [];
	},
	gates: () => [loginGate],
	doctor: (ctx, name, cap) => whoAmI(ctx, cap),
	async import(ctx, name, cap) {
		const { DomainInfo: d } = await tc(ctx, cap, "dnspod", "DescribeDomain", { Domain: ctx.stack.domain });
		return d ? [{ key: `dnspod.domain.${d.Domain}`, fields: { id: d.DomainId, name: d.Domain } }] : [];
	},
	async verify(ctx, name, cap) {
		const checks = [...(await whoAmI(ctx, cap))];
		const result = await ctx.run("tccli", ["dnspod", "DescribeDomain", "--Domain", ctx.stack.domain, ...(cap.profile ? ["--profile", cap.profile] : [])]);
		if (result.code !== 0) return [...checks, { id: `${name}.domain`, status: RED, detail: `${ctx.stack.domain} isn't in this DNSPod account` }];
		const d = JSON.parse(result.stdout).DomainInfo;
		const delegated = (d.ActualNsList ?? []).length && (d.ActualNsList ?? []).every((ns) => (d.DnspodNsList ?? []).includes(ns));
		checks.push({
			id: `${name}.domain`,
			status: d.Status === "ENABLE" && delegated ? GREEN : RED,
			detail: `${d.Domain} ${d.Status === "ENABLE" ? "enabled" : d.Status}${delegated ? ", nameservers point at DNSPod" : `, nameservers are ${(d.ActualNsList ?? []).join(", ") || "unknown"}; expected ${(d.DnspodNsList ?? []).join(", ")}`}`,
		});
		// Each capability with a hostname should resolve to its server.
		for (const [capName, other] of Object.entries(ctx.stack.capabilities).filter(([, c]) => c.provider === "tencent-lighthouse" && c.hostname)) {
			const { RecordList: records = [] } = await tc(ctx, cap, "dnspod", "DescribeRecordList", { Domain: ctx.stack.domain, Subdomain: other.hostname });
			const ip = (await findInstance(ctx, capName, other).catch(() => null))?.PublicAddresses?.[0];
			const a = records.find((r) => r.Type === "A");
			checks.push({
				id: `${capName}.dns`,
				status: a && (!ip || a.Value === ip) ? GREEN : RED,
				detail: a ? `${other.hostname}.${ctx.stack.domain} A ${a.Value}${ip && a.Value !== ip ? `; the server is ${ip}` : ""}` : `no A record for ${other.hostname}.${ctx.stack.domain}`,
			});
		}
		return checks;
	},
};

export const lighthouse = {
	provider: "tencent-lighthouse",
	tools: [{ cmd: "tccli", args: ["--version"] }],
	validate(cap) {
		const errors = [];
		if (!/^ap-[a-z]+$/.test(cap.region ?? "")) errors.push("region: a Tencent region such as ap-guangzhou");
		if (cap.name !== undefined && !/^[A-Za-z0-9._-]{1,60}$/.test(cap.name)) errors.push("name: the Lighthouse instance's name");
		return errors;
	},
	gates: () => [loginGate],
	doctor: (ctx, name, cap) => whoAmI(ctx, cap),
	async import(ctx, name, cap) {
		const i = await findInstance(ctx, name, cap);
		return i ? [{ key: `lighthouse.instance.${i.InstanceName}`, fields: { id: i.InstanceId, region: cap.region, ip: i.PublicAddresses?.[0] ?? null } }] : [];
	},
	async verify(ctx, name, cap) {
		const checks = [...(await whoAmI(ctx, cap))];
		const i = await findInstance(ctx, name, cap);
		if (!i) return [...checks, { id: `${name}.instance`, status: RED, detail: `no Lighthouse instance named ${instanceName(ctx, name, cap)} in ${cap.region}` }];
		const ip = i.PublicAddresses?.[0];
		checks.push({ id: `${name}.instance`, status: i.InstanceState === "RUNNING" ? GREEN : RED, detail: `${i.InstanceId} ${i.InstanceState}, ${ip ?? "no public address"}` });
		// A filing needs prepaid billing, and a lapsed prepaid server stops serving the filed domain.
		const days = i.ExpiredTime ? Math.floor((Date.parse(i.ExpiredTime) - ctx.now()) / 86400000) : null;
		checks.push({
			id: `${name}.billing`,
			status: i.InstanceChargeType === "PREPAID" && (days === null || days >= 14) ? GREEN : RED,
			detail: `${i.InstanceChargeType === "PREPAID" ? "prepaid" : `${i.InstanceChargeType}; a filing needs prepaid billing`}${days !== null ? `, expires in ${days} days${days < 14 ? ": renew it" : ""}` : ""}`,
		});
		const { FirewallRuleSet: rules = [] } = await tc(ctx, cap, "lighthouse", "DescribeFirewallRules", { InstanceId: i.InstanceId });
		const open = [...new Set(rules.filter((r) => (r.Action ?? "ACCEPT") === "ACCEPT" && (r.CidrBlock ?? "0.0.0.0/0") === "0.0.0.0/0").map((r) => String(r.Port)))].sort();
		const extra = open.filter((p) => !["22", "80", "443"].includes(p));
		checks.push({ id: `${name}.firewall`, status: extra.length ? RED : GREEN, detail: `open to the internet: ${open.join(", ") || "nothing"}${extra.length ? `; not expected: ${extra.join(", ")}` : ""}` });
		const url = publicUrl(ctx.stack, name);
		if (url && cap.health) {
			const response = await ctx.fetch(`${url}${cap.health}`, { redirect: "manual" }).catch((error) => ({ status: error.message }));
			checks.push({ id: `${name}.health`, status: response.status === 200 ? GREEN : RED, detail: `${url}${cap.health} → ${response.status}` });
		}
		return checks;
	},
};

const instanceName = (ctx, name, cap) => cap.name ?? `${ctx.stack.app}-${name}`;

async function findInstance(ctx, name, cap) {
	return ctx.once(`lighthouse.instance.${name}`, async () => {
		const { InstanceSet: found = [] } = await tc(ctx, cap, "lighthouse", "DescribeInstances", { Filters: [{ Name: "instance-name", Values: [instanceName(ctx, name, cap)] }] });
		return found[0] ?? null;
	});
}
