import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	copyFile,
	readFile,
	writeFile,
	rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const source = resolve("skills/secure-key-handoff/scripts/handoff.mjs");
const original = await readFile(source, "utf8");
const scratch = await mkdtemp(join(tmpdir(), "handoff-guards-"));
const report = [];
try {
	await mkdir(join(scratch, "skills/secure-key-handoff/scripts"), {
		recursive: true,
	});
	await mkdir(join(scratch, "tests"));
	for (const file of ["handoff.test.mjs", "fields.test.mjs"])
		await copyFile(resolve("tests", file), join(scratch, "tests", file));
	const target = join(scratch, "skills/secure-key-handoff/scripts/handoff.mjs");
	await writeFile(target, original);
	const run = () =>
		spawnSync(
			process.execPath,
			["--test", "tests/handoff.test.mjs", "tests/fields.test.mjs"],
			{
			cwd: scratch,
			encoding: "utf8",
				timeout: 60000,
			},
		);
	assert.equal(run().status, 0, "Baseline must pass");
	for (const [name, before, after] of [
		["envelope version", "envelope.version !== 1 ||", ""],
		["request expiration", "Date.parse(r.expiresAt) <= Date.now()", "false"],
		["live key on a test request", 'request.environment !== "live" &&', "false &&"],
		[
			"single use",
			'writeFile(used, new Date().toISOString(), { flag: "wx"',
			'writeFile(used, new Date().toISOString(), { flag: "w"',
		],
		["replace every assignment", 'sets(name, l) ? [] : [l]', "[l]"],
		["git-ignored env file", 'if (git("check-ignore", "-q").status !== 0)', "if (false)"],
	]) {
		assert.equal(original.split(before).length, 2);
		await writeFile(target, original.replace(before, after));
		const result = run();
		assert.notEqual(result.status, 0);
		assert.ok(
			result.stdout.includes("ERR_ASSERTION"),
			"Must fail a behavior assertion, not compilation",
		);
		report.push({ name, mutant: "killed" });
	}
	assert.equal(await readFile(source, "utf8"), original);
	console.log(
		JSON.stringify({
			baseline: "passed",
			sourceUnchanged: true,
			sourceSha256: createHash("sha256").update(original).digest("hex"),
			checks: report,
		}),
	);
} finally {
	await rm(scratch, { recursive: true, force: true });
}
