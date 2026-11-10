import { GATE_BUNDLES } from "./schema.mjs";
import { GREEN } from "./context.mjs";

export const GATE_STATUSES = ["open", "waiting", "done", "skipped"];

// The full ledger: what the adapters and the stack file ask of a person, merged
// with what the state file already knows about each item.
export function ledger(stack, state, adapters, extra = []) {
	const items = [...extra];
	for (const [name, cap] of Object.entries(stack.capabilities)) {
		const adapter = adapters[cap.provider];
		if (adapter?.gates) items.push(...adapter.gates(cap, stack, name).map((g) => ({ ...g, capability: name })));
	}
	items.push(...(stack.gates ?? []));
	const seen = new Map();
	for (const item of items) {
		const recorded = state.gates[item.id] ?? {};
		seen.set(item.id, { ...seen.get(item.id), ...item, status: recorded.status ?? "open", ...pick(recorded, ["at", "by", "note"]) });
	}
	return [...seen.values()].sort(
		(a, b) => GATE_BUNDLES.indexOf(a.bundle) - GATE_BUNDLES.indexOf(b.bundle) || a.id.localeCompare(b.id),
	);
}

const pick = (object, keys) => Object.fromEntries(keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]]));

// A gate with a probe closes itself when its check is green, and reopens if the
// check stops passing. Gates without a probe change only by `stack gates set`.
export function closeByChecks(gates, state, checks, now) {
	const byId = new Map(checks.map((c) => [c.id, c]));
	for (const gate of gates) {
		const check = gate.closedBy && byId.get(gate.closedBy);
		if (!check || check.status === "blocked" || check.status === "skipped") continue;
		const status = check.status === GREEN ? "done" : "open";
		if (state.gates[gate.id]?.status !== status) {
			state.gates[gate.id] = { status, at: now, by: `probe ${gate.closedBy}` };
			gate.status = status;
			gate.at = now;
			gate.by = `probe ${gate.closedBy}`;
		}
	}
}

export function setGate(gates, state, id, status, { by, note, now }) {
	const gate = gates.find((g) => g.id === id);
	if (!gate) throw new Error(`no gate "${id}"; run stack gates to list them`);
	if (!GATE_STATUSES.includes(status)) throw new Error(`status must be one of ${GATE_STATUSES.join(", ")}`);
	if (gate.closedBy && status === "done")
		throw new Error(`${id} is closed by the check ${gate.closedBy}; run stack verify instead of marking it done`);
	state.gates[id] = { status, at: now, ...(by && { by }), ...(note && { note }) };
}
