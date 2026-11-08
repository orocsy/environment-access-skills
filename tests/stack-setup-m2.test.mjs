import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { updateEnv } from "../skills/stack-setup/scripts/lib/envfile.mjs";
import { main } from "../skills/stack-setup/scripts/stack.mjs";
import { FAKE_SECRET, healthyWorld, overridesFor } from "./stack-setup/world.mjs";

const EXAMPLE = resolve("docs/stack-setup/example.stack.yaml");

class Sink {
	text = "";
	write(chunk) {
		this.text += chunk;
	}
}

async function workspace(edit = (text) => text) {
	const dir = await mkdtemp(join(tmpdir(), "stack-m2-"));
	await mkdir(join(dir, "infra/stack"), { recursive: true });
	await writeFile(join(dir, "infra/stack/stack.yaml"), edit(await readFile(EXAMPLE, "utf8")));
	return dir;
}

async function run(dir, argv, world, extra = {}) {
	const out = new Sink();
	const code = await main(argv, { cwd: dir, out, ...overridesFor(world), sleep: async () => {}, ...extra });
	return { code, out: out.text };
}

const readState = async (dir) => JSON.parse(await readFile(join(dir, "infra/stack/.stack/state.json"), "utf8"));

// A world where the app has no email yet: no Resend domain, no key, no EMAIL_FROM.
function noEmailWorld() {
	const world = healthyWorld();
	world.resend.domains = [];
	world.resend.keys = [];
	delete world.hostEnv.RESEND_API_KEY;
	delete world.hostEnv.EMAIL_FROM;
	return world;
}

const writes = (world) =>
	world.calls.filter(
		([cmd, ...args]) =>
			(cmd === "fetch" && args[0] !== "GET" && !args[1].includes("/webhooks/")) ||
			(cmd === "resend" && ["create", "verify", "delete"].includes(args[1])) ||
			(cmd === "gh" && args[0] === "secret") ||
			(cmd === "ssh" && args.at(-1).startsWith("umask")) ||
			(cmd === "vercel" && args.includes("-X")),
	);

test("envfile: replaces every copy of a name, removes, appends, refuses newlines", () => {
	const before = "# box env\nA=1\nB=2\nexport A=old\nC=3";
	assert.equal(updateEnv(before, { A: "new", D: "4" }, ["C"]), "# box env\nA=new\nB=2\nD=4\n");
	assert.equal(updateEnv("", { A: "1" }), "A=1\n");
	assert.throws(() => updateEnv("", { A: "1\nB=2" }), /one line/);
	assert.throws(() => updateEnv("", { "a-b": "1" }), /bad env name/);
});

test("plan: a converged stack has nothing to change", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	const { code, out } = await run(dir, ["plan"], world);
	assert.equal(code, 0, out);
	assert.match(out, /Nothing to change\./);
	assert.match(out, /= no change `api_host\.dns`/);
	assert.match(out, /= no change `email\.key`: RESEND_API_KEY already in the store/);
	assert.match(out, /= no change `web\.example-console\.env\.API_URL`: example-console: API_URL present \(sensitive, not compared\)/);
	assert.match(out, /= no change `web\.example-console\.env\.NEXT_PUBLIC_API_URL`: example-console: NEXT_PUBLIC_API_URL=https:\/\/api\.example\.com/);
	assert.deepEqual(writes(world), []);
});

