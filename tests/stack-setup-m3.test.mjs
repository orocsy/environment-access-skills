import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentPolicy, POLICY_EXPECTATIONS } from "../skills/stack-setup/scripts/adapters/aws-agent.mjs";
import { updateIniSection, iniSections } from "../skills/stack-setup/scripts/lib/ini.mjs";
import { parseHandoff } from "../skills/stack-setup/scripts/lib/rotate.mjs";
import { main } from "../skills/stack-setup/scripts/stack.mjs";
import { FAKE_SECRET, healthyWorld, overridesFor } from "./stack-setup/world.mjs";

const EXAMPLE = resolve("docs/stack-setup/example.stack.yaml");

class Sink {
	text = "";
	write(chunk) {
		this.text += chunk;
	}
}

async function workspace(edit = (text) => text, files = {}) {
	const dir = await mkdtemp(join(tmpdir(), "stack-m3-"));
	await mkdir(join(dir, ".git"));
	await mkdir(join(dir, "infra/stack"), { recursive: true });
	await writeFile(join(dir, "infra/stack/stack.yaml"), edit(await readFile(EXAMPLE, "utf8")));
	for (const [path, text] of Object.entries(files)) {
		await mkdir(join(dir, path, ".."), { recursive: true });
		await writeFile(join(dir, path), text);
	}
	return dir;
}

async function run(dir, argv, world, extra = {}) {
	const out = new Sink();
	const code = await main(argv, { cwd: dir, out, ...overridesFor(world), ...extra });
	return { code, out: out.text };
}

const readState = async (dir) => JSON.parse(await readFile(join(dir, "infra/stack/.stack/state.json"), "utf8"));
const argsHold = (world, secret) => world.calls.some((c) => c.slice(1).some((a) => typeof a === "string" && a.includes(secret)));

const withAgent = (t) => t.replace("    profile: example-app        # AWS CLI profile", "    profile: example-app        # AWS CLI profile\n    agent: { profile: example-agent }");
const withReload = (t) =>
	t.replace("canonical: { type: server-env, host: api_host, path: ~/example-app/app.env }", 'canonical: { type: server-env, host: api_host, path: ~/example-app/app.env, reload: "cd ~/example-app && docker compose up -d --no-deps api" }');
const RELOAD = "cd ~/example-app && docker compose up -d --no-deps api";

// Every action in the policy needs either read-only scope, a tag condition or one named resource.
const allows = (policy, action) =>
	policy.Statement.some((s) => [s.Action].flat().some((a) => a === action || (a.endsWith("*") && action.startsWith(a.slice(0, -1)))));

test("agent policy: reads the account, manages only this app's tagged resources, rotates only its own key", () => {
	const policy = agentPolicy({ account: "000000000000", region: "ap-southeast-2", app: "example-app", user: "stack-setup-example-app" });
	for (const action of POLICY_EXPECTATIONS.allowed) assert.ok(allows(policy, action), action);
	for (const action of ["iam:CreateUser", "iam:AttachUserPolicy", "iam:PutUserPolicy", "s3:ListAllMyBuckets", "organizations:LeaveOrganization", "account:CloseAccount"])
		assert.ok(!allows(policy, action), `${action} must not be allowed`);
	for (const s of policy.Statement) {
		assert.ok(![s.Action].flat().includes("*"), `${s.Sid} uses a wildcard action`);
		const writes = [s.Action].flat().some((a) => !/:(Describe|Get|List)/.test(a));
		if (writes && s.Sid !== "RotateOwnKey") assert.ok(JSON.stringify(s.Condition).includes("ap-southeast-2"), `${s.Sid} is not limited to the region`);
	}
	const manage = policy.Statement.find((s) => s.Sid === "ManageOnlyThisAppsResources");
	assert.deepEqual(manage.Condition.StringEquals["aws:ResourceTag/stack-setup:app"], "example-app");
	assert.equal(policy.Statement.find((s) => s.Sid === "RotateOwnKey").Resource, "arn:aws:iam::000000000000:user/stack-setup-example-app");
});

