import { assertNoSecrets } from "./guard.mjs";
import { packs as knownPacks } from "../packs/index.mjs";

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const STORES = ["server-env", "local-env", "1password"];
const MIRRORS = ["github-secret"];
const CONFIG_TARGETS = ["server-env", "local-env", "vercel"];
export const GATE_TYPES = ["consent", "terms", "money", "console", "identity", "time"];
export const GATE_BUNDLES = ["preflight", "app", "go-live"];

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Checks the shape every app shares; each adapter checks its own options.
// Returns { stack, errors } and never throws for a bad file.
export function validateStack(raw, adapters = {}, packs = knownPacks) {
	const errors = [];
	const warnings = [];
	const need = (ok, message) => ok || errors.push(message);
	try {
		assertNoSecrets(raw, "stack.yaml");
	} catch (error) {
		return { stack: null, errors: [error.message] };
	}
	if (!isMap(raw)) return { stack: null, errors: ["stack.yaml must be a map"] };
	need(SLUG.test(raw.app ?? ""), "app: lower-case name like wiggletrail");
	need(HOST.test(raw.domain ?? ""), "domain: a hostname like example.com");
	const caps = raw.capabilities;
	if (!isMap(caps) || !Object.keys(caps).length) {
		errors.push("capabilities: at least one, each with a provider");
		return { stack: null, errors };
	}
	for (const [name, cap] of Object.entries(caps)) {
		const at = `capabilities.${name}`;
		if (!need(/^[a-z][a-z0-9_]*$/.test(name), `${at}: name must be snake_case`))
			continue;
		if (!need(isMap(cap) && SLUG.test(cap.provider ?? ""), `${at}.provider is required`))
			continue;
		if (cap.on !== undefined)
			need(isMap(caps[cap.on]), `${at}.on: no capability named "${cap.on}"`);
		const adapter = adapters[cap.provider];
		if (adapter?.validate)
			for (const message of adapter.validate(cap, raw)) errors.push(`${at}.${message}`);
	}
	for (const [name, names] of Object.entries(raw.contract ?? {})) {
		need(isMap(caps[name]), `contract.${name}: no capability with that name`);
		need(
			Array.isArray(names) && names.every((n) => ENV_NAME.test(n)),
			`contract.${name}: a list of env names like RESEND_API_KEY`,
		);
	}
	const secrets = raw.secrets;
	if (secrets !== undefined) {
		const canonical = secrets?.canonical;
		if (need(isMap(canonical) && STORES.includes(canonical.type), `secrets.canonical.type: one of ${STORES.join(", ")}`)) {
			if (canonical.type === "server-env") {
				need(isMap(caps[canonical.host]), "secrets.canonical.host: the capability that runs the server");
				need(/^[~A-Za-z0-9_./-]+$/.test(canonical.path ?? ""), "secrets.canonical.path: a plain file path on the host");
				need(canonical.reload === undefined || (typeof canonical.reload === "string" && !/[\r\n]/.test(canonical.reload)), "secrets.canonical.reload: one command the host runs so the app rereads the file");
			} else if (canonical.type === "local-env") {
				// Never passed to a shell, so Windows paths (C:\…) are fine here.
				need(/^[~A-Za-z0-9_./\\: -]+$/.test(canonical.path ?? ""), "secrets.canonical.path: a plain file path on this machine");
			} else {
				need(typeof canonical.vault === "string" && canonical.vault, "secrets.canonical.vault is required for 1password");
				need(typeof canonical.item === "string" && canonical.item, "secrets.canonical.item is required for 1password");
			}
		}
		(secrets.mirrors ?? []).forEach((m, i) => {
			need(isMap(m) && MIRRORS.includes(m.type), `secrets.mirrors[${i}].type: one of ${MIRRORS.join(", ")}`);
			need(ENV_NAME.test(m?.name ?? ""), `secrets.mirrors[${i}].name: an upper-case secret name`);
		});
		(secrets.config ?? []).forEach((c, i) => {
			const at = `secrets.config[${i}]`;
			need(isMap(c) && CONFIG_TARGETS.includes(c.target), `${at}.target: one of ${CONFIG_TARGETS.join(", ")}`);
			need(ENV_NAME.test(c?.name ?? ""), `${at}.name: an upper-case env name`);
			need(c?.value === undefined || typeof c.value === "string", `${at}.value: text`);
			need(c?.from === undefined || /^[a-z][a-z0-9_]*\.url$/.test(c.from), `${at}.from: <capability>.url`);
			if (typeof c?.from === "string") need(raw.capabilities?.[c.from.split(".")[0]]?.hostname, `${at}.from: ${c.from.split(".")[0]} has no hostname`);
		});
	}
	(raw.gates ?? []).forEach((g, i) => {
		const at = `gates[${i}]`;
		need(isMap(g) && /^[a-z0-9_.-]+$/.test(g.id ?? ""), `${at}.id: like ios.signin`);
		need(GATE_TYPES.includes(g?.type), `${at}.type: one of ${GATE_TYPES.join(", ")}`);
		need(GATE_BUNDLES.includes(g?.bundle), `${at}.bundle: one of ${GATE_BUNDLES.join(", ")}`);
		need(typeof g?.title === "string" && g.title, `${at}.title is required`);
	});
	(raw.deadlines ?? []).forEach((d, i) => {
		need(isMap(d) && /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? ""), `deadlines[${i}].date: YYYY-MM-DD`);
		need(typeof d?.what === "string" && d.what, `deadlines[${i}].what is required`);
	});
	if (raw.jurisdiction !== undefined) {
		const pack = packs[raw.jurisdiction];
		if (!pack) errors.push(`jurisdiction: one of ${Object.keys(packs).join(", ") || "(none yet)"}`);
		else {
			const checked = pack.validate(raw);
			errors.push(...checked.errors);
			warnings.push(...checked.warnings);
		}
	}
	return errors.length ? { stack: null, errors, warnings } : { stack: raw, errors, warnings };
}

// Capabilities in an order where anything named by `on:` comes first.
export function capabilityOrder(stack) {
	const caps = stack.capabilities;
	const done = new Set();
	const order = [];
	const visit = (name, path = []) => {
		if (done.has(name)) return;
		if (path.includes(name))
			throw new Error(`capabilities: "on" loops through ${[...path, name].join(" → ")}`);
		const on = caps[name].on;
		if (on) visit(on, [...path, name]);
		done.add(name);
		order.push(name);
	};
	Object.keys(caps).forEach((name) => visit(name));
	return order;
}

export function publicUrl(stack, capName) {
	const cap = stack.capabilities[capName];
	return cap?.hostname ? `https://${cap.hostname}.${stack.domain}` : null;
}
