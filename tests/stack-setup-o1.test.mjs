import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../skills/stack-setup/scripts/stack.mjs";

// A stateful, synthetic Cloudflare that enforces token permissions the way the
// real API does at the level these tests care about. Nothing reaches Cloudflare.
const BOOT = "cfboot-synthetic-bootstrap-not-real";
const OLD = "cfold-synthetic-manual-token-not-real";
const GROUPS = ["Zone Read", "DNS Write", "Cloudflare Tunnel Write", "Email Routing Rules Write", "Email Routing Addresses Write", "Zone Settings Read", "Zone Settings Write", "API Tokens Write"].map((name, i) => ({ id: `pg-${i}`, name }));
const NEED = [
	[/^\/zones$/, "GET", "Zone Read"],
	[/\/dns_records/, "GET", "Zone Read"],
	[/\/email\/routing\/rules/, "*", "Email Routing Rules Write"],
	[/\/email\/routing\/(enable|disable)$/, "POST", "Zone Settings Write"],
	[/\/email\/routing\/addresses/, "*", "Email Routing Addresses Write"],
	[/^\/user\/tokens(\/permission_groups)?$/, "*", "API Tokens Write"],
	[/^\/user\/tokens\/[a-z0-9-]+$/, "DELETE", "API Tokens Write"],
	[/\/cfd_tunnel/, "*", "Cloudflare Tunnel Write"],
];

