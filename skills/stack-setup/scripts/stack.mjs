#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseYaml } from "./lib/yaml.mjs";
import { validateStack } from "./lib/schema.mjs";
import { loadState, saveState } from "./lib/state.mjs";
import { makeContext } from "./lib/context.mjs";
import { allGates, doctor, importResources, packFor, verify, worst } from "./lib/runner.mjs";
import { interviewScreen, route, stepScreen, timeline } from "./lib/guide.mjs";
import { closeByChecks, setGate } from "./lib/gates.mjs";
import { applyMarkdown, connectMarkdown, doctorMarkdown, gatesMarkdown, planMarkdown, teardownMarkdown, teardownResultMarkdown, verifyMarkdown } from "./lib/report.mjs";
import { CHANGES, apply, plan, teardown, teardownList } from "./lib/apply.mjs";
import { pickup, rotate } from "./lib/rotate.mjs";

// Bootstrap scripts are named relative to the app repo, which holds the stack file.
function repoRootOf(stackPath, cwd) {
	let dir = dirname(stackPath);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const up = dirname(dir);
		if (up === dir) return cwd;
		dir = up;
	}
}

const strip = ({ run, ...step }) => step;
import { adapters as builtIn } from "./adapters/index.mjs";

const USAGE = `stack <command> [--stack path/to/stack.yaml]

Read only:
  doctor     check tools, logins and deadlines
  connect    the sign-ins to do before any work, and which are done
  verify     check every capability and secret store; green/red per item
  import     find resources that already exist and record their IDs in state
  gates      list the human steps still open (--all for every one)
  plan       show what apply would create, change or leave alone

Changes (each shows its plan and does nothing without --confirm):
  apply      create what's missing, mint keys, write the secret store and mirrors
  sync       copy the secret store to every mirror and correct config values
  teardown   remove everything stack-setup created (never what it imported)
  rotate <name>   replace a key or secret: new one in, app reloaded, old one revoked
                  (an env name a provider mints, or agent-key; --revoke <id> for a key made by hand)
  guide           the next step that's yours, with everything you need on one screen
  guide all       the whole route: tracks, what's waiting, deadlines, what costs money
  guide done [id] [--note text]   say a step is finished (steps with a check close themselves)
  guide stuck "<what happened>"   record a problem on the current step for the agent to answer
  guide ask       the up-front questions a jurisdiction pack asks, with your answers
  gates set <id> <open|waiting|done|skipped> [--by name] [--note text]
  gates pickup <id> --file <path>   store what a person handed back (Google's client
                  JSON or a KEY=value file), refresh the mirrors, move the file to the Trash

Options:
  --stack <file>    default: ./infra/stack/stack.yaml, then ./stack.yaml
  --confirm         actually make the changes the plan shows
  --accept-cost     allow steps that cost money (only after the owner agreed)
  --wait <minutes>  how long apply waits for DNS verification (default 10)
  --report <file>   also write the Markdown report to this file
  --json            print JSON instead of Markdown
  --no-save         don't update .stack/state.json
`;

const LATER = {};
const COMMANDS = ["verify", "import", "gates", "doctor", "connect", "plan", "apply", "sync", "teardown", "rotate", "guide"];

export async function loadStack(path, adapters = builtIn) {
	return (await loadStackChecked(path, adapters)).stack;
}

// Warnings don't stop anything; they're shown at the top of plan, doctor and guide.
async function loadStackChecked(path, adapters) {
	const { stack, errors, warnings } = validateStack(parseYaml(await readFile(path, "utf8")), adapters);
	if (errors.length) throw new Error(`${path} has problems:\n- ${errors.join("\n- ")}`);
	return { stack, warnings };
}

