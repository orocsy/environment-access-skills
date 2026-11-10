// Turns the gate ledger into a route: what can be done now, in what order,
// what's waiting, and which clocks are running. One step is shown at a time.

const DONE = new Set(["done", "skipped"]);
const UNITS = { hour: 3600000, hours: 3600000, day: 86400000, days: 86400000, week: 604800000, weeks: 604800000 };

export function parseSpan(text) {
	const m = /^(\d+)\s*(hours?|days?|weeks?)$/.exec(String(text).trim());
	if (!m) throw new Error(`a time span like "24 hours" or "30 days", not "${text}"`);
	return Number(m[1]) * UNITS[m[2]];
}

// Gates that list `after` are held until those are done. A just-in-time gate (one
// that costs money) waits until everything else its dependents need is done too,
// so nothing is paid for while other steps are still pending.
// Dependencies first; among steps free at the same time, the order their pack or
// adapter wrote them in, so the route reads top to bottom.
function ordered(gates) {
	const ids = new Set(gates.map((g) => g.id));
	const rank = (g) => [g.seq ?? Number.MAX_SAFE_INTEGER, g.id];
	const cmp = (a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1].localeCompare(rank(b)[1]);
	const pending = new Map(gates.map((g) => [g.id, (g.after ?? []).filter((id) => ids.has(id)).length]));
	const out = [];
	const free = gates.filter((g) => pending.get(g.id) === 0).sort(cmp);
	while (free.length) {
		const g = free.shift();
		out.push(g);
		for (const d of gates.filter((x) => (x.after ?? []).includes(g.id))) {
			pending.set(d.id, pending.get(d.id) - 1);
			if (pending.get(d.id) === 0) {
				free.push(d);
				free.sort(cmp);
			}
		}
	}
	if (out.length !== gates.length) throw new Error(`steps wait on each other in a loop: ${gates.filter((g) => !out.includes(g)).map((g) => g.id).join(", ")}`);
	return out;
}

export function route(unordered, state, now = new Date()) {
	const gates = ordered(unordered);
	const byId = new Map(gates.map((g) => [g.id, g]));
	const done = (id) => !byId.has(id) || DONE.has(byId.get(id).status);
	const dependents = (id) => gates.filter((g) => (g.after ?? []).includes(id));
	const blockers = (g) => {
		const own = (g.after ?? []).filter((id) => !done(id));
		if (!g.justInTime) return own;
		const others = dependents(g.id).flatMap((d) => (d.after ?? []).filter((id) => id !== g.id && !done(id)));
		return [...new Set([...own, ...others])];
	};
	const steps = gates.map((g) => {
		const waitingOn = DONE.has(g.status) ? [] : blockers(g);
		let due = null;
		if (g.deadline && !DONE.has(g.status)) {
			const started = state.gates[g.deadline.from];
			if (started && DONE.has(started.status) && started.at) due = new Date(Date.parse(started.at) + parseSpan(g.deadline.within));
		}
		const state_ = DONE.has(g.status) ? g.status : g.status === "waiting" ? "waiting" : waitingOn.length ? "blocked" : "ready";
		return { ...g, state: state_, waitingOn, due, overdue: due ? due < now : false };
	});
	// Owner steps first among the ready ones, so the agent's own work never hides theirs.
	const ready = steps.filter((s) => s.state === "ready");
	const next = ready.find((s) => s.due) ?? ready.find((s) => !/^agent/.test(s.who ?? "")) ?? ready[0] ?? null;
	return { steps, next, total: steps.length, finished: steps.filter((s) => DONE.has(s.state)).length };
}

const list = (items, mark = "·") => items.map((i) => `  ${mark} ${i}`);

