import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

export const GREEN = "green";
export const RED = "red";
export const BLOCKED = "blocked"; // couldn't check: a login or tool is missing
export const SKIPPED = "skipped";

// A failure we can name for the owner, as opposed to a bug.
export class Blocked extends Error {
	constructor(message, gate) {
		super(message);
		this.gate = gate;
	}
}

export const expandHome = (path, home = homedir()) =>
	path.startsWith("~/") ? `${home}${path.slice(1)}` : path;

function realRun(cmd, args, { input, timeoutMs = 30000 } = {}) {
	return new Promise((resolve) => {
		const child = execFile(
			cmd,
			args,
			{ timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
			(error, stdout, stderr) =>
				resolve({
					code: error ? (typeof error.code === "number" ? error.code : 127) : 0,
					missing: error?.code === "ENOENT",
					stdout,
					stderr,
				}),
		);
		if (input !== undefined) child.stdin.end(input);
	});
}

// Everything an adapter touches outside itself goes through here, so tests can
// replay recorded output and nothing in a test reaches a real provider.
export function makeContext(stack, state, overrides = {}) {
	const ctx = {
		stack,
		state,
		run: realRun,
		fetch: globalThis.fetch,
		readText: (path) => readFile(expandHome(path), "utf8"),
		now: () => new Date(),
		cache: new Map(),
		...overrides,
	};
	ctx.once = (key, make) => {
		if (!ctx.cache.has(key)) ctx.cache.set(key, make());
		return ctx.cache.get(key);
	};
	// Runs a CLI and parses its JSON; a missing tool or failed login is Blocked.
	ctx.json = async (cmd, args, { gate, input } = {}) => {
		const result = await ctx.run(cmd, args, { input });
		if (result.missing) throw new Blocked(`${cmd} is not installed`, gate);
		if (result.code !== 0)
			throw new Blocked(`${cmd} ${args[0]} failed: ${firstLine(result.stderr || result.stdout)}`, gate);
		try {
			return JSON.parse(result.stdout);
		} catch {
			throw new Error(`${cmd} ${args[0]} did not return JSON`);
		}
	};
	return ctx;
}

export const firstLine = (text = "") =>
	text.trim().split("\n")[0].slice(0, 200) || "no output";

// Reads one KEY=value from an env-style file without returning anything else.
export async function readEnvValue(ctx, path, name) {
	let text;
	try {
		text = await ctx.readText(path);
	} catch {
		return null;
	}
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (match?.[1] === name) return match[2].replace(/^(['"])(.*)\1$/, "$2").trim() || null;
	}
	return null;
}
