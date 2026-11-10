#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseYaml } from "./lib/yaml.mjs";
import { validateStack } from "./lib/schema.mjs";
import { loadState, saveState } from "./lib/state.mjs";
import { makeContext } from "./lib/context.mjs";
import { allGates, doctor, importResources, verify, worst } from "./lib/runner.mjs";
import { closeByChecks, setGate } from "./lib/gates.mjs";
import { applyMarkdown, connectMarkdown, doctorMarkdown, gatesMarkdown, planMarkdown, teardownMarkdown, teardownResultMarkdown, verifyMarkdown } from "./lib/report.mjs";
import { CHANGES, apply, plan, teardown, teardownList } from "./lib/apply.mjs";

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
  gates set <id> <open|waiting|done|skipped> [--by name] [--note text]

Options:
  --stack <file>    default: ./infra/stack/stack.yaml, then ./stack.yaml
  --confirm         actually make the changes the plan shows
  --wait <minutes>  how long apply waits for DNS verification (default 10)
  --report <file>   also write the Markdown report to this file
  --json            print JSON instead of Markdown
  --no-save         don't update .stack/state.json

Coming in M3: rotate.`;

const LATER = { rotate: "M3" };
const COMMANDS = ["verify", "import", "gates", "doctor", "connect", "plan", "apply", "sync", "teardown"];

export async function loadStack(path, adapters = builtIn) {
	const { stack, errors } = validateStack(parseYaml(await readFile(path, "utf8")), adapters);
	if (errors.length) throw new Error(`${path} has problems:\n- ${errors.join("\n- ")}`);
	return stack;
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
	const stack = await loadStack(stackPath, adapters);
	const statePath = join(dirname(stackPath), ".stack", "state.json");
	const state = await loadState(statePath, stack.app);
	const ctx = makeContext(stack, state, overrides);
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
		const result = await apply(ctx, shown);
		const markdown = applyMarkdown(stack, result, at);
		print({ done: result.done.map(({ run, ...s }) => s), waiting: result.waiting && strip(result.waiting), failed: result.failed && strip(result.failed) }, markdown);
		if (values.report) await writeFile(resolve(cwd, values.report), markdown);
		code = result.failed ? 1 : result.waiting ? 3 : 0;
	}
	if (!values["no-save"] && !["doctor", "connect", "plan"].includes(command) && !(command === "gates" && rest[0] !== "set") && !(["apply", "sync", "teardown"].includes(command) && !values.confirm))
		await saveState(statePath, state);
	return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exit(1);
		},
	);