test("ini: replaces one profile, keeps the others, removes on null", () => {
	const before = "[default]\naws_access_key_id = A\n\n[example-agent]\naws_access_key_id = OLD\naws_secret_access_key = OLDS\n[other]\nx = 1\n";
	const after = updateIniSection(before, "example-agent", { aws_access_key_id: "NEW", aws_secret_access_key: "NEWS", region: "ap-southeast-2" });
	assert.deepEqual(iniSections(after), ["default", "example-agent", "other"]);
	assert.match(after, /\[example-agent\]\naws_access_key_id = NEW\naws_secret_access_key = NEWS\nregion = ap-southeast-2\n\[other\]/);
	assert.doesNotMatch(after, /OLD/);
	assert.deepEqual(iniSections(updateIniSection(after, "example-agent", null)), ["default", "other"]);
	assert.throws(() => updateIniSection("", "x", { k: "a\nb" }), /bad credentials entry/);
});

test("agent key: made once with the owner's sign-in, then checks work with no sign-in, rotate swaps it, teardown removes it", async () => {
	const dir = await workspace(withAgent);
	const world = healthyWorld();
	const planned = await run(dir, ["plan"], world);
	assert.match(planned.out, /\+ create `api_host\.agent\.user`: IAM user stack-setup-example-app/);
	assert.match(planned.out, /\+ create `api_host\.agent\.policy`: policy stack-setup-agent-example-app: read the account; manage only resources tagged stack-setup:app=example-app in ap-southeast-2/);
	assert.match(planned.out, /\+ create `api_host\.agent\.attach`: attach stack-setup-agent-example-app to stack-setup-example-app/);
	assert.match(planned.out, /\+ create `api_host\.agent\.key`: access key for stack-setup-example-app → ~\/\.aws\/credentials \[example-agent\] \(0600\)/);

	const applied = await run(dir, ["apply", "--confirm"], world);
	assert.equal(applied.code, 0, applied.out);
	const [key] = world.iam.keys;
	assert.match(world.files["~/.aws/credentials"], new RegExp(`\\[example-agent\\]\\naws_access_key_id = ${key.id}\\naws_secret_access_key = ${key.secret.replaceAll("/", "\\/")}`));
	assert.equal(world.fileModes["~/.aws/credentials"], 0o600);
	assert.ok(!applied.out.includes(key.secret) && !JSON.stringify(await readState(dir)).includes(key.secret));
	assert.ok(!argsHold(world, key.secret), "the secret key never appears in arguments");

	world.awsLoggedIn = false; // the owner's 12-hour sign-in lapses
	const verified = await run(dir, ["verify"], world);
	assert.match(verified.out, /`aws\.login` \| ✅ green \| agent key example-agent/);
	assert.match(verified.out, /`api_host\.instance` \| ✅/);
	assert.equal((await run(dir, ["plan"], { ...world, awsLoggedIn: true })).code, 0, "nothing left to change");

	const rotated = await run(dir, ["rotate", "agent-key", "--confirm"], world);
	assert.equal(rotated.code, 0, rotated.out);
	assert.match(rotated.out, new RegExp(`deleted …${key.id.slice(-4)} at AWS`));
	assert.equal(world.iam.keys.length, 1);
	assert.notEqual(world.iam.keys[0].id, key.id);
	assert.match(world.files["~/.aws/credentials"], new RegExp(world.iam.keys[0].id));

	world.awsLoggedIn = true;
	const removed = await run(dir, ["teardown", "--confirm"], world);
	assert.equal(removed.code, 0, removed.out);
	assert.deepEqual(world.iam.keys, []);
	assert.deepEqual(world.iam.users, {});
	assert.deepEqual(world.iam.managed, {}, "the managed policy is deleted too");
	assert.doesNotMatch(world.files["~/.aws/credentials"], /example-agent/);
});

test("aws: no MFA on the root user is red, with a step for the owner", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.iam.mfa = 0;
	const { out } = await run(dir, ["verify"], world);
	assert.match(out, /`aws\.root-mfa` \| ❌ red \| the AWS root user has no MFA/);
	assert.match(out, /\*\*aws\.root-mfa\*\* \(console, open\): Turn on MFA for the AWS root user/);
});

