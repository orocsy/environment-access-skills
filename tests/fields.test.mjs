import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdtemp,
	readFile,
	writeFile,
	stat,
	rm,
	mkdir,
	readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
	seal,
	open,
	ownerPage,
	checkValue,
	envLockPath,
} from "../skills/secure-key-handoff/scripts/handoff.mjs";
const script = resolve("skills/secure-key-handoff/scripts/handoff.mjs");
const run = (args, input) =>
	spawnSync(process.execPath, [script, ...args], { encoding: "utf8", input });
const runAsync = (args) =>
	new Promise((done) => {
		const child = spawn(process.execPath, [script, ...args]);
		let stderr = "";
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (status) => done({ status, stderr }));
	});
const git = (cwd, ...args) =>
	spawnSync("git", args, { cwd, encoding: "utf8" });

async function prepared(root, extra = []) {
	const priv = join(root, "private"),
		out = join(root, "delivery");
	const p = run([
		"prepare",
		"--platform",
		"stripe",
		"--environment",
		"test",
		"--label",
		"Stripe sandbox",
		"--private-dir",
		priv,
		"--out",
		out,
		...extra,
	]);
	assert.equal(p.status, 0, p.stderr);
	const info = JSON.parse(p.stdout);
	return {
		...info,
		pinned: join(priv, info.requestId + ".request.json"),
		delivery: join(out, "request.json"),
		priv,
	};
}

test("value checks: prefixes, live keys on non-live requests, empty values", () => {
	const r = {
		environment: "test",
		fields: [{ name: "STRIPE_SECRET_KEY", prefixes: ["rk_test_", "sk_test_"] }],
	};
	assert.equal(checkValue(r, "STRIPE_SECRET_KEY", "rk_test_abc"), null);
	assert.equal(checkValue(r, "STRIPE_SECRET_KEY", "pk_test_abc"), "prefix");
	assert.equal(checkValue(r, "STRIPE_SECRET_KEY", "  "), "empty");
	assert.equal(checkValue(r, "STRIPE_SECRET_KEY", "sk_live_abc"), "live");
	assert.equal(checkValue({ environment: "test" }, "", "sk_live_abc"), "live");
	assert.equal(checkValue({ environment: "test" }, "", "x rk_live_abc"), "live");
	assert.equal(checkValue({ environment: "live" }, "", "sk_live_abc"), null);
	assert.equal(checkValue({ environment: "test" }, "", "re_abc"), null);
});

test("English page with named, masked fields and a short code", () => {
	const page = ownerPage({
		version: 1,
		id: "00000000-0000-0000-0000-000000000000",
		platform: "stripe",
		environment: "test",
		label: "Stripe sandbox",
		lang: "en",
		fields: [{ name: "STRIPE_SECRET_KEY", prefixes: ["rk_test_"] }, { name: "STRIPE_WEBHOOK_SECRET", prefixes: [] }],
		publicKey: "x",
		fingerprint: "ab".repeat(32),
		expiresAt: new Date(Date.now() + 3600000).toISOString(),
	});
	assert.ok(page.includes('lang="en"'));
	assert.ok(page.includes("Encrypt and download"));
	assert.ok(page.includes("STRIPE_WEBHOOK_SECRET"));
	assert.ok(page.includes("ABAB-ABAB-ABAB-ABAB"));
	assert.ok(page.includes("text-security"));
	assert.ok(page.includes("connect-src 'none'"));
});

