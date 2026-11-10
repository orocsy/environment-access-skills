import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

function realRun(cmd, args, { input, env, timeoutMs = 60000 } = {}) {
	return new Promise((resolve) => {
		const child = execFile(
			cmd,
			args,
			{ timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env },
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
		// Written to a 0600 temp file first, then moved, so no reader sees half a file.
		writeSecretFile: async (path, text) => {
			const full = expandHome(path);
			await mkdir(dirname(full), { recursive: true, mode: 0o700 });
			const temp = `${full}.${process.pid}.tmp`;
			await writeFile(temp, text, { mode: 0o600 });
			await chmod(temp, 0o600);
			await rename(temp, full);
		},
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: () => new Date(),
		cache: new Map(),
		...overrides,
	};
	ctx.once = (key, make) => {
		if (!ctx.cache.has(key)) ctx.cache.set(key, make());
		return ctx.cache.get(key);
	};
	// Runs a CLI and parses its JSON; a missing tool or failed login is Blocked.
	ctx.json = async (cmd, args, { gate, input, env } = {}) => {
		const result = await ctx.run(cmd, args, { input, env });
		if (result.missing) throw new Blocked(`${cmd} is not installed`, gate);
		if (result.code !== 0)
			throw new Blocked(`${cmd} ${args[0]} failed: ${errorText(result)}`, gate);
		try {
			return JSON.parse(result.stdout);
		} catch {
			throw new Error(`${cmd} ${args[0]} did not return JSON`);
		}
	};
	// For commands that change something: a failure is an error, not a missing login.
	ctx.call = async (cmd, args, { input, env } = {}) => {
		const result = await ctx.run(cmd, args, { input, env });
		if (result.missing) throw new Blocked(`${cmd} is not installed`);
		if (result.code !== 0) throw new Error(`${cmd} ${args.slice(0, 2).join(" ")} failed: ${errorText(result)}`);
		const text = result.stdout.trim();
		if (!text) return {};
		try {
			return JSON.parse(text);
		} catch {
			return { text };
		}
	};
	return ctx;
}

// A delete that finds nothing to delete has the outcome teardown wants.
export const alreadyGone = (error) => /\b404\b|not[ _]found|does not exist|no such/i.test(error?.message ?? "");

// CLIs such as resend print errors as JSON; keep the message and status only.
export function errorText(result) {
	const text = (result.stderr || result.stdout || "").trim();
	try {
		const { error } = JSON.parse(text);
		if (error?.message) return `${error.message}${error.statusCode ? ` (${error.statusCode})` : ""}`;
	} catch {}
	return firstLine(text);
}

// Some CLIs print tool hints (an XML-like tag line) before the real message.
export const firstLine = (text = "") =>
	text
		.trim()
		.split("\n")
		.find((line) => line.trim() && !/^<[a-z-]+[\s>]/.test(line.trim()))
		?.slice(0, 200) ?? "no output";

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
