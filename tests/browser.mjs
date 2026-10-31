import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { ownerPage } from "../skills/secure-key-handoff/scripts/handoff.mjs";
const script = resolve("skills/secure-key-handoff/scripts/handoff.mjs");
const root = await mkdtemp(join(tmpdir(), "handoff-browser-"));
// BROWSER_CHANNEL=chrome uses an installed Chrome instead of a downloaded Chromium.
const browser = await chromium.launch(
	process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {},
);
let checks = 0;
try {
	for (const platform of ["resend", "stripe", "github"]) {
		const dir = join(root, platform),
			priv = join(root, platform + "-private");
		const p = spawnSync(
			process.execPath,
			[
				script,
				"prepare",
				"--platform",
				platform,
				"--environment",
				"test",
				"--label",
				platform + " demo",
				"--private-dir",
				priv,
				"--out",
				dir,
			],
			{ encoding: "utf8" },
		);
		assert.equal(p.status, 0, p.stderr);
		const info = JSON.parse(p.stdout);
		const page = await browser.newPage();
		const network = [];
		page.on("request", (r) => {
			if (r.url().startsWith("http")) network.push(r.url());
		});
		await page.goto(pathToFileURL(join(dir, "owner.html")).href);
		const fake = "DEMO_" + platform + "_VALUE\n测试";
		await page.getByLabel("粘贴密钥").fill(fake);
		const download = page.waitForEvent("download");
		await page.getByRole("button", { name: "加密并下载" }).click();
		const file = await download;
		assert.equal(
			file.suggestedFilename(),
			platform + "-test-" + info.requestId.slice(0, 8) + "-encrypted.json",
		);
		const received = join(root, platform + ".json");
		await file.saveAs(received);
		assert.equal((await readFile(received, "utf8")).includes("DEMO_"), false);
		assert.equal(await page.getByLabel("粘贴密钥").inputValue(), "");
		assert.deepEqual(network, []);
		const output = join(priv, "result.secret");
		const r = spawnSync(
			process.execPath,
			[
				script,
				"receive",
				"--request",
				join(priv, info.requestId + ".request.json"),
				"--key",
				info.privateKey,
				"--input",
				received,
				"--out",
				output,
			],
			{ encoding: "utf8" },
		);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(await readFile(output, "utf8"), fake);
		checks++;
		const request = JSON.parse(
			await readFile(join(dir, "request.json"), "utf8"),
		);
		request.expiresAt = "2000-01-01";
		const expired = join(dir, "expired.html");
		await writeFile(expired, ownerPage(request));
		await page.goto(pathToFileURL(expired).href);
		await page.getByLabel("粘贴密钥").fill("DEMO");
		await page.getByRole("button", { name: "加密并下载" }).click();
		await page.getByText("未生成文件：", { exact: false }).waitFor();
		checks++;
		await page.close();
	}
	{
		const dir = join(root, "fields"),
			priv = join(root, "fields-private");
		const p = spawnSync(
			process.execPath,
			[
				script,
				"prepare",
				"--platform",
				"stripe",
				"--environment",
				"test",
				"--label",
				"Stripe sandbox",
				"--lang",
				"en",
				"--fields",
				"STRIPE_SECRET_KEY:rk_test_|sk_test_,STRIPE_WEBHOOK_SECRET:whsec_",
				"--private-dir",
				priv,
				"--out",
				dir,
			],
			{ encoding: "utf8" },
		);
		assert.equal(p.status, 0, p.stderr);
		const info = JSON.parse(p.stdout);
		const page = await browser.newPage();
		const network = [];
		page.on("request", (r) => {
			if (r.url().startsWith("http")) network.push(r.url());
		});
		let downloads = 0;
		page.on("download", () => downloads++);
		await page.goto(pathToFileURL(join(dir, "owner.html")).href);
		await page.getByText(info.shortCode).waitFor();
		const secret = page.getByLabel("STRIPE_SECRET_KEY");
		const masked = () =>
			secret.evaluate((e) => getComputedStyle(e).webkitTextSecurity);
		assert.equal(await masked(), "disc");
		await page.getByLabel("Show what I pasted").check();
		assert.equal(await masked(), "none");
		await secret.fill("sk_live_DEMO_NOT_REAL");
		await page.getByLabel("STRIPE_WEBHOOK_SECRET").fill("whsec_DEMO");
		await page.getByRole("button", { name: "Encrypt and download" }).click();
		await page.getByText("looks like a live key", { exact: false }).waitFor();
		assert.equal(downloads, 0, "no file for a live key on a test request");
		await secret.fill("rk_test_DEMO_ONLY");
		const download = page.waitForEvent("download");
		await page.getByRole("button", { name: "Encrypt and download" }).click();
		const file = await download;
		const received = join(root, "fields.json");
		await file.saveAs(received);
		assert.equal(await secret.inputValue(), "");
		assert.equal(await masked(), "disc", "masking comes back after download");
		assert.deepEqual(network, []);
		const output = join(priv, "fields.secret");
		const r = spawnSync(
			process.execPath,
			[
				script,
				"receive",
				"--request",
				info.request,
				"--key",
				info.privateKey,
				"--input",
				root,
				"--out",
				output,
			],
			{ encoding: "utf8" },
		);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
			STRIPE_SECRET_KEY: "rk_test_DEMO_ONLY",
			STRIPE_WEBHOOK_SECRET: "whsec_DEMO",
		});
		checks++;
		await page.close();
	}
	console.log(
		`PASS: ${checks} browser cases; local HTML, download, CLI receive, no HTTP, input cleared and expired request rejected`,
	);
} finally {
	await browser.close();
	await rm(root, { recursive: true, force: true });
}