test("apply: new email end to end, then a second apply changes nothing, then teardown removes only what it made", async () => {
	const dir = await workspace((t) => t.replace("subdomain: mail ", "subdomain: news "));
	const world = noEmailWorld();
	assert.equal((await run(dir, ["import"], world)).code, 0, "existing resources are recorded first");

	const planned = await run(dir, ["plan"], world);
	assert.equal(planned.code, 10);
	for (const line of [
		/\+ create `email\.domain`: Resend domain news\.example\.com in ap-northeast-1/,
		/\+ create `email\.records`: the new domain's DNS records in cloudflare/,
		/⏳ wait `email\.verification`/,
		/\+ create `email\.key`: send-only key for news\.example\.com → RESEND_API_KEY/,
		/→ sync `secrets\.store\.write`: server-env ~\/example-app\/app\.env: set RESEND_API_KEY, EMAIL_FROM=Example <no-reply@news\.example\.com>/,
		/→ sync `secrets\.mirror\.APP_ENV`/,
	])
		assert.match(planned.out, line);

	const unconfirmed = await run(dir, ["apply"], world);
	assert.equal(unconfirmed.code, 10);
	assert.match(unconfirmed.out, /Run again with --confirm/);
	assert.deepEqual(writes(world), [], "apply without --confirm changes nothing");

	const applied = await run(dir, ["apply", "--confirm"], world);
	assert.equal(applied.code, 0, applied.out);
	assert.match(applied.out, /6 done/);
	const domain = world.resend.domains.find((d) => d.name === "news.example.com");
	assert.ok(domain.verifyRequested);
	assert.deepEqual(world.records.map((r) => `${r.type} ${r.name}`), ["TXT resend._domainkey.news.example.com", "MX send.news.example.com", "TXT send.news.example.com"]);
	assert.equal(world.records[1].priority, 10);
	const key = world.resend.keys.find((k) => k.domain === domain.id);
	assert.equal(key.name, "example-app news.example.com send-only (stack-setup)");
	assert.equal(world.hostEnv.RESEND_API_KEY, key.token, "the minted key reached the store");
	assert.equal(world.hostEnv.EMAIL_FROM, "Example <no-reply@news.example.com>");
	assert.equal(world.hostEnv.STRIPE_SECRET_KEY, FAKE_SECRET, "other store values are kept");
	assert.match(world.secretValues.APP_ENV, new RegExp(`RESEND_API_KEY=${key.token}`), "the mirror got the new store");
	const state = JSON.stringify(await readState(dir));
	for (const secret of [key.token, FAKE_SECRET]) {
		assert.ok(!applied.out.includes(secret), "no secret in output");
		assert.ok(!state.includes(secret), "no secret in state");
	}
	for (const call of world.calls) assert.ok(!call.slice(1).some((a) => typeof a === "string" && a.includes(key.token)), `secret in arguments: ${call[0]}`);

	const again = await run(dir, ["plan"], world);
	assert.equal(again.code, 0, again.out);
	assert.match(again.out, /Nothing to change\./);

	const verified = await run(dir, ["verify"], world);
	assert.match(verified.out, /`email\.domain` \| ✅ green \| news\.example\.com verified/);

	const preview = await run(dir, ["teardown"], world);
	assert.equal(preview.code, 10);
	assert.match(preview.out, /Would remove 7 things/);
	assert.doesNotMatch(preview.out, /cloudflare\.zone|aws\./, "imported resources are never listed");
	const before = writes(world).length;
	await run(dir, ["teardown"], world);
	assert.equal(writes(world).length, before, "teardown without --confirm changes nothing");

	const removed = await run(dir, ["teardown", "--confirm"], world);
	assert.equal(removed.code, 0, removed.out);
	assert.match(removed.out, /from the server-env store[\s\S]*Resend key .* \(revoked\)[\s\S]*TXT send\.news[\s\S]*Resend domain news\.example\.com/, "newest first: store, key, records, domain");
	assert.match(removed.out, /🗑 EMAIL_FROM from the server-env store/);
	assert.match(removed.out, /🗑 RESEND_API_KEY from the server-env store/);
	assert.equal(world.resend.keys.length, 0);
	assert.equal(world.resend.domains.length, 0);
	assert.deepEqual(world.records, []);
	assert.equal(world.hostEnv.RESEND_API_KEY, undefined);
	assert.equal(world.hostEnv.STRIPE_SECRET_KEY, FAKE_SECRET);
	assert.ok(world.secrets.includes("APP_ENV"), "a mirror that existed before is not deleted");
	assert.ok(world.cname, "the imported tunnel record is untouched");
	const after = await readState(dir);
	assert.deepEqual(Object.values(after.resources).filter((r) => r.createdBy), []);
	for (const key of ["cloudflare.zone", "aws.instance.example-api", "vercel.project.example-console"]) assert.ok(after.resources[key], `${key} kept`);
});

test("apply: stops at a DNS wait without minting, and a later apply finishes", async () => {
	const dir = await workspace((t) => t.replace("subdomain: mail ", "subdomain: news "));
	const world = noEmailWorld();
	world.resend.propagates = false;
	const first = await run(dir, ["apply", "--confirm", "--wait", "0"], world);
	assert.equal(first.code, 3, first.out);
	assert.match(first.out, /⏳ `email\.verification`: DNS for news\.example\.com is still propagating/);
	assert.equal(world.resend.keys.length, 0, "no key before the domain is verified");
	assert.equal(world.hostEnv.RESEND_API_KEY, undefined);
	assert.equal((await readState(dir)).gates["email.verification"].status, "waiting");
	world.resend.propagates = true;
	const second = await run(dir, ["apply", "--confirm"], world);
	assert.equal(second.code, 0, second.out);
	assert.doesNotMatch(second.out, /`email\.domain`|`email\.records`/, "done steps are not repeated");
	assert.ok(world.hostEnv.RESEND_API_KEY.startsWith("re_SYNTHkey"));
});

