import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseYaml } from "../skills/stack-setup/scripts/lib/yaml.mjs";
import { validateStack, capabilityOrder } from "../skills/stack-setup/scripts/lib/schema.mjs";
import { findSecret } from "../skills/stack-setup/scripts/lib/guard.mjs";
import { emptyState, saveState } from "../skills/stack-setup/scripts/lib/state.mjs";
import { adapters } from "../skills/stack-setup/scripts/adapters/index.mjs";
import { main } from "../skills/stack-setup/scripts/stack.mjs";
import { FAKE_SECRET, FAKE_TOKEN, healthyWorld, overridesFor } from "./stack-setup/world.mjs";

const EXAMPLE = resolve("docs/stack-setup/example.stack.yaml");

class Sink {
	text = "";
	write(chunk) {
		this.text += chunk;
	}
}

async function workspace() {
	const dir = await mkdtemp(join(tmpdir(), "stack-setup-"));
	await mkdir(join(dir, "infra/stack"), { recursive: true });
	await copyFile(EXAMPLE, join(dir, "infra/stack/stack.yaml"));
	return dir;
}

async function run(dir, argv, world = healthyWorld()) {
	const out = new Sink();
	const code = await main(argv, { cwd: dir, out, ...overridesFor(world) });
	return { code, out: out.text, world };
}

const statePath = (dir) => join(dir, "infra/stack/.stack/state.json");
const readState = async (dir) => JSON.parse(await readFile(statePath(dir), "utf8"));

test("yaml: maps, lists, flow collections, quotes and comments", () => {
	const doc = parseYaml(`
# top comment
app: demo   # trailing comment
url: "https://a.example/#not-a-comment"
quote: 'it''s'
n: 3
flag: true
none: ~
home: ~/x/y
list: [a, "b, c", { k: v }]
map: { a: 1, b: [x, y], c: { d: e } }
nested:
  child:
    - plain
    - { type: t, name: N }
    - key: v
      other: w
same_indent:
- one
- two
`);
	assert.deepEqual(doc, {
		app: "demo",
		url: "https://a.example/#not-a-comment",
		quote: "it's",
		n: 3,
		flag: true,
		none: null,
		home: "~/x/y",
		list: ["a", "b, c", { k: "v" }],
		map: { a: 1, b: ["x", "y"], c: { d: "e" } },
		nested: { child: ["plain", { type: "t", name: "N" }, { key: "v", other: "w" }] },
		same_indent: ["one", "two"],
	});
});

test("yaml: refuses features it doesn't support, with the line number", () => {
	assert.throws(() => parseYaml("a: 1\n\tb: 2"), /line 2: use spaces/);
	assert.throws(() => parseYaml("a: &x 1"), /line 1: unsupported YAML feature "&"/);
	assert.throws(() => parseYaml("a: |\n  text"), /unsupported YAML feature "\|"/);
	assert.throws(() => parseYaml("a: 1\na: 2"), /line 2: duplicate key "a"/);
	assert.throws(() => parseYaml("a: 1\n---\nb: 2"), /only one YAML document/);
	assert.throws(() => parseYaml("a:\n  b: 1\n    c: 2"), /line 3: unexpected indentation/);
	assert.throws(() => parseYaml("a: { b: 1"), /expected/);
});

test("guard: recognises credential shapes but not IDs", () => {
	for (const secret of [FAKE_SECRET, "whsec_abcdefgh12345678", "ghp_" + "a".repeat(36), "AKIAABCDEFGHIJKLMNOP", "GOCSPX-abcdefghijkl", "-----BEGIN OPENSSH PRIVATE KEY-----", "postgres://u:hunter22@db/x"])
		assert.ok(findSecret(secret), secret);
	for (const id of ["we_1UYgUWFDeWXtUK8RFvVqBlZy", "acct_1Ttj69FDeWXtUK8R", "ca_VXe4t2x1hhFDzw7jlgIocSkg99Lm2n6p", "i-0ae0d92d2a13952be", "7e54e2b8-8112-4dc4-bc0c-89eab349b0d7", "https://api.example.com"])
		assert.equal(findSecret(id), null, id);
});