const managedHooks = (t) =>
	t.replace(
		"webhooks: { connect: /webhooks/stripe/connect, billing: /webhooks/stripe/billing }",
		`webhooks:
      connect: { path: /webhooks/stripe/connect, events: [a, b], connect: true, secret_env: STRIPE_CONNECT_WEBHOOK_SECRET }
      billing: { path: /webhooks/stripe/billing, events: [c, d], secret_env: STRIPE_BILLING_WEBHOOK_SECRET }
      proof: { path: /webhooks/stripe/proof, events: [e], secret_env: STRIPE_PROOF_WEBHOOK_SECRET }`,
	);

test("stripe: creates a missing webhook into the store, corrects events, leaves a matching one alone", async () => {
	const dir = await workspace((t) => managedHooks(t).replace("  payments: [", "  payments: [STRIPE_PROOF_WEBHOOK_SECRET, "));
	const world = healthyWorld();
	const planned = await run(dir, ["plan"], world);
	assert.match(planned.out, /= no change `payments\.webhook\.connect`: webhook we_connect with its 2 events/);
	assert.match(planned.out, /~ update `payments\.webhook\.billing`: webhook we_billing events → c, d \(secret unchanged\)/);
	assert.match(planned.out, /\+ create `payments\.webhook\.proof`: webhook https:\/\/api\.example\.com\/webhooks\/stripe\/proof \(1 events\) → STRIPE_PROOF_WEBHOOK_SECRET/);
	assert.match(planned.out, /→ sync `secrets\.store\.write`: .*STRIPE_PROOF_WEBHOOK_SECRET/);
	const applied = await run(dir, ["apply", "--confirm"], world);
	assert.equal(applied.code, 0, applied.out);
	const proof = world.stripeEndpoints.find((w) => w.url.endsWith("/proof"));
	assert.equal(world.hostEnv.STRIPE_PROOF_WEBHOOK_SECRET, proof.secret);
	assert.deepEqual(world.stripeEndpoints.find((w) => w.id === "we_billing").enabled_events, ["c", "d"]);
	assert.ok(!applied.out.includes(proof.secret) && !argsHold(world, proof.secret));
	assert.equal((await run(dir, ["plan"], world)).code, 0);
});