test("plan: when the store can't be read, nothing is minted", async () => {
	const dir = await workspace();
	const world = noEmailWorld();
	world.sshDown = true;
	const { out } = await run(dir, ["plan"], world);
	assert.match(out, /⏸ blocked `secrets\.store`: can't read the secret store: ssh to api_host failed/);
	assert.match(out, /= no change `email\.key`/);
	assert.doesNotMatch(out, /secrets\.store\.write/);
});

test("apply: a failed mirror stops there, keeps state, and teardown can still clean up", async () => {
	const dir = await workspace((t) => t.replace("subdomain: mail ", "subdomain: news "));
	const world = noEmailWorld();
	world.failGhSet = true;
	const result = await run(dir, ["apply", "--confirm"], world);
	assert.equal(result.code, 1);
	assert.match(result.out, /❌ `secrets\.mirror\.APP_ENV`: .*HTTP 403/);
	assert.match(result.out, /Later steps did not run/);
	const state = await readState(dir);
	assert.ok(Object.values(state.resources).some((r) => r.createdBy && r.name?.includes("send-only")));
	const removed = await run(dir, ["teardown", "--confirm"], world);
	assert.equal(removed.code, 0, removed.out);
	assert.equal(world.resend.keys.length, 0);
});

test("dns: an existing CNAME pointing elsewhere is a conflict, never overwritten", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.cname = { content: "somewhere-else.example.net", proxied: true };
	const { out } = await run(dir, ["plan"], world);
	assert.match(out, /⏸ blocked `dns`: api\.example\.com already has a CNAME to somewhere-else\.example\.net; resolve it by hand/);
	await run(dir, ["apply", "--confirm"], world);
	assert.equal(world.cname.content, "somewhere-else.example.net");
});

test("vercel: config is created when missing and corrected when different", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.vercelEnvs["example-storefront"] = [{ id: "env-1", key: "NEXT_PUBLIC_API_URL", type: "encrypted", target: ["production"], value: "https://old.example.com" }];
	const planned = await run(dir, ["plan"], world);
	assert.match(planned.out, /\+ create `web\.example-storefront\.env\.API_URL`: example-storefront: API_URL=https:\/\/api\.example\.com \(production, preview\)/);
	assert.match(planned.out, /~ update `web\.example-storefront\.env\.NEXT_PUBLIC_API_URL`: example-storefront: NEXT_PUBLIC_API_URL → https:\/\/api\.example\.com \(redeploy to take effect\)/);
	const applied = await run(dir, ["sync", "--confirm"], world);
	assert.equal(applied.code, 0, applied.out);
	const envs = world.vercelEnvs["example-storefront"];
	assert.equal(envs.find((e) => e.key === "NEXT_PUBLIC_API_URL").value, "https://api.example.com");
	assert.deepEqual(envs.find((e) => e.key === "API_URL").target, ["production", "preview"]);
	assert.equal(envs.find((e) => e.key === "API_URL").type, "encrypted");
	assert.match(world.secretValues.APP_ENV, /API_PUBLIC_URL=/, "sync also refreshes the mirrors");
});