test("schema: the design's example is valid and orders `on:` targets first", async () => {
	const { stack, errors } = validateStack(parseYaml(await readFile(EXAMPLE, "utf8")), adapters);
	assert.deepEqual(errors, []);
	const order = capabilityOrder(stack);
	assert.ok(order.indexOf("api_host") < order.indexOf("database"));
	assert.ok(order.indexOf("api_host") < order.indexOf("cache"));
});

test("schema: names every problem instead of stopping at the first", () => {
	const { stack, errors } = validateStack(
		{
			app: "Bad App",
			domain: "nodot",
			capabilities: { dns: { provider: "cloudflare", token_file: "x" }, db: { provider: "docker-postgres", on: "missing" }, api: {} },
			contract: { ghost: ["lower"] },
			secrets: { canonical: { type: "vault" } },
		},
		adapters,
	);
	assert.equal(stack, null);
	const text = errors.join("\n");
	for (const part of ["app:", "domain:", "capabilities.db.on", "capabilities.api.provider", "contract.ghost", "secrets.canonical.type"])
		assert.match(text, new RegExp(part.replace(".", "\\.")));
});

test("schema: the secret store is choosable; 1password needs a vault and item", () => {
	const base = { app: "a", domain: "a.com", capabilities: { ci: { provider: "github", repo: "o/r" } } };
	assert.deepEqual(validateStack({ ...base, secrets: { canonical: { type: "1password", vault: "Apps", item: "a env" } } }, adapters).errors, []);
	assert.match(validateStack({ ...base, secrets: { canonical: { type: "1password" } } }, adapters).errors.join(), /vault is required/);
});

test("schema and state refuse anything shaped like a secret", async () => {
	const { errors } = validateStack({ app: "a", domain: "a.com", capabilities: { ci: { provider: "github", repo: "o/r", note: FAKE_SECRET } } });
	assert.match(errors[0], /capabilities\.ci\.note looks like a Stripe secret key/);
	const dir = await mkdtemp(join(tmpdir(), "stack-state-"));
	const state = emptyState("a");
	state.resources.leak = { id: FAKE_SECRET };
	await assert.rejects(saveState(join(dir, "state.json"), state), /resources\.leak\.id looks like a Stripe secret key/);
});

test("verify: a healthy stack is all green, closes probe gates and never prints values", async () => {
	const dir = await workspace();
	const { code, out, world } = await run(dir, ["verify"]);
	assert.equal(code, 0, out);
	assert.doesNotMatch(out, /❌|⏸/);
	for (const id of ["dns.zone", "api_host.tunnel", "api_host.ingress", "api_host.dns", "api_host.instance", "api_host.firewall", "api_host.health", "api_host.connector", "database.container", "cache.container", "web.example-storefront.domain.example.com", "web.example-console.env", "email.domain", "email.records", "payments.webhook.connect", "payments.webhook.billing.route", "signin.redirect", "ci.secrets", "ci.deploy", "secrets.store", "secrets.config.API_PUBLIC_URL"])
		assert.match(out, new RegExp(`\`${id.replaceAll(".", "\\.")}\` \\| ✅`), id);
	assert.ok(!out.includes(FAKE_SECRET) && !out.includes(FAKE_TOKEN));
	const state = await readState(dir);
	assert.ok(!JSON.stringify(state).includes(FAKE_SECRET));
	assert.equal(state.checks["dns.zone"].status, "green");
	assert.equal(state.gates["google.client"].status, "done");
	assert.equal(state.gates["dns.nameservers"].status, "done");
	assert.equal(state.gates["google.publish"], undefined, "a gate without a probe stays open until a person marks it");
	assert.match(out, /google\.publish/);
	assert.match(out, /ios\.signin/);
	// Read-only: no command or request that changes anything.
	for (const call of world.calls) {
		assert.ok(!(call[0] === "fetch" && call[1] !== "GET" && !call[2].includes("/webhooks/")), call.join(" "));
		assert.ok(!["create", "delete", "update", "set", "add"].some((verb) => call.includes(verb)), call.join(" "));
	}
});

