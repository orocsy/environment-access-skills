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
import { setGate } from "./lib/gates.mjs";
import { doctorMarkdown, gatesMarkdown, verifyMarkdown } from "./lib/report.mjs";
import { adapters as builtIn } from "./adapters/index.mjs";

const USAGE = `stack <command> [--stack path/to/stack.yaml]

Read-only commands:
  verify    check every capability and secret store; green/red per item
  import    find resources that already exist and record their IDs in state
  gates     list the human steps still open (--all for every one)
  gates set <id> <open|waiting|done|skipped> [--by name] [--note text]
  doctor    check tools, logins and deadlines

Options:
  --stack <file>    default: ./infra/stack/stack.yaml, then ./stack.yaml
  --report <file>   also write the Markdown report to this file
  --json            print JSON instead of Markdown
  --no-save         don't update .stack/state.json

Coming in later milestones: plan, apply, connect, sync, rotate.`;

const LATER = { plan: "M2", apply: "M2", connect: "M2", sync: "M2", rotate: "M3" };

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
			help: { type: "boolean", short: "h" },
		},
	});
	const [command, ...rest] = positionals;
	if (!command || values.help) {
		out.write(`${USAGE}\n`);
		return command || values.help ? 0 : 64;
	}
	if (LATER[command]) {
		out.write(`stack ${command} arrives in ${LATER[command]}. Today stack-setup only reads: verify, import, gates, doctor.\n`);
		return 64;
	}
	if (!["verify", "import", "gates", "doctor"].includes(command)) {
		out.write(`Unknown command "${command}".\n\n${USAGE}\n`);
		return 64;
	}
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
	} else {
		const result = await doctor(ctx, adapters);
		print(result, doctorMarkdown(stack, result, at));
		code = worst(result.checks) === "green" ? 0 : 2;
	}
	if (!values["no-save"] && command !== "doctor" && !(command === "gates" && rest[0] !== "set"))
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
