import { assertNoSecrets } from "./guard.mjs";

const MARK = { green: "✅ green", red: "❌ red", blocked: "⏸ blocked", skipped: "— skipped" };
const cell = (text) => String(text ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

export function counts(checks) {
	const out = { green: 0, red: 0, blocked: 0, skipped: 0 };
	for (const c of checks) out[c.status]++;
	return out;
}

const summary = (checks) =>
	Object.entries(counts(checks))
		.filter(([, n]) => n)
		.map(([s, n]) => `${n} ${s}`)
		.join(", ");

function gateLine(g) {
	const parts = [`- **${g.id}** (${g.type}, ${g.status}): ${g.title}`];
	if (g.link) parts.push(`  - Link: ${g.link}`);
	for (const [k, v] of Object.entries(g.prefill ?? {})) parts.push(`  - ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
	if (g.receive?.length) parts.push(`  - Hand back through secure-key-handoff: ${g.receive.join(", ")}`);
	if (g.note) parts.push(`  - ${g.note}`);
	if (g.closedBy) parts.push(`  - Closes itself when \`${g.closedBy}\` is green`);
	return parts.join("\n");
}

export function gatesMarkdown(gates, { all = false } = {}) {
	const shown = all ? gates : gates.filter((g) => g.status === "open" || g.status === "waiting");
	if (!shown.length) return "No open gates.\n";
	const titles = { preflight: "Before any work (once per machine)", app: "For this app", "go-live": "Before going live" };
	return `${Object.entries(titles)
		.map(([bundle, title]) => [title, shown.filter((g) => g.bundle === bundle)])
		.filter(([, list]) => list.length)
		.map(([title, list]) => `### ${title}\n\n${list.map(gateLine).join("\n")}`)
		.join("\n\n")}\n`;
}

export function verifyMarkdown(stack, { checks, gates }, at) {
	const text = [
		`## stack verify: ${stack.app}`,
		"",
		`${at}. ${summary(checks)}.`,
		"",
		"| Check | Result | Detail |",
		"|---|---|---|",
		...checks.map((c) => `| \`${cell(c.id)}\` | ${MARK[c.status]} | ${cell(c.detail)}${c.gate ? ` (gate \`${c.gate}\`)` : ""} |`),
		"",
		"## Open gates",
		"",
		gatesMarkdown(gates),
	].join("\n");
	assertNoSecrets(text, "report");
	return text;
}

export function doctorMarkdown(stack, { checks, deadlines }, at) {
	const text = [
		`## stack doctor: ${stack.app}`,
		"",
		`${at}. ${summary(checks)}.`,
		"",
		"| Check | Result | Detail |",
		"|---|---|---|",
		...checks.map((c) => `| \`${cell(c.id)}\` | ${MARK[c.status]} | ${cell(c.detail)} |`),
		"",
		"## Deadlines",
		"",
		...(deadlines.length ? deadlines.map((d) => `- ${d.date} (${d.days} days): ${d.what}`) : ["None ahead."]),
		"",
	].join("\n");
	assertNoSecrets(text, "report");
	return text;
}

const KIND = { create: "+ create", update: "~ update", sync: "→ sync", wait: "⏳ wait", noop: "= no change", blocked: "⏸ blocked" };

const guarded = (text) => {
	assertNoSecrets(text, "report");
	return text;
};

export function planMarkdown(stack, steps, { confirmHint = false } = {}) {
	const changes = steps.filter((s) => !["noop", "blocked"].includes(s.kind));
	return guarded(
		[
			`## stack plan: ${stack.app}`,
			"",
			changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}; nothing has been changed yet.` : "Nothing to change.",
			"",
			...steps.map((s) => `- ${KIND[s.kind]} \`${s.id}\`: ${s.summary}${s.cost ? ` 💲 ${s.cost}` : ""}${s.gate ? ` (gate \`${s.gate}\`)` : ""}`),
			"",
			...(confirmHint ? ["Run again with --confirm to make these changes.", ""] : []),
		].join("\n"),
	);
}

export function applyMarkdown(stack, { done, waiting, failed }, at) {
	return guarded(
		[
			`## stack apply: ${stack.app}`,
			"",
			`${at}. ${done.length} done${waiting ? ", 1 waiting" : ""}${failed ? ", 1 failed" : ""}.`,
			"",
			...done.map((s) => `- ✅ \`${s.id}\`: ${s.summary}`),
			...(waiting ? [`- ⏳ \`${waiting.id}\`: ${waiting.note}`] : []),
			...(failed ? [`- ❌ \`${failed.id}\`: ${failed.summary}. ${failed.error}`, "", "Later steps did not run. Fix the cause, then run apply again."] : []),
			"",
		].join("\n"),
	);
}

export function connectMarkdown(stack, checks, gates) {
	return guarded(
		[
			`## stack connect: ${stack.app}`,
			"",
			...checks.map((c) => `- ${MARK[c.status]} \`${c.id}\`: ${c.detail}`),
			"",
			gatesMarkdown(gates),
		].join("\n"),
	);
}

export function teardownMarkdown(stack, list) {
	return guarded(
		[
			`## stack teardown: ${stack.app}`,
			"",
			list.length ? `Would remove ${list.length} thing${list.length === 1 ? "" : "s"} stack-setup created, newest first. Nothing found by import is touched.` : "stack-setup created nothing here, so there is nothing to remove.",
			"",
			...list.map(([key, r]) => `- \`${key}\`${r.name ? `: ${r.name}` : r.key ? `: ${r.key}` : ""}`),
			"",
			...(list.length ? ["Run again with --confirm to remove them. This can't be undone.", ""] : []),
		].join("\n"),
	);
}

export function teardownResultMarkdown(stack, { removed, failed }) {
	return guarded(
		[
			`## stack teardown: ${stack.app}`,
			"",
			...removed.map((r) => `- 🗑 ${r}`),
			...(failed ? [`- ❌ \`${failed.key}\`: ${failed.error}`] : []),
			"",
		].join("\n"),
	);
}