test("verify: an expired AWS login blocks the host and what runs on it, and says which gate", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.awsLoggedIn = false;
	const { code, out } = await run(dir, ["verify"], world);
	assert.equal(code, 2, out);
	assert.match(out, /`api_host` \| ⏸ blocked \| aws ec2 failed: Your session has expired.* \(gate `aws\.login`\)/);
	assert.match(out, /`database` \| ⏸ blocked/);
	assert.match(out, /`dns\.zone` \| ✅/);
});

test("verify: with ssh.host declared, a lapsed AWS login still leaves the host checks running", async () => {
	const dir = await workspace();
	const file = join(dir, "infra/stack/stack.yaml");
	await writeFile(file, (await readFile(file, "utf8")).replace("ssh: { user: ec2-user, key: ~/.ssh/example-prod }", "ssh: { user: ec2-user, key: ~/.ssh/example-prod, host: 203.0.113.10 }"));
	const world = healthyWorld();
	world.awsLoggedIn = false;
	const { code, out } = await run(dir, ["verify"], world);
	assert.equal(code, 2);
	assert.match(out, /`aws\.login` \| ⏸ blocked .*\(gate `aws\.login`\)/);
	for (const id of ["api_host.health", "api_host.ssh", "api_host.connector", "database.container", "secrets.store"])
		assert.match(out, new RegExp(`\`${id.replaceAll(".", "\\.")}\` \\| ✅`), id);
	assert.doesNotMatch(out, /`api_host\.instance`/);
});

test("verify: real problems are red with the reason", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.tunnelStatus = "down";
	world.resendRecords = ["verified", "pending", "verified"];
	world.openPorts = [22, 443];
	delete world.hostEnv.GOOGLE_CLIENT_SECRET;
	world.hostEnv.API_PUBLIC_URL = "https://old.example.net";
	world.secrets = ["DEPLOY_HOST"];
	world.cname = { content: "old-host.example.net", proxied: false };
	const { code, out } = await run(dir, ["verify"], world);
	assert.equal(code, 1);
	assert.match(out, /`api_host\.tunnel` \| ❌ red \| tunnel example-api down/);
	assert.match(out, /`email\.records` \| ❌ red \| not verified: MX r1\.mail/);
	assert.match(out, /`api_host\.firewall` \| ❌ red .*not expected: 443/);
	assert.match(out, /`secrets\.store` \| ❌ red .*missing from the contract: GOOGLE_CLIENT_SECRET/);
	assert.match(out, /`secrets\.config\.API_PUBLIC_URL` \| ❌ red \| API_PUBLIC_URL is different; expected https:\/\/api\.example\.com/);
	assert.match(out, /`ci\.secrets` \| ❌ red \| missing Actions secrets: DEPLOY_SSH_KEY, APP_ENV/);
	assert.match(out, /`api_host\.dns` \| ❌ red \| api\.example\.com CNAME old-host\.example\.net, not proxied/);
	assert.doesNotMatch(out, /old\.example\.net/, "a mismatched value is not echoed");
});

test("verify: without the Stripe CLI, routes are still checked and the login gate is named", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.stripeInstalled = false;
	const { out } = await run(dir, ["verify"], world);
	assert.match(out, /`payments\.webhook\.connect\.route` \| ✅/);
	assert.match(out, /`stripe\.login` \| ⏸ blocked \| stripe is not installed \(gate `stripe\.login`\)/);
});

test("verify: a provider without an adapter is skipped, not failed", async () => {
	const dir = await workspace();
	const file = join(dir, "infra/stack/stack.yaml");
	await writeFile(file, (await readFile(file, "utf8")).replace(/provider: docker-postgres[^\r\n]*\r?\n\s+on: api_host/, "provider: neon"));
	const { out } = await run(dir, ["verify"]);
	assert.match(out, /`database` \| — skipped \| no adapter for provider "neon" yet/);
});