test("stripe: an endpoint whose secret isn't stored is not re-created; rotate replaces it safely", async () => {
	const dir = await workspace((t) => withReload(managedHooks(t)));
	const world = healthyWorld();
	world.reloadCommand = RELOAD;
	delete world.hostEnv.STRIPE_CONNECT_WEBHOOK_SECRET;
	const planned = await run(dir, ["plan"], world);
	assert.match(planned.out, /⏸ blocked `payments\.webhook\.connect`: we_connect exists but STRIPE_CONNECT_WEBHOOK_SECRET isn't in the store/);
	const rotated = await run(dir, ["rotate", "STRIPE_CONNECT_WEBHOOK_SECRET", "--confirm"], world);
	assert.equal(rotated.code, 0, rotated.out);
	const fresh = world.stripeEndpoints.find((w) => w.url.endsWith("/connect"));
	assert.notEqual(fresh.id, "we_connect");
	assert.equal(fresh.connect, true);
	assert.deepEqual(fresh.enabled_events, ["a", "b"]);
	assert.equal(world.stripeEndpoints.filter((w) => w.url.endsWith("/connect")).length, 1, "the old endpoint is deleted");
	assert.equal(world.hostEnv.STRIPE_CONNECT_WEBHOOK_SECRET, fresh.secret);
	assert.match(world.secretValues.APP_ENV, new RegExp(fresh.secret));
	assert.equal(world.reloads, 1, "the app was told to reread its env before the old endpoint went");
});

test("rotate: without a reload command the old key is kept, so the running app never breaks", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	await run(dir, ["import"], world);
	const result = await run(dir, ["rotate", "RESEND_API_KEY", "--confirm", "--revoke", "key-synthetic"], world);
	assert.equal(result.code, 0, result.out);
	assert.match(result.out, /the old key was kept because the app can't be told to reload/);
	assert.ok(world.resend.keys.some((k) => k.id === "key-synthetic"));
	const fresh = world.resend.keys.find((k) => k.id !== "key-synthetic");
	assert.equal(world.hostEnv.RESEND_API_KEY, fresh.token);
	assert.ok(!result.out.includes(fresh.token));
});

test("rotate: with a reload command the app gets the new key, then the old one is revoked", async () => {
	const dir = await workspace(withReload);
	const world = healthyWorld();
	world.reloadCommand = RELOAD;
	await run(dir, ["import"], world);
	const result = await run(dir, ["rotate", "RESEND_API_KEY", "--confirm", "--revoke", "key-synthetic"], world);
	assert.equal(result.code, 0, result.out);
	assert.match(result.out, /revoked key-synthetic/);
	assert.deepEqual(world.resend.keys.map((k) => k.id), [world.resend.keys[0].id]);
	assert.notEqual(world.resend.keys[0].id, "key-synthetic");
	assert.equal(world.reloads, 1);
	const order = world.calls.map((c) => c.join(" "));
	const reloadAt = order.findIndex((c) => c.includes(RELOAD));
	const revokeAt = order.findIndex((c) => c.includes("api-keys delete key-synthetic"));
	assert.ok(reloadAt > -1 && reloadAt < revokeAt, "reload happens before the old key is revoked");
});

test("pickup: Google's downloaded client JSON goes to the store and mirrors, then the Trash", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	const client = { web: { client_id: "999-new.apps.googleusercontent.com", client_secret: "GOCSPX-syntheticSecretValue", redirect_uris: [] } };
	world.files["~/Downloads/client_secret_999.json"] = JSON.stringify(client);
	const preview = await run(dir, ["gates", "pickup", "google.client", "--file", "~/Downloads/client_secret_999.json"], world);
	assert.equal(preview.code, 10);
	assert.equal(world.hostEnv.GOOGLE_CLIENT_ID, "123-abc.apps.googleusercontent.com", "nothing changes without --confirm");
	const done = await run(dir, ["gates", "pickup", "google.client", "--file", "~/Downloads/client_secret_999.json", "--confirm"], world);
	assert.equal(done.code, 0, done.out);
	assert.equal(world.hostEnv.GOOGLE_CLIENT_ID, "999-new.apps.googleusercontent.com");
	assert.equal(world.hostEnv.GOOGLE_CLIENT_SECRET, "GOCSPX-syntheticSecretValue");
	assert.match(world.secretValues.APP_ENV, /GOOGLE_CLIENT_SECRET=GOCSPX-syntheticSecretValue/);
	assert.equal(world.trashed.length, 1);
	assert.match(world.trashed[0], /\/Downloads\/client_secret_999\.json$/);
	assert.ok(!done.out.includes("GOCSPX-") && !argsHold(world, "GOCSPX-syntheticSecretValue"));
});

test("pickup: names exactly what's missing from a hand-off file", () => {
	assert.deepEqual(parseHandoff("A=1\nB=two\n", ["B"]), { B: "two" });
	assert.throws(() => parseHandoff('{"web":{"client_id":"x"}}', ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]), /doesn't have GOOGLE_CLIENT_SECRET/);
});

const withBootstrap = (t) => t.replace(/ {4}health: \/health(\r?\n)/, "    health: /health$1    bootstrap: infra/bootstrap.sh$1");
const SCRIPT = "#!/usr/bin/env bash\nset -euo pipefail\necho \"connector ${TUNNEL_TOKEN:+set}\"\n";