test("local-env store: written 0600, and refused inside a Git checkout unless ignored", async () => {
	const home = await mkdtemp(join(tmpdir(), "stack-local-"));
	const envPath = join(home, "secrets", "app.env");
	const edit = (t) =>
		t
			.replace("subdomain: mail ", "subdomain: news ")
			.replace("canonical: { type: server-env, host: api_host, path: ~/example-app/app.env }", `canonical: { type: local-env, path: ${envPath} }`)
			.replace('- { target: server-env, name: API_PUBLIC_URL, value: "https://api.example.com" }', '- { target: local-env, name: API_PUBLIC_URL, value: "https://api.example.com" }');
	const dir = await workspace(edit);
	const world = noEmailWorld();
	const files = new Map();
	const extra = {
		readText: async (path) => {
			if (path in world.files) return world.files[path];
			if (files.has(path)) return files.get(path);
			throw Object.assign(new Error("missing"), { code: "ENOENT" });
		},
		writeSecretFile: async (path, text) => {
			files.set(path, text);
			await mkdir(join(home, "secrets"), { recursive: true });
			await writeFile(path, text, { mode: 0o600 });
		},
	};
	const realGit = (cmd, args) => {
		if (cmd !== "git") return overridesFor(world).run(cmd, args);
		const r = spawnSync("git", args, { encoding: "utf8" });
		return { code: r.status, stdout: r.stdout, stderr: r.stderr, missing: !!r.error };
	};
	const runner = overridesFor(world).run;
	const result = await run(dir, ["apply", "--confirm"], world, { ...extra, run: async (cmd, args, o) => (cmd === "git" ? realGit(cmd, args) : runner(cmd, args, o)) });
	assert.equal(result.code, 0, result.out);
	const written = files.get(envPath).split("\n").filter(Boolean).sort();
	assert.equal(written.length, 3);
	assert.match(written.join("\n"), /^API_PUBLIC_URL=https:\/\/api\.example\.com\nEMAIL_FROM=Example <no-reply@news\.example\.com>\nRESEND_API_KEY=re_SYNTHkey\d+_SYNTHETICvalue\d+$/);
	assert.equal((await stat(envPath)).mode & 0o777, 0o600);

	const repo = await mkdtemp(join(tmpdir(), "stack-repo-"));
	spawnSync("git", ["init", "-q", repo]);
	const inRepo = join(repo, "app.env");
	const dir2 = await workspace((t) => edit(t).replace(envPath, inRepo));
	const refused = await run(dir2, ["apply", "--confirm"], noEmailWorld(), { ...extra, run: async (cmd, args, o) => (cmd === "git" ? realGit(cmd, args) : runner(cmd, args, o)) });
	assert.equal(refused.code, 1);
	assert.match(refused.out, /inside a Git checkout and not ignored/);
});

test("connect: lists the sign-ins and which are done", async () => {
	const dir = await workspace();
	const world = healthyWorld();
	world.awsLoggedIn = false;
	const { code, out } = await run(dir, ["connect"], world);
	assert.equal(code, 2);
	assert.match(out, /⏸ blocked `api_host`: aws sts failed/);
	assert.match(out, /\*\*aws\.login\*\* \(consent, open\)[\s\S]*aws login --profile example-app/);
	assert.doesNotMatch(out, /\*\*github\.login\*\*/, "a login that works is not listed as a step");
});

test("teardown: a re-run after things are already gone finishes and clears state", async () => {
	const dir = await workspace((t) => t.replace("subdomain: mail ", "subdomain: news "));
	const world = noEmailWorld();
	await run(dir, ["apply", "--confirm"], world);
	// Someone removed them by hand (or an earlier teardown wasn't recorded).
	const run404 = overridesFor(world).run;
	const fetch404 = overridesFor(world).fetch;
	const gone = {
		run: async (cmd, args, o) =>
			cmd === "resend" && args[1] === "delete"
				? { code: 1, stdout: JSON.stringify({ error: { message: "API key not found", code: "delete_error", statusCode: 404 } }, null, 2), stderr: "" }
				: cmd === "gh" && args[1] === "delete"
					? { code: 1, stdout: "", stderr: "failed to delete secret STACK_PROOF_ENV: HTTP 404: Not Found" }
					: run404(cmd, args, o),
		fetch: async (url, init = {}) =>
			init.method === "DELETE" ? { ok: false, status: 404, headers: new Headers(), json: async () => ({ success: false, errors: [{ message: "Record does not exist." }] }) } : fetch404(url, init),
	};
	const result = await run(dir, ["teardown", "--confirm"], world, gone);
	assert.equal(result.code, 0, result.out);
	assert.match(result.out, /\(already gone\)/);
	const state = await readState(dir);
	assert.deepEqual(Object.values(state.resources).filter((r) => r.createdBy), []);
});

test("cli: --confirm with --no-save is refused, so state always records changes", async () => {
	const dir = await workspace();
	await assert.rejects(run(dir, ["teardown", "--confirm", "--no-save"], healthyWorld()), /--no-save can't be used with --confirm/);
	await assert.rejects(run(dir, ["apply", "--confirm", "--no-save"], healthyWorld()), /--no-save can't be used with --confirm/);
});