export function stepScreen(stack, r) {
	const s = r.next;
	if (!s) {
		const waiting = r.steps.filter((x) => x.state === "waiting" || x.state === "blocked");
		if (!waiting.length) return `Everything on ${stack.app}'s route is done.\n`;
		return [
			"Nothing for you to do right now.",
			...waiting.slice(0, 5).map((w) => `  ⏳ ${w.title}${w.takes ? ` (${w.takes})` : ""}${w.waitingOn.length ? `, after ${w.waitingOn.join(", ")}` : ""}`),
			"",
		].join("\n");
	}
	const index = r.steps.indexOf(s) + 1;
	return [
		`Step ${index} of ${r.total}${s.track ?? s.bundle ? ` · ${s.track ?? s.bundle}` : ""} · ${s.who ?? "you"}${s.takes ? ` · ${s.takes}` : ""}`,
		"",
		`${s.title}${s.cost ? `  💲 ${s.cost}` : ""}`,
		...(s.due ? [`  ⏰ due ${s.due.toISOString().slice(0, 16).replace("T", " ")} UTC${s.overdue ? " (overdue)" : ""}`] : []),
		...(s.where ? [`  Where: ${s.where}`] : s.link ? [`  Where: ${s.link}`] : []),
		...(s.steps?.length ? ["", ...s.steps.map((t, i) => `  ${i + 1}. ${t}`)] : []),
		...(s.prefill && Object.keys(s.prefill).length ? ["", "  Values to paste:", ...Object.entries(s.prefill).map(([k, v]) => `    ${k}: ${Array.isArray(v) ? v.join(", ") : v}`)] : []),
		...(s.documents?.length ? ["", "  Have ready:", ...list(s.documents, "☐")] : []),
		...(s.receive?.length ? ["", `  Hand back with secure-key-handoff: ${s.receive.join(", ")}`] : []),
		...(s.note ? ["", `  ${s.note}`] : []),
		...(s.needs ? ["", `  ⚖ Needs ${s.needs}`] : []),
		...(s.faq?.length ? ["", "  Common questions", ...s.faq.flatMap((f) => [`  · ${f.q}`, `    ${f.a}`])] : []),
		...(s.sources?.length ? ["", `  Based on: ${s.sources.map((x) => `${x.url} (checked ${x.checked})`).join("; ")}`] : []),
		"",
		s.closedBy ? `This closes itself when ${s.closedBy} is green (stack verify).` : `When it's done: stack guide done${s.id ? ` ${s.id}` : ""}. If something goes wrong: stack guide stuck "<what happened>".`,
		"",
	].join("\n");
}

const MARK = { done: "✅", skipped: "—", ready: "▶", waiting: "⏳", blocked: "·" };

export function timeline(stack, r) {
	const tracks = [...new Set(r.steps.map((s) => s.track ?? s.bundle ?? "other"))];
	return [
		`## Route for ${stack.app}: ${r.finished} of ${r.total} done`,
		"",
		...tracks.flatMap((t) => [
			`### ${t}`,
			...r.steps
				.filter((s) => (s.track ?? s.bundle ?? "other") === t)
				.map(
					(s) =>
						`${MARK[s.state]} ${s.title} — ${s.who ?? "you"}${s.takes ? `, ${s.takes}` : ""}${s.cost ? ` 💲` : ""}${s.justInTime ? " (bought only when everything else is ready)" : ""}${s.due ? `, due ${s.due.toISOString().slice(0, 10)}` : s.deadline ? `, within ${s.deadline.within} of ${s.deadline.from}` : ""}${s.state === "blocked" && s.waitingOn.length ? ` · after ${s.waitingOn.join(", ")}` : ""}${s.needs ? " ⚖" : ""}`,
				),
			"",
		]),
		"▶ ready · ⏳ waiting · · not yet · 💲 costs money · ⚖ needs an adviser",
		"",
	].join("\n");
}

export function interviewScreen(pack, stack) {
	const p = stack.profile ?? {};
	return [
		`## Questions for a ${pack.jurisdiction} stack`,
		"",
		"Answer once; they go in stack.yaml under profile: and remove the steps that don't apply.",
		"",
		...pack.interview.filter((q) => !q.when || q.when(p)).map((q) => `- ${q.key}: ${q.question}${q.options ? ` (${q.options.join(" | ")})` : ""}${p[q.key] !== undefined ? `  → now: ${JSON.stringify(p[q.key])}` : "  → not answered"}${q.note ? `\n  ${q.note}` : ""}`),
		"",
	].join("\n");
}