test("import: records IDs in state and keeps the first-seen time", async () => {
	const dir = await workspace();
	const first = await run(dir, ["import"]);
	assert.equal(first.code, 0, first.out);
	let state = await readState(dir);
	assert.equal(state.resources["cloudflare.zone"].id, "zone-synthetic");
	assert.equal(state.resources["cloudflare.tunnel.example-api"].id, "tunnel-synthetic");
	assert.equal(state.resources["aws.instance.example-api"].id, "i-0synthetic");
	assert.equal(state.resources["aws.address.example-api"].ip, "203.0.113.10");
	assert.equal(state.resources["resend.domain.mail.example.com"].id, "dom-synthetic");
	assert.equal(state.resources["stripe.webhook.connect"].id, "we_connect");
	assert.equal(state.resources["vercel.project.example-console"].id, "prj_example-console");
	const seen = state.resources["cloudflare.zone"].firstSeen;
	const out = new Sink();
	await main(["import"], { cwd: dir, out, ...overridesFor(healthyWorld(), "2026-12-01T00:00:00Z") });
	state = await readState(dir);
	assert.equal(state.resources["cloudflare.zone"].firstSeen, seen);
	assert.equal(state.resources["cloudflare.zone"].lastSeen, "2026-12-01T00:00:00.000Z");
});

test("gates: people mark manual steps; probe steps only close by verify", async () => {
	const dir = await workspace();
	const listed = await run(dir, ["gates"]);
	assert.match(listed.out, /### Before any work[\s\S]*aws\.login[\s\S]*### For this app[\s\S]*google\.client[\s\S]*### Before going live[\s\S]*stripe\.live/);
	assert.match(listed.out, /Hand back through secure-key-handoff: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET/);
	assert.match(listed.out, /redirects: https:\/\/api\.example\.com\/auth\/google\/callback/);
	assert.match(listed.out, /redirect: https:\/\/api\.example\.com\/payments\/connect\/callback/);
	assert.doesNotMatch(listed.out, /secure-key-handoff: STRIPE_CONNECT_CLIENT_ID/);
	await run(dir, ["gates", "set", "google.publish", "done", "--by", "owner"]);
	assert.equal((await readState(dir)).gates["google.publish"].by, "owner");
	await assert.rejects(run(dir, ["gates", "set", "google.client", "done"]), /closed by the check signin\.redirect/);
	await assert.rejects(run(dir, ["gates", "set", "nope", "done"]), /no gate "nope"/);
	const after = await run(dir, ["gates"]);
	assert.doesNotMatch(after.out, /google\.publish/);
});

test("doctor: tools, logins and deadlines, without writing state", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.stripeInstalled = false;
	const { code, out } = await run(dir, ["doctor"], world);
	assert.equal(code, 2);
	assert.match(out, /`tool\.stripe` \| ❌ red \| stripe is not installed/);
	assert.match(out, /`aws\.login` \| ✅ green \| signed in to account 000000000000/);
	assert.match(out, /`cloudflare\.login` \| ✅/);
	assert.match(out, /2026-11-30 \(21 days\): Stripe MCP[\s\S]*2027-05-04 \(\d+ days\): AWS free-plan credit ends/);
	await assert.rejects(readFile(statePath(dir)), { code: "ENOENT" });
});

test("cli: later commands say when they arrive; bad stacks name the problem", async () => {
	const dir = await workspace();
	const later = await run(dir, ["rotate"]);
	assert.equal(later.code, 64);
	assert.match(later.out, /arrives in M3/);
	await writeFile(join(dir, "infra/stack/stack.yaml"), "app: x\ndomain: x.com\ncapabilities: {}\n");
	await assert.rejects(run(dir, ["verify"]), /capabilities: at least one/);
});
