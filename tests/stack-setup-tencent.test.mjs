import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../skills/stack-setup/scripts/stack.mjs";

// Recorded-shape tccli output with synthetic IDs; nothing reaches Tencent.
const STACK = `app: family-cn
domain: family-example.cn
jurisdiction: cn-mainland
profile: { subject: mainland-person, province: guangdong, forms: [api], commercial: false, children: false, data_leaves_mainland: false, domain: new }
capabilities:
  dns: { provider: dnspod }
  api_host: { provider: tencent-lighthouse, region: ap-guangzhou, hostname: api, health: /health }
`;

function tencent(world) {
	return async (cmd, args) => {
		world.calls.push([cmd, ...args]);
		if (cmd === "node") return { code: 0, stdout: "v22.13.0\n", stderr: "" };
		if (cmd !== "tccli") throw new Error(`unexpected ${cmd}`);
		if (args[0] === "--version") return { code: 0, stdout: "3.0.1400.1\n", stderr: "" };
		if (!world.signedIn) return { code: 1, stdout: "", stderr: "secretId is invalid" };
		const [service, action] = args;
		const json = (v) => ({ code: 0, stdout: JSON.stringify(v), stderr: "" });
		if (service === "cam" && action === "GetUserAppId") return json({ Uin: "100000000001", OwnerUin: "100000000001", AppId: 1250000000 });
		if (service === "dnspod" && action === "DescribeDomain")
			return world.domain ? json({ DomainInfo: { Domain: "family-example.cn", DomainId: 9001, Status: "ENABLE", ActualNsList: world.ns, DnspodNsList: ["a.dnspod.net", "b.dnspod.net"] } }) : { code: 1, stdout: "", stderr: "ResourceNotFound.NoDataOfDomain" };
		if (service === "dnspod" && action === "DescribeRecordList") return json({ RecordList: world.records });
		if (service === "lighthouse" && action === "DescribeInstances")
			return json({ InstanceSet: world.instance ? [world.instance] : [], TotalCount: world.instance ? 1 : 0 });
		if (service === "lighthouse" && action === "DescribeFirewallRules") return json({ FirewallRuleSet: world.rules });
		throw new Error(`unexpected tccli ${service} ${action}`);
	};
}

const healthy = () => ({
	calls: [],
	signedIn: true,
	domain: true,
	ns: ["a.dnspod.net", "b.dnspod.net"],
	records: [{ Name: "api", Type: "A", Value: "198.51.100.7" }],
	instance: { InstanceId: "lhins-synthetic", InstanceName: "family-cn-api_host", InstanceState: "RUNNING", PublicAddresses: ["198.51.100.7"], InstanceChargeType: "PREPAID", ExpiredTime: "2027-02-10T00:00:00Z" },
	rules: [{ Protocol: "TCP", Port: "22", CidrBlock: "0.0.0.0/0", Action: "ACCEPT" }, { Protocol: "TCP", Port: "443", CidrBlock: "0.0.0.0/0", Action: "ACCEPT" }],
});

async function run(world, argv = ["verify"]) {
	const dir = await mkdtemp(join(tmpdir(), "stack-tencent-"));
	await mkdir(join(dir, "infra/stack"), { recursive: true });
	await writeFile(join(dir, "infra/stack/stack.yaml"), STACK);
	let out = "";
	const code = await main(argv, {
		cwd: dir,
		out: { write: (t) => (out += t) },
		run: tencent(world),
		fetch: async () => ({ status: 200, headers: new Headers(), text: async () => "ok" }),
		readText: async () => {
			throw Object.assign(new Error("missing"), { code: "ENOENT" });
		},
		now: () => new Date("2026-11-11T00:00:00Z"),
	});
	return { code, out };
}

test("tencent: a healthy DNSPod domain and Lighthouse server are green, read-only", async () => {
	const world = healthy();
	const { code, out } = await run(world);
	assert.equal(code, 0, out);
	for (const row of [
		/`tencent\.login` \| ✅ green \| signed in, account 100000000001/,
		/`dns\.domain` \| ✅ green \| family-example\.cn enabled, nameservers point at DNSPod/,
		/`api_host\.dns` \| ✅ green \| api\.family-example\.cn A 198\.51\.100\.7/,
		/`api_host\.instance` \| ✅ green \| lhins-synthetic RUNNING, 198\.51\.100\.7/,
		/`api_host\.billing` \| ✅ green \| prepaid, expires in 91 days/,
		/`api_host\.firewall` \| ✅ green \| open to the internet: 22, 443/,
		/`api_host\.health` \| ✅ green/,
	])
		assert.match(out, row);
	const writes = world.calls.filter(([cmd, , action]) => cmd === "tccli" && action && !/^(Describe|Get)/.test(action));
	assert.deepEqual(writes, [], "only Describe/Get calls");
});

test("tencent: wrong nameservers, a stale A record, postpaid or expiring billing and extra ports are red", async () => {
	const world = healthy();
	world.ns = ["ns1.godaddy.example"];
	world.records = [{ Name: "api", Type: "A", Value: "203.0.113.1" }];
	world.instance = { ...world.instance, InstanceChargeType: "POSTPAID_BY_HOUR", ExpiredTime: "2026-11-20T00:00:00Z" };
	world.rules.push({ Protocol: "TCP", Port: "5432", CidrBlock: "0.0.0.0/0", Action: "ACCEPT" });
	const { code, out } = await run(world);
	assert.equal(code, 1);
	assert.match(out, /`dns\.domain` \| ❌ red \| .*nameservers are ns1\.godaddy\.example; expected a\.dnspod\.net, b\.dnspod\.net/);
	assert.match(out, /`api_host\.dns` \| ❌ red \| api\.family-example\.cn A 203\.0\.113\.1; the server is 198\.51\.100\.7/);
	assert.match(out, /`api_host\.billing` \| ❌ red \| POSTPAID_BY_HOUR; a filing needs prepaid billing, expires in 9 days: renew it/);
	assert.match(out, /`api_host\.firewall` \| ❌ red \| .*not expected: 5432/);
});

test("tencent: not signed in is blocked with the login step; no server yet is red, not an error", async () => {
	const signedOut = healthy();
	signedOut.signedIn = false;
	const blocked = await run(signedOut);
	assert.equal(blocked.code, 2);
	assert.match(blocked.out, /⏸ blocked \| tccli cam failed: secretId is invalid \(gate `tencent\.login`\)/);
	const fresh = healthy();
	fresh.instance = null;
	fresh.domain = false;
	const before = await run(fresh);
	assert.match(before.out, /`dns\.domain` \| ❌ red \| family-example\.cn isn't in this DNSPod account/);
	assert.match(before.out, /`api_host\.instance` \| ❌ red \| no Lighthouse instance named family-cn-api_host in ap-guangzhou/);
});