export async function main(argv, { adapters = builtIn, out = process.stdout, cwd = process.cwd(), ...overrides } = {}) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			stack: { type: "string" },
			report: { type: "string" },
			json: { type: "boolean" },
			"no-save": { type: "boolean" },
			all: { type: "boolean" },
			by: { type: "string" },
			note: { type: "string" },
			confirm: { type: "boolean" },
			"accept-cost": { type: "boolean" },
			revoke: { type: "string", multiple: true },
			file: { type: "string" },
			wait: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	const [command, ...rest] = positionals;
	if (!command || values.help) {
		out.write(`${USAGE}\n`);
		return command || values.help ? 0 : 64;
	}
	if (LATER[command]) {
		out.write(`stack ${command} arrives in ${LATER[command]}.\n`);
		return 64;
	}
	if (!COMMANDS.includes(command)) {
		out.write(`Unknown command "${command}".\n\n${USAGE}\n`);
		return 64;
	}
	if (values.confirm && values["no-save"])
		throw new Error("--no-save can't be used with --confirm: state must record what was changed");
	const stackPath =
		values.stack ? resolve(cwd, values.stack) : [join(cwd, "infra/stack/stack.yaml"), join(cwd, "stack.yaml")].find(existsSync);
	if (!stackPath) throw new Error("No stack.yaml found; pass --stack <file>");
	const { stack, warnings } = await loadStackChecked(stackPath, adapters);
	if (warnings.length && ["plan", "doctor", "guide", "apply"].includes(command) && !values.json)
		out.write(`Notes for this ${stack.jurisdiction ?? ""} stack:\n${warnings.map((w) => `  ⚠ ${w}`).join("\n")}\n\n`);
	const statePath = join(dirname(stackPath), ".stack", "state.json");
	const state = await loadState(statePath, stack.app);
	const ctx = makeContext(stack, state, { repoRoot: repoRootOf(stackPath, cwd), ...overrides });
	const at = ctx.now().toISOString();
	const print = (data, markdown) => out.write(values.json ? `${JSON.stringify(data, null, 2)}\n` : markdown);
	let code = 0;

	if (command === "verify") {
		const result = await verify(ctx, adapters);
		const markdown = verifyMarkdown(stack, result, at);
		print(result, markdown);
		if (values.report) await writeFile(resolve(cwd, values.report), markdown);
		const level = worst(result.checks);
		code = level === "red" ? 1 : level === "blocked" ? 2 : 0;
	} else if (command === "import") {
		const result = await importResources(ctx, adapters);
		print(
			result,
			[
				`## stack import: ${stack.app}`,
				"",
				...result.found.map((f) => `- ${f.key}: ${Object.entries(f.fields).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`).join(", ")}`),
				...result.problems.map((p) => `- ⚠ ${p.capability}: ${p.detail}`),
				"",
			].join("\n"),
		);
		code = result.problems.length ? 2 : 0;
	} else if (command === "gates") {
		const gates = allGates(ctx, adapters);
		if (rest[0] === "set") {
			const [, id, status] = rest;
			setGate(gates, state, id, status, { by: values.by, note: values.note, now: at });
			out.write(`${id} → ${status}\n`);
		} else if (rest[0] === "pickup") {
			const gate = gates.find((g) => g.id === rest[1]);
			if (!gate) throw new Error(`no gate "${rest[1]}"; run stack gates to list them`);
			if (!values.file) throw new Error("pass --file <the downloaded or decrypted file>");
			if (!values.confirm) {
				out.write(`Would store ${(gate.receive ?? []).join(", ")} from ${values.file} in the ${stack.secrets?.canonical?.type ?? "missing"} store, refresh its mirrors${stack.secrets?.canonical?.reload ? ", reload the app" : ""}, then move the file to the Trash.\nRun again with --confirm.\n`);
				return 10;
			}
			const result = await pickup(ctx, gate, values.file);
			if (!gate.closedBy) state.gates[gate.id] = { status: "done", at, by: "pickup" };
			out.write(`Stored ${result.names.join(", ")}; mirrors ${result.mirrors.join(", ") || "none"}${result.reloaded ? "; app reloaded" : ""}. The file is in the Trash.\n`);
		} else print(gates, gatesMarkdown(gates, { all: values.all }));
	} else if (command === "doctor") {
		const result = await doctor(ctx, adapters);
		print(result, doctorMarkdown(stack, result, at));
		code = worst(result.checks) === "green" ? 0 : 2;
	} else if (command === "connect") {
		const result = await doctor(ctx, adapters);
		const preflight = allGates(ctx, adapters).filter((g) => g.bundle === "preflight");
		closeByChecks(preflight, structuredClone(state), result.checks, at);
		const logins = result.checks.filter((c) => c.capability !== "tools" || c.status !== "green");
		print({ checks: logins, gates: preflight }, connectMarkdown(stack, logins, preflight));
		code = worst(logins) === "green" ? 0 : 2;
	} else if (command === "guide") {
		const pack = packFor(stack);
		const sub = rest[0];
		if (sub === "ask") {
			if (!pack) throw new Error("this stack has no jurisdiction:, so there are no up-front questions");
			out.write(interviewScreen(pack, stack));
			return 0;
		}
		if (pack && pack.missingAnswers(stack).length && sub !== "all") {
			out.write(`Answer these first (they go in stack.yaml under profile:):\n\n${interviewScreen(pack, stack)}`);
			return 10;
		}
		const gates = allGates(ctx, adapters);
		const r = route(gates, state, ctx.now());
		if (sub === "all") print(r, timeline(stack, r));
		else if (sub === "done") {
			const id = rest[1] ?? r.next?.id;
			if (!id) throw new Error("nothing is ready to mark done; name the step: stack guide done <id>");
			setGate(gates, state, id, "done", { by: values.by ?? "owner", note: values.note, now: at });
			const after = route(allGates(ctx, adapters), state, ctx.now());
			out.write(`${id} → done\n\n${stepScreen(stack, after)}`);
		} else if (sub === "stuck") {
			const id = r.next?.id;
			const text = rest.slice(1).join(" ").trim();
			if (!id || !text) throw new Error('say what happened: stack guide stuck "<what happened>"');
			const entry = state.gates[id] ?? { status: "open" };
			entry.stuck = [...(entry.stuck ?? []), { at, text }];
			state.gates[id] = entry;
			out.write(`Noted on ${id}. The agent reads this next time and answers; the step stays open.\n`);
		} else print(r.next ? { next: r.next } : { next: null }, stepScreen(stack, r));
	} else if (command === "rotate") {
		const target = rest[0];
		if (!target) throw new Error("say what to rotate, like stack rotate RESEND_API_KEY");
		if (!values.confirm) {
			out.write(`Would replace ${target}: make a new one, put it in the store and mirrors${stack.secrets?.canonical?.reload ? ", reload the app" : ""}, then revoke the old one. Run again with --confirm.\n`);
			return 10;
		}
		out.write(`${await rotate(ctx, adapters, target, { revoke: values.revoke ?? [] })}\n`);
	} else if (command === "teardown") {
		const list = teardownList(state);
		if (!values.confirm) {
			print(list, teardownMarkdown(stack, list));
			return list.length ? 10 : 0;
		}
		const result = await teardown(ctx, adapters);
		print(result, teardownResultMarkdown(stack, result));
		code = result.failed ? 1 : 0;
	} else {
		const waitMinutes = values.wait === undefined ? 10 : Number(values.wait);
		if (!Number.isFinite(waitMinutes) || waitMinutes < 0) throw new Error("--wait takes a number of minutes");
		const steps = await plan(ctx, adapters, { mirrors: command === "sync", waitMinutes });
		const shown = command === "sync" ? steps.filter((s) => s.capability === "secrets" || s.id.includes(".env.")) : steps;
		const pending = shown.filter((s) => CHANGES.includes(s.kind));
		if (command === "plan" || !values.confirm || !pending.length) {
			print(shown.map(({ run, ...s }) => s), planMarkdown(stack, shown, { confirmHint: command !== "plan" && pending.length > 0 }));
			if (command === "plan") return pending.length ? 10 : shown.some((s) => s.kind === "blocked") ? 2 : 0;
			return pending.length ? 10 : 0;
		}
		const result = await apply(ctx, shown, { acceptCost: values["accept-cost"] });
		const markdown = applyMarkdown(stack, result, at);
		print({ done: result.done.map(({ run, ...s }) => s), waiting: result.waiting && strip(result.waiting), failed: result.failed && strip(result.failed) }, markdown);
		if (values.report) await writeFile(resolve(cwd, values.report), markdown);
		code = result.failed ? 1 : result.waiting ? 3 : 0;
	}
	const guideWrites = command === "guide" && ["done", "stuck"].includes(rest[0]);
	if (!values["no-save"] && !["doctor", "connect", "plan"].includes(command) && !(command === "gates" && rest[0] !== "set") && !(command === "guide" && !guideWrites) && !(["apply", "sync", "teardown"].includes(command) && !values.confirm))
		await saveState(statePath, state);
	return code;
}

// Resolve symlinks: the skill is usually linked into ~/.claude/skills.
const invokedAs = (path) => {
	try {
		return pathToFileURL(realpathSync(path)).href;
	} catch {
		return null;
	}
};
if (process.argv[1] && import.meta.url === invokedAs(process.argv[1]))
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exit(1);
		},
	);