test("host: a new server is planned with its cost, refused without --accept-cost, then built and torn down", async () => {
	const dir = await workspace(withBootstrap, { "infra/bootstrap.sh": SCRIPT });
	const world = healthyWorld();
	world.noInstance = true;
	world.files["~/.ssh/example-prod.pub"] = "ssh-ed25519 AAAAsynthetic example\n";
	const planned = await run(dir, ["plan"], world);
	for (const line of [
		/\+ create `api_host\.host\.key`: key pair example-api/,
		/\+ create `api_host\.host\.firewall`: security group example-api: SSH only \(web traffic comes through the tunnel\)/,
		/\+ create `api_host\.host\.instance`: t3\.micro instance example-api .* 💲 about US\$10 a month/,
		/\+ create `api_host\.host\.address`: Elastic IP.* 💲 about US\$3\.65 a month/,
		/\+ create `api_host\.host\.bootstrap`: wait for SSH, then run infra\/bootstrap\.sh on the host with tunnel example-api's token on stdin/,
	])
		assert.match(planned.out, line);

	const refused = await run(dir, ["apply", "--confirm"], world);
	assert.equal(refused.code, 1);
	assert.match(refused.out, /costs money \(about US\$10 a month.*\); nothing was changed/);
	assert.deepEqual([world.ec2.keyPairs, world.ec2.groups, world.ec2.instances], [[], [], []], "nothing half-built");

	const built = await run(dir, ["apply", "--confirm", "--accept-cost"], world);
	assert.equal(built.code, 0, built.out);
	const [instance] = world.ec2.instances;
	assert.equal(instance.type, "t3.micro");
	assert.ok(instance.args.includes("HttpTokens=required,HttpEndpoint=enabled"));
	assert.ok(instance.args.some((a) => a.includes("Encrypted=true")));
	assert.deepEqual(world.ec2.groups[0].ports, [22]);
	assert.equal(world.ec2.addresses[0].InstanceId, instance.InstanceId);
	assert.equal(world.bootstrapRuns.length, 1);
	assert.equal(world.bootstrapRuns[0].script, SCRIPT);
	assert.equal(world.bootstrapRuns[0].env, "TUNNEL_TOKEN=TUNNELsyntheticTOKENnotreal\n");
	assert.match(world.bootstrapRuns[0].host, /@203\.0\.113\.99$/, "SSH goes to the new fixed address");
	assert.ok(!argsHold(world, "TUNNELsyntheticTOKENnotreal") && !built.out.includes("TUNNELsynthetic"));

	const removed = await run(dir, ["teardown", "--confirm"], world);
	assert.equal(removed.code, 0, removed.out);
	assert.match(removed.out, /Elastic IP 203\.0\.113\.99[\s\S]*instance i-new\d+ \(terminated\)[\s\S]*security group[\s\S]*key pair example-api/);
	assert.deepEqual([world.ec2.keyPairs, world.ec2.groups, world.ec2.instances, world.ec2.addresses], [[], [], [], []]);
});

test("host: an existing server is never rebuilt", async () => {
	const dir = await workspace(withBootstrap, { "infra/bootstrap.sh": SCRIPT });
	const { out } = await run(dir, ["plan"], healthyWorld());
	assert.match(out, /= no change `api_host\.host`: instance example-api exists/);
});

test("secrets in fixtures stay out of every report", async () => {
	const dir = await workspace(withAgent);
	const world = healthyWorld();
	for (const argv of [["plan"], ["verify"], ["gates", "--all"], ["doctor"]]) {
		const { out } = await run(dir, argv, world);
		assert.ok(!out.includes(FAKE_SECRET), argv.join(" "));
	}
});

test("stripe: no endpoint is created while the store can't be read, since its secret is shown only once", async () => {
	const dir = await workspace(managedHooks);
	const world = healthyWorld();
	world.sshDown = true;
	const planned = await run(dir, ["plan"], world);
	assert.match(planned.out, /⏸ blocked `payments\.webhook\.proof`: no endpoint for .*\/proof; not creating one until the secret store can be read/);
	await run(dir, ["apply", "--confirm"], world);
	assert.ok(!world.stripeEndpoints.some((w) => w.url.endsWith("/proof")));
});

test("agent policy: a changed policy becomes a new default version, not a replacement", async () => {
	const dir = await workspace(withAgent);
	const world = healthyWorld();
	await run(dir, ["apply", "--confirm"], world);
	const arn = "arn:aws:iam::000000000000:policy/stack-setup-agent-example-app";
	world.iam.managed[arn].versions.push({ Version: "2012-10-17", Statement: [] }); // someone edited it by hand
	const planned = await run(dir, ["plan"], world);
	assert.match(planned.out, /~ update `api_host\.agent\.policy`: .*\(new version; the old one is kept until five exist\)/);
	await run(dir, ["apply", "--confirm"], world);
	assert.equal(world.iam.managed[arn].versions.length, 3);
	assert.equal((await run(dir, ["plan"], world)).code, 0);
});