test("multi-field request installs into a git-ignored env file, once", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-fields-"));
	try {
		const info = await prepared(root, [
			"--lang",
			"en",
			"--fields",
			"STRIPE_SECRET_KEY:rk_test_|sk_test_,STRIPE_WEBHOOK_SECRET:whsec_",
		]);
		assert.match(info.shortCode, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
		const values = {
			STRIPE_SECRET_KEY: "rk_test_DEMO_ONLY_1",
			STRIPE_WEBHOOK_SECRET: "whsec_DEMO_ONLY_2",
		};
		const downloads = join(root, "Downloads");
		await mkdir(downloads);
		await writeFile(join(downloads, "unrelated.json"), '{"version":1}');
		const sealed = run(
			[
				"seal",
				"--request",
				info.delivery,
				"--out",
				join(downloads, "stripe-test-encrypted.json"),
				"--stdin",
				"true",
			],
			JSON.stringify(values),
		);
		assert.equal(sealed.status, 0, sealed.stderr);

		const repo = join(root, "app");
		await mkdir(repo);
		git(repo, "init", "-q");
		await writeFile(join(repo, ".gitignore"), ".env.local\n");
		await writeFile(join(repo, ".env.local"), "KEEP=1\n");
		const receive = (envFile, more = []) =>
			run([
				"receive",
				"--request",
				info.pinned,
				"--key",
				info.privateKey,
				"--input",
				downloads,
				"--dotenv",
				envFile,
				...more,
			]);
		const ok = receive(join(repo, ".env.local"));
		assert.equal(ok.status, 0, ok.stderr);
		const said = ok.stdout + ok.stderr;
		for (const v of Object.values(values)) assert.equal(said.includes(v), false);
		assert.ok(said.includes("STRIPE_WEBHOOK_SECRET"), "names are reported");
		const env = await readFile(join(repo, ".env.local"), "utf8");
		assert.equal(
			env,
			"KEEP=1\nSTRIPE_SECRET_KEY=rk_test_DEMO_ONLY_1\nSTRIPE_WEBHOOK_SECRET=whsec_DEMO_ONLY_2\n",
		);
		if (process.platform !== "win32")
			assert.equal((await stat(join(repo, ".env.local"))).mode & 0o777, 0o600);
		const again = receive(join(repo, ".env.local"), ["--replace", "true"]);
		assert.notEqual(again.status, 0, "a request is used once");
		assert.match(again.stderr, /already used/);
		assert.equal((await readdir(info.priv)).some((f) => f.endsWith(".used")), true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("env install refuses tracked, unignored and existing variables, with a clear reason", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-env-"));
	try {
		const repo = join(root, "app");
		await mkdir(repo);
		git(repo, "init", "-q");
		git(repo, "config", "user.email", "t@example.invalid");
		git(repo, "config", "user.name", "t");
		await writeFile(join(repo, ".gitignore"), ".env.local\n");
		await writeFile(join(repo, ".env.tracked"), "");
		git(repo, "add", ".env.tracked", ".gitignore");
		git(repo, "commit", "-qm", "init");
		await writeFile(join(repo, ".env.local"), "RESEND_API_KEY=old\n");
		for (const [file, reason, extra] of [
			[".env", /not ignored by Git/, []],
			[".env.tracked", /tracked by Git|not ignored by Git/, []],
			[".env.local", /Already set: RESEND_API_KEY/, []],
		]) {
			const info = await prepared(join(root, file), []);
			const enc = join(root, file + ".enc.json");
			assert.equal(
				run(
					["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"],
					"re_DEMO_VALUE\n",
				).status,
				0,
			);
			const r = run([
				"receive",
				"--request",
				info.pinned,
				"--key",
				info.privateKey,
				"--input",
				enc,
				"--dotenv",
				join(repo, file),
				"--env-name",
				"RESEND_API_KEY",
				...extra,
			]);
			assert.notEqual(r.status, 0, file);
			assert.match(r.stderr, reason, file);
			assert.equal(r.stderr.includes("re_DEMO_VALUE"), false);
		}
		assert.equal(await readFile(join(repo, ".env.local"), "utf8"), "RESEND_API_KEY=old\n");
		const info = await prepared(join(root, "replace"), []);
		const enc = join(root, "replace.enc.json");
		run(["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"], "re_DEMO_NEW\n");
		const r = run([
			"receive", "--request", info.pinned, "--key", info.privateKey, "--input", enc,
			"--dotenv", join(repo, ".env.local"), "--env-name", "RESEND_API_KEY", "--replace", "true",
		]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(await readFile(join(repo, ".env.local"), "utf8"), "RESEND_API_KEY=re_DEMO_NEW\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("decrypting rejects a live key on a test request and wrong field sets", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-live-"));
	try {
		const info = await prepared(root, ["--fields", "STRIPE_SECRET_KEY:rk_test_"]);
		const request = JSON.parse(await readFile(info.pinned, "utf8"));
		const key = await readFile(info.privateKey, "utf8");
		for (const bad of [
			{ STRIPE_SECRET_KEY: "sk_live_DEMO" },
			{ STRIPE_SECRET_KEY: "pk_test_DEMO" },
			{ OTHER: "rk_test_DEMO" },
			{ STRIPE_SECRET_KEY: "rk_test_DEMO", EXTRA: "x" },
		])
			await assert.rejects(() =>
				seal(request, JSON.stringify(bad)).then((e) => open(request, e, key)),
			);
		const good = await seal(request, JSON.stringify({ STRIPE_SECRET_KEY: "rk_test_DEMO" }));
		assert.equal(JSON.parse(await open(request, good, key)).STRIPE_SECRET_KEY, "rk_test_DEMO");
		const single = await prepared(join(root, "single"), []);
		const sr = JSON.parse(await readFile(single.pinned, "utf8"));
		await assert.rejects(async () =>
			open(sr, await seal(sr, "sk_live_DEMO"), await readFile(single.privateKey, "utf8")),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("--replace changes every assignment of a name, so the new value wins", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-dup-"));
	try {
		const info = await prepared(root, []);
		const enc = join(root, "enc.json");
		run(["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"], "re_DEMO_NEW\n");
		const env = join(root, "outside", ".env");
		await mkdir(join(root, "outside"));
		await writeFile(env, "KEY=old1\nOTHER=1\nexport KEY=old2\n");
		const r = run([
			"receive", "--request", info.pinned, "--key", info.privateKey, "--input", enc,
			"--dotenv", env, "--env-name", "KEY", "--replace", "true",
		]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(await readFile(env, "utf8"), "KEY=re_DEMO_NEW\nOTHER=1\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("concurrent receivers: only the one that claims the request writes anything", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-race-"));
	try {
		const info = await prepared(root, []);
		const enc = join(root, "enc.json");
		run(["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"], "re_DEMO_VALUE\n");
		const outs = join(root, "outs");
		await mkdir(outs);
		const results = await Promise.all(
			Array.from({ length: 6 }, (_, i) =>
				runAsync([
					"receive", "--request", info.pinned, "--key", info.privateKey,
					"--input", enc, "--out", join(outs, `secret-${i}.txt`),
				]),
			),
		);
		assert.equal(results.filter((r) => r.status === 0).length, 1, "one receiver wins");
		assert.equal((await readdir(outs)).length, 1, "losers wrote nothing");
		for (const r of results.filter((r) => r.status !== 0)) assert.match(r.stderr, /already used/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a failed install releases the claim so the same request can be retried", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-retry-"));
	try {
		const info = await prepared(root, []);
		const enc = join(root, "enc.json");
		run(["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"], "re_DEMO_VALUE\n");
		await mkdir(join(root, "outside"));
		const env = join(root, "outside", ".env");
		await writeFile(env, "KEY=old\n");
		const args = ["receive", "--request", info.pinned, "--key", info.privateKey, "--input", enc, "--dotenv", env, "--env-name", "KEY"];
		const first = run(args);
		assert.notEqual(first.status, 0);
		assert.match(first.stderr, /Already set: KEY/);
		const second = run([...args, "--replace", "true"]);
		assert.equal(second.status, 0, second.stderr);
		assert.equal(await readFile(env, "utf8"), "KEY=re_DEMO_VALUE\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("refuses to edit an env file whose multi-line values a line edit would corrupt", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-multi-"));
	try {
		await mkdir(join(root, "outside"));
		const env = join(root, "outside", ".env");
		for (const original of ['OTHER="first\nKEY=old\nlast"\n', 'KEY="a\nb"\nOTHER=1\n']) {
			const info = await prepared(join(root, String(original.length)), []);
			const enc = join(root, `${original.length}.json`);
			run(["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"], "re_DEMO_NEW\n");
			await writeFile(env, original);
			const r = run([
				"receive", "--request", info.pinned, "--key", info.privateKey, "--input", enc,
				"--dotenv", env, "--env-name", "KEY", "--replace", "true",
			]);
			assert.notEqual(r.status, 0, original);
			assert.match(r.stderr, /multi-line|can't edit/);
			assert.equal(r.stderr.includes("re_DEMO_NEW"), false);
			assert.equal(await readFile(env, "utf8"), original, "file untouched");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("different requests installing into one env file at once all land", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-shared-"));
	try {
		await mkdir(join(root, "outside"));
		const env = join(root, "outside", ".env");
		const jobs = [];
		for (let i = 0; i < 6; i++) {
			const info = await prepared(join(root, `r${i}`), []);
			const enc = join(root, `r${i}.json`);
			run(["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"], `re_DEMO_${i}\n`);
			jobs.push(["receive", "--request", info.pinned, "--key", info.privateKey, "--input", enc, "--dotenv", env, "--env-name", `KEY_${i}`]);
		}
		const results = await Promise.all(jobs.map(runAsync));
		for (const r of results) assert.equal(r.status, 0, r.stderr);
		const lines = (await readFile(env, "utf8")).trim().split("\n").sort();
		assert.deepEqual(lines, Array.from({ length: 6 }, (_, i) => `KEY_${i}=re_DEMO_${i}`));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("an install waits while another holds the env file's lock", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-lock-"));
	try {
		await mkdir(join(root, "outside"));
		const env = join(root, "outside", ".env");
		await writeFile(env, "OTHER=1\n");
		const info = await prepared(root, []);
		const enc = join(root, "enc.json");
		run(["seal", "--request", info.delivery, "--out", enc, "--stdin", "true"], "re_DEMO_VALUE\n");
		const lock = await envLockPath(env);
		await writeFile(lock, "held by test", { flag: "wx" });
		let finished = false;
		const pending = runAsync([
			"receive", "--request", info.pinned, "--key", info.privateKey, "--input", enc, "--dotenv", env, "--env-name", "KEY",
		]).then((r) => ((finished = true), r));
		await new Promise((done) => setTimeout(done, 2000));
		assert.equal(finished, false, "receiver waits for the lock");
		assert.equal(await readFile(env, "utf8"), "OTHER=1\n", "nothing written while locked");
		await rm(lock);
		const r = await pending;
		assert.equal(r.status, 0, r.stderr);
		assert.equal(await readFile(env, "utf8"), "OTHER=1\nKEY=re_DEMO_VALUE\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("catalog keys get their researched prefixes and guidance on the page", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-guide-"));
	try {
		const info = await prepared(root, ["--lang", "en", "--fields", "STRIPE_SECRET_KEY,RESEND_API_KEY"]);
		const request = JSON.parse(await readFile(info.pinned, "utf8"));
		assert.deepEqual(request.fields.map((f) => f.prefixes), [["sk_test_", "rk_test_"], ["re_"]]);
		assert.equal(request.fields[1].guide.url, "https://resend.com/api-keys");
		const page = await readFile(join(root, "delivery", "owner.html"), "utf8");
		assert.ok(page.includes("Where to find it"));
		assert.ok(page.includes('href="https://dashboard.stripe.com/apikeys"'));
		assert.ok(page.includes("Resend does not show it again"));
		assert.ok(page.includes('rel="noopener noreferrer"'));
		assert.ok(page.includes('role="alert"'), "refusals are announced");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a key without researched guidance is refused; a guide file supplies it", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-unguided-"));
	try {
		const priv = join(root, "private");
		const base = ["prepare", "--platform", "acme", "--environment", "test", "--label", "Acme", "--private-dir", priv];
		const refused = run([...base, "--out", join(root, "a"), "--fields", "ACME_TOKEN:acme_"]);
		assert.notEqual(refused.status, 0);
		assert.match(refused.stderr, /No researched guidance for ACME_TOKEN/);
		const guides = join(root, "guides.json");
		await writeFile(guides, JSON.stringify({ ACME_TOKEN: { url: "https://acme.example/tokens", steps: ["Open Tokens and copy the test token."], source: "https://acme.example/docs/tokens", verified: "2026-10-31" } }));
		const ok = run([...base, "--out", join(root, "b"), "--fields", "ACME_TOKEN:acme_", "--guide-file", guides]);
		assert.equal(ok.status, 0, ok.stderr);
		await writeFile(guides, JSON.stringify({ ACME_TOKEN: { url: "http://acme.example/tokens", steps: ["x"], source: "https://acme.example", verified: "2026-10-31" } }));
		const insecure = run([...base, "--out", join(root, "c"), "--fields", "ACME_TOKEN:acme_", "--guide-file", guides]);
		assert.notEqual(insecure.status, 0);
		assert.match(insecure.stderr, /guide/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("serve shows the page on 127.0.0.1 only, uncached, and nothing else", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-serve-"));
	const info = await prepared(root, ["--lang", "en", "--fields", "RESEND_API_KEY"]);
	const child = spawn(process.execPath, [script, "serve", "--page", join(root, "delivery", "owner.html"), "--port", "0"]);
	try {
		const url = await new Promise((done, fail) => {
			let out = "";
			child.stdout.on("data", (d) => {
				out += d;
				const m = out.match(/"url":"([^"]+)"/);
				if (m) done(m[1]);
			});
			child.on("exit", () => fail(new Error("serve exited")));
		});
		assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
		const page = await fetch(url);
		assert.equal(page.status, 200);
		assert.equal(page.headers.get("cache-control"), "no-store");
		assert.ok((await page.text()).includes(info.shortCode));
		assert.equal((await fetch(new URL("/request.json", url))).status, 404);
	} finally {
		child.kill();
		await rm(root, { recursive: true, force: true });
	}
});
