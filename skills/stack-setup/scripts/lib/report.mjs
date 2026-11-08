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
