import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const available =
	spawnSync("age", ["--version"]).status === 0 &&
	spawnSync("age-keygen", ["--help"]).status === 0;
test(
	"documented standard age round-trip and foreign recipient rejection",
	{ skip: !available },
	async () => {
		const root = await mkdtemp(join(tmpdir(), "handoff-age-"));
		const run = (bin, args) => spawnSync(bin, args, { encoding: "utf8" });
		try {
			const key = join(root, "identity.txt"),
				other = join(root, "other.txt");
			assert.equal(run("age-keygen", ["-o", key]).status, 0);
			assert.equal(run("age-keygen", ["-o", other]).status, 0);
			const recipient = run("age-keygen", ["-y", key]).stdout.trim();
			const source = join(root, "source.secret"),
				encrypted = join(root, "response.age"),
				target = join(root, "received.secret");
			await writeFile(source, "DEMO_AGE_NOT_A_CREDENTIAL", { mode: 0o600 });
			assert.equal(
				run("age", ["-r", recipient, "-o", encrypted, source]).status,
				0,
			);
			assert.equal(
				run("age", ["-d", "-i", key, "-o", target, encrypted]).status,
				0,
			);
			assert.equal(await readFile(target, "utf8"), "DEMO_AGE_NOT_A_CREDENTIAL");
			assert.notEqual(
				run("age", [
					"-d",
					"-i",
					other,
					"-o",
					join(root, "wrong.secret"),
					encrypted,
				]).status,
				0,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