function cloudflare() {
	const w = {
		tokens: new Map([
			[BOOT, { id: "boot-token", perms: ["API Tokens Write"] }],
			[OLD, { id: "old-token", perms: ["Zone Read", "DNS Write"] }],
		]),
		seq: 1,
		mx: [],
		txt: [],
		rules: [{ id: "catchall", enabled: false, matchers: [{ type: "all" }], actions: [{ type: "drop" }] }],
		addresses: [],
		calls: [],
	};
	const reply = (status, result) => ({ ok: status < 300, status, headers: new Headers(), json: async () => ({ success: status < 300, result, errors: status < 300 ? [] : [{ message: "nope" }] }), text: async () => "" });
	w.fetch = async (url, init = {}) => {
		const method = init.method ?? "GET";
		const u = new URL(url);
		const path = u.pathname.replace("/client/v4", "");
		w.calls.push([method, path, init.headers?.authorization ?? ""]);
		const tok = w.tokens.get((init.headers?.authorization ?? "").replace("Bearer ", ""));
		if (!tok) return reply(401, null);
		if (path === "/user/tokens/verify") return reply(200, { id: tok.id, status: "active" });
		const rule = NEED.find(([re, m]) => re.test(path) && (m === "*" || m === method));
		if (rule && !tok.perms.includes(rule[2])) return reply(403, null);
		const body = init.body ? JSON.parse(init.body) : {};
		if (path === "/user/tokens/permission_groups") return reply(200, GROUPS);
		if (path === "/user/tokens" && method === "POST") {
			const id = `tok-${w.seq++}`;
			const value = `cfagent-synthetic-${id}-value`;
			const perms = body.policies.flatMap((p) => p.permission_groups.map((g) => GROUPS.find((x) => x.id === g.id).name));
			w.tokens.set(value, { id, perms, policies: body.policies, name: body.name });
			return reply(200, { id, value });
		}
		if (path.startsWith("/user/tokens/") && method === "DELETE") {
			const id = path.split("/").pop();
			for (const [v, t] of w.tokens) if (t.id === id) w.tokens.delete(v);
			return reply(200, { id });
		}
		if (path === "/zones") return reply(200, [{ id: "zone-1", name: "example.com", status: "active", name_servers: [], account: { id: "acct-1" } }]);
		if (path === "/zones/zone-1/dns_records") {
			const type = u.searchParams.get("type");
			return reply(200, type === "MX" ? w.mx : type === "TXT" ? w.txt : []);
		}
		if (path === "/zones/zone-1/email/routing/enable") {
			w.mx = [1, 2, 3].map((n) => ({ content: `route${n}.mx.cloudflare.net` }));
			w.txt = [{ content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' }];
			return reply(200, {});
		}
		if (path === "/zones/zone-1/email/routing/disable") {
			w.mx = [];
			w.txt = [];
			return reply(200, {});
		}
		if (path === "/zones/zone-1/email/routing/rules" && method === "GET") return reply(200, w.rules);
		if (path === "/zones/zone-1/email/routing/rules" && method === "POST") {
			const made = { id: `rule-${w.seq++}`, ...body };
			w.rules.push(made);
			return reply(200, made);
		}
		if (path.startsWith("/zones/zone-1/email/routing/rules/")) {
			const id = path.split("/").pop();
			if (method === "PUT") Object.assign(w.rules.find((r) => r.id === id), body);
			if (method === "DELETE") w.rules = w.rules.filter((r) => r.id !== id);
			return reply(200, {});
		}
		if (path === "/accounts/acct-1/cfd_tunnel") return reply(200, []);
		if (path === "/accounts/acct-1/email/routing/addresses" && method === "GET") return reply(200, w.addresses);
		if (path === "/accounts/acct-1/email/routing/addresses" && method === "POST") {
			const made = { id: `addr-${w.seq++}`, email: body.email, verified: null };
			w.addresses.push(made);
			return reply(200, made);
		}
		if (path.startsWith("/accounts/acct-1/email/routing/addresses/") && method === "DELETE") {
			w.addresses = w.addresses.filter((a) => a.id !== path.split("/").pop());
			return reply(200, {});
		}
		throw new Error(`unexpected ${method} ${path}`);
	};
	return w;
}

const stackYaml = ({ bootstrap = true, routes = "{ support: owner@example.net }", tunnel = false } = {}) => `app: example-app
domain: example.com
capabilities:
  dns:
    provider: cloudflare
    token_file: ~/.config/example-app/cloudflare.env
${bootstrap ? "    bootstrap_token_file: ~/.config/example-app/cloudflare-bootstrap.env\n" : ""}  forwarding:
    provider: cloudflare-email-routing
    on: dns
    routes: ${routes}
${tunnel ? "  api_host: { provider: aws-ec2-docker, profile: p, region: ap-southeast-2, name: n, ingress: cloudflare-tunnel, tunnel: t, hostname: api, ssh: { user: u, key: ~/.ssh/k } }\n" : ""}`;

async function workspace(yaml) {
	const dir = await mkdtemp(join(tmpdir(), "stack-o1-"));
	await mkdir(join(dir, "infra/stack"), { recursive: true });
	await writeFile(join(dir, "infra/stack/stack.yaml"), yaml);
	return dir;
}

function files(initial = {}) {
	const f = { "~/.config/example-app/cloudflare.env": `CLOUDFLARE_API_TOKEN=${OLD}\n`, ...initial };
	return f;
}

async function run(dir, argv, w, f) {
	let out = "";
	const code = await main(argv, {
		cwd: dir,
		out: { write: (t) => (out += t) },
		fetch: w.fetch,
		run: async (cmd) => (cmd === "git" ? { code: 128, stdout: "", stderr: "not a repo" } : cmd === "node" ? { code: 0, stdout: "v22\n", stderr: "" } : { code: 127, missing: true, stdout: "", stderr: "" }),
		readText: async (p) => {
			if (!(p in f)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
			return f[p];
		},
		writeSecretFile: async (p, t) => {
			f[p] = t;
		},
		moveToTrash: async (p) => {
			for (const k of Object.keys(f)) if (p === k || p.endsWith(k.slice(1))) delete f[k];
		},
		sleep: async () => {},
		now: () => new Date("2026-11-12T00:00:00Z"),
	});
	return { code, out };
}

const readState = async (dir) => JSON.parse(await readFile(join(dir, "infra/stack/.stack/state.json"), "utf8"));

test("without a bootstrap token, a token short of permissions is named, with the step to fix it", async () => {
	const dir = await workspace(stackYaml({ bootstrap: false }));
	const { out } = await run(dir, ["plan"], cloudflare(), files());
	assert.match(out, /⏸ blocked `forwarding`: Cloudflare refused GET \/zones\/zone-1\/email\/routing\/rules \(403\); the agent's token lacks this permission \(gate `cloudflare\.token`\)/);
});

test("bootstrap: one token from the owner, picked up to this computer only", async () => {
	const dir = await workspace(stackYaml());
	const w = cloudflare();
	const f = files();
	const before = await run(dir, ["plan"], w, f);
	assert.match(before.out, /⏸ blocked `dns\.agent-token`: the agent's token needs .*; hand over the bootstrap token first \(gate `cloudflare\.bootstrap`\)/);
	const guide = await run(dir, ["gates"], w, f);
	assert.match(guide.out, /\*\*cloudflare\.bootstrap\*\* \(consent, open\): Create one Cloudflare token the agent uses to make its own/);
	f["~/Downloads/cloudflare-bootstrap.env"] = `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT}\n`;
	const picked = await run(dir, ["gates", "pickup", "cloudflare.bootstrap", "--file", "~/Downloads/cloudflare-bootstrap.env", "--confirm"], w, f);
	assert.equal(picked.code, 0, picked.out);
	assert.equal(f["~/.config/example-app/cloudflare-bootstrap.env"], `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT}\n`);
	assert.equal(f["~/Downloads/cloudflare-bootstrap.env"], undefined, "the hand-off file goes to the Trash");
	assert.ok(!picked.out.includes(BOOT));
});

test("one apply: mints the agent's own narrow token, revokes the old one, then sets up forwarding", async () => {
	const dir = await workspace(stackYaml());
	const w = cloudflare();
	const f = files({ "~/.config/example-app/cloudflare-bootstrap.env": `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT}\n` });
	const planned = await run(dir, ["plan"], w, f);
	assert.match(planned.out, /\+ create `dns\.agent-token`: the agent's own token with DNS Write, Email Routing Rules Write, Zone Read, Zone Settings Read, Zone Settings Write, Email Routing Addresses Write, limited to this zone and account; it replaces and revokes the current one/);
	assert.match(planned.out, /planned again after the token step, in the same apply/);
	const applied = await run(dir, ["apply", "--confirm"], w, f);
	assert.equal(applied.code, 0, applied.out);
	for (const line of [/✅ `dns\.agent-token`/, /✅ `forwarding\.routing`: turn on Email Routing/, /✅ `forwarding\.destination\.owner@example\.net`/, /✅ `forwarding\.route\.support`: forward support@example\.com → owner@example\.net/])
		assert.match(applied.out, line);
	const minted = [...w.tokens.values()].find((t) => t.name === "stack-setup example-app agent");
	assert.ok(!minted.perms.includes("Zone Settings Write"), "after Email Routing is on, the final token drops Zone Settings Write");
	assert.equal([...w.tokens.values()].filter((t) => t.name === "stack-setup example-app agent").length, 1, "only the final agent token is left");
	assert.deepEqual(minted.policies.map((p) => Object.keys(p.resources)[0]), ["com.cloudflare.api.account.zone.zone-1", "com.cloudflare.api.account.acct-1"], "scoped to this zone and account");
	assert.ok(!minted.perms.includes("API Tokens Write"), "the agent's token can't make tokens");
	assert.ok(![...w.tokens.values()].some((t) => t.id === "old-token"), "the replaced token is revoked");
	assert.ok(![...w.tokens.values()].some((t) => /lookup/.test(t.name ?? "")), "the lookup token is gone");
	const value = [...w.tokens.entries()].find(([, t]) => t === minted)[0];
	assert.equal(f["~/.config/example-app/cloudflare.env"], `CLOUDFLARE_API_TOKEN=${value}\n`);
	const state = JSON.stringify(await readState(dir));
	for (const secret of [value, BOOT, OLD]) assert.ok(!applied.out.includes(secret) && !state.includes(secret), "no token in output or state");
	assert.equal(w.rules.find((r) => r.name?.startsWith("support")).actions[0].value[0], "owner@example.net");

	const waiting = await run(dir, ["verify"], w, f);
	assert.match(waiting.out, /`forwarding\.destination\.owner@example\.net` \| ❌ red \| owner@example\.net hasn't confirmed Cloudflare's email yet/);
	assert.match(waiting.out, /\*\*forwarding\.confirm\.owner@example\.net\*\* \(consent, open\): Confirm owner@example\.net as a forwarding address/);
	w.addresses[0].verified = "2026-11-12T01:00:00Z"; // the owner clicked the link
	const done = await run(dir, ["verify"], w, f);
	assert.equal(done.code, 0, done.out);
	assert.equal((await readState(dir)).gates["forwarding.confirm.owner@example.net"].status, "done");
	assert.equal((await run(dir, ["plan"], w, f)).code, 0, "nothing left to change");
});

test("existing forwarding (as on WiggleTrail) is recognised, not rebuilt", async () => {
	const dir = await workspace(stackYaml({ bootstrap: false }));
	const w = cloudflare();
	w.tokens.get(OLD).perms.push("Email Routing Rules Write", "Email Routing Addresses Write");
	w.mx = [1, 2, 3].map((n) => ({ content: `route${n}.mx.cloudflare.net` }));
	w.txt = [{ content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' }];
	w.rules.push({ id: "r-support", name: "support to Gmail", enabled: true, matchers: [{ type: "literal", field: "to", value: "support@example.com" }], actions: [{ type: "forward", value: ["owner@example.net"] }] });
	w.addresses.push({ id: "a-1", email: "owner@example.net", verified: "2026-11-10T14:51:39Z" });
	const f = files();
	const planned = await run(dir, ["plan"], w, f);
	assert.equal(planned.code, 0, planned.out);
	assert.match(planned.out, /= no change `forwarding\.route\.support`: support@example\.com → owner@example\.net/);
	const verified = await run(dir, ["verify"], w, f);
	assert.match(verified.out, /`forwarding\.routing` \| ✅ green \| example\.com receives mail through Cloudflare \(3 MX, SPF\)/);
	await run(dir, ["import"], w, f);
	const state = await readState(dir);
	assert.ok(state.resources["cloudflare.email-rule.r-support"] && !state.resources["cloudflare.email-rule.r-support"].createdBy, "imported, so teardown never deletes it");
});

test("mail already going elsewhere is a conflict, never taken over", async () => {
	const dir = await workspace(stackYaml());
	const w = cloudflare();
	w.mx = [{ content: "mx.other-provider.example" }];
	const f = files({ "~/.config/example-app/cloudflare-bootstrap.env": `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT}\n` });
	await run(dir, ["apply", "--confirm"], w, f);
	const { out } = await run(dir, ["plan"], w, f);
	assert.match(out, /⏸ blocked `forwarding\.routing`: example\.com already receives mail at mx\.other-provider\.example/);
	assert.deepEqual(w.mx, [{ content: "mx.other-provider.example" }]);
});

test("a stack that needs more (a tunnel) re-mints the agent token and revokes the previous one; teardown revokes it last", async () => {
	const dir = await workspace(stackYaml());
	const w = cloudflare();
	const f = files({ "~/.config/example-app/cloudflare-bootstrap.env": `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT}\n` });
	await run(dir, ["apply", "--confirm"], w, f);
	const first = (await readState(dir)).resources["cloudflare.agent-token"].id;
	assert.equal((await run(dir, ["plan"], w, f)).code, 0, "a second route needs nothing new");
	await writeFile(join(dir, "infra/stack/stack.yaml"), stackYaml({ tunnel: true }));
	const planned = await run(dir, ["plan"], w, f);
	assert.match(planned.out, /~ update `dns\.agent-token`: the agent's own token with .*Cloudflare Tunnel Write/);
	await run(dir, ["apply", "--confirm"], w, f).catch(() => {});
	const second = (await readState(dir)).resources["cloudflare.agent-token"].id;
	assert.notEqual(second, first);
	assert.ok(![...w.tokens.values()].some((t) => t.id === first), "the earlier agent token is revoked");
	await writeFile(join(dir, "infra/stack/stack.yaml"), stackYaml());
	const removed = await run(dir, ["teardown", "--confirm"], w, f);
	assert.match(removed.out, /forwarding rule for support@example\.com[\s\S]*forwarding address owner@example\.net[\s\S]*Email Routing on example\.com[\s\S]*Cloudflare token stack-setup example-app agent \(revoked\)/);
	assert.ok(![...w.tokens.values()].some((t) => t.name === "stack-setup example-app agent"));
	assert.ok(![...w.tokens.values()].some((t) => /one-off|lookup/.test(t.name ?? "")), "no temporary token is left behind");
	assert.doesNotMatch(f["~/.config/example-app/cloudflare.env"], /CLOUDFLARE_API_TOKEN/);
	assert.deepEqual(w.mx, []);
});
