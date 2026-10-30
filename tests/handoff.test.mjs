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
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import {
	seal,
	open,
	ownerPage,
} from "../skills/secure-key-handoff/scripts/handoff.mjs";
const script = resolve("skills/secure-key-handoff/scripts/handoff.mjs");
function requestFor(publicKey) {
	return {
		version: 1,
		id: randomUUID(),
		platform: "resend",
		environment: "test",
		label: "Demo handoff",
		publicKey,
		fingerprint: createHash("sha256")
			.update(
				Buffer.from(publicKey.replace(/-----[^-]+-----|\s/g, ""), "base64"),
			)
			.digest("hex"),
		expiresAt: new Date(Date.now() + 3600000).toISOString(),
	};
}
const keys = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

test("generic secrets round-trip without changing Unicode, JSON or newlines", async () => {
	for (const secret of [
		"DEMO_RESEND_VALUE",
		'{"api":"DEMO_PAYMENT_VALUE"}\n备注：测试',
		"line1\nline2",
	]) {
		const r = requestFor(keys.publicKey),
			e = await seal(r, secret);
		assert.equal(JSON.stringify(e).includes(secret), false);
		assert.equal(await open(r, e, keys.privateKey), secret);
	}
});
test("wrong recipient, wrong task, tampering, expired requests and changed environment fail closed", async () => {
	const r = requestFor(keys.publicKey),
		e = await seal(r, "DEMO_VALUE");
	const second = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	await assert.rejects(() => open(r, e, second.privateKey));
	for (const patch of [
		{ id: randomUUID() },
		{ environment: "live" },
		{ platform: "stripe" },
		{ version: 2 },
	])
		await assert.rejects(() => open(r, { ...e, ...patch }, keys.privateKey));
	const b = Buffer.from(e.data, "base64");
	b[0] ^= 1;
	await assert.rejects(() =>
		open(r, { ...e, data: b.toString("base64") }, keys.privateKey),
	);
	await assert.rejects(() =>
		open({ ...r, expiresAt: "2000-01-01" }, e, keys.privateKey),
	);
	await assert.rejects(() => seal({ ...r, expiresAt: "2000-01-01" }, "DEMO"));
	await assert.rejects(() => seal(r, "x".repeat(16385)));
	await assert.rejects(() =>
		open({ ...r, fingerprint: "wrong" }, e, keys.privateKey),
	);
});
test("HTML escapes supplied labels and blocks network, with no private key or storage", () => {
	const page = ownerPage({
		...requestFor(keys.publicKey),
		label: "</script><img src=x onerror=alert(1)>",
	});
	assert.equal(page.includes("</script><img"), false);
	assert.ok(page.includes("connect-src 'none'"));
	assert.equal(page.includes("PRIVATE KEY"), false);
	assert.equal(page.includes("localStorage"), false);
});
test("CLI prepare, owner seal and receive write only expected public and private artifacts", async () => {
	const root = await mkdtemp(join(tmpdir(), "handoff-test-"));
	const run = (args, input) =>
		spawnSync(process.execPath, [script, ...args], { encoding: "utf8", input });
	try {
		const priv = join(root, "private"),
			out = join(root, "delivery");
		const prepared = run([
			"prepare",
			"--platform",
			"resend",
			"--environment",
			"test",
			"--label",
			"Resend demo",
			"--private-dir",
			priv,
			"--out",
			out,
		]);
		assert.equal(prepared.status, 0, prepared.stderr);
		const info = JSON.parse(prepared.stdout),
			pinned = join(priv, info.requestId + ".request.json");
		assert.deepEqual((await readdir(out)).sort(), [
			"owner.html",
			"public.pem",
			"request.json",
		]);
		assert.equal(
			(await readFile(join(out, "owner.html"), "utf8")).includes("PRIVATE KEY"),
			false,
		);
		const encrypted = join(root, "encrypted.json");
		const value = "DEMO_SECRET_NOT_A_CREDENTIAL";
		const sealed = run(
			[
				"seal",
				"--request",
				join(out, "request.json"),
				"--out",
				encrypted,
				"--stdin",
				"true",
			],
			value,
		);
		assert.equal(sealed.status, 0, sealed.stderr);
		assert.equal((sealed.stdout + sealed.stderr).includes(value), false);
		const dest = join(priv, "value.secret");
		const args = [
			"receive",
			"--request",
			pinned,
			"--key",
			info.privateKey,
			"--input",
			encrypted,
			"--out",
			dest,
		];
		const received = run(args);
		assert.equal(received.status, 0, received.stderr);
		assert.equal((received.stdout + received.stderr).includes(value), false);
		assert.equal(await readFile(dest, "utf8"), value);
		assert.notEqual(run(args).status, 0, "cannot overwrite an existing secret");
		if (process.platform !== "win32") {
			assert.equal((await stat(info.privateKey)).mode & 0o777, 0o600);
			assert.equal((await stat(dest)).mode & 0o777, 0o600);
		}
		const gitDir = join(root, "checkout");
		await mkdir(join(gitDir, ".git"), { recursive: true });
		assert.notEqual(
			run(["receive", ...args.slice(1, -1), join(gitDir, "bad.secret")]).status,
			0,
		);
		assert.equal((await readdir(gitDir)).includes("bad.secret"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
