const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

export function envNames(text) {
	return text
		.split(/\r?\n/)
		.map((line) => ASSIGNMENT.exec(line)?.[1])
		.filter(Boolean);
}

export function envValue(text, name) {
	for (const line of text.split(/\r?\n/)) {
		if (ASSIGNMENT.exec(line)?.[1] === name) return line.slice(line.indexOf("=") + 1).replace(/^(['"])(.*)\1$/, "$2");
	}
	return null;
}

// Sets every name in `updates` (replacing all earlier assignments of it, so no
// stale duplicate can win) and drops every name in `removals`. Other lines,
// comments and order are kept.
export function updateEnv(text, updates = {}, removals = []) {
	for (const [name, value] of Object.entries(updates)) {
		if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`bad env name ${name}`);
		if (typeof value !== "string" || /[\r\n]/.test(value)) throw new Error(`${name}: value must be one line of text`);
	}
	const written = new Set();
	const out = [];
	for (const line of text.split(/\r?\n/)) {
		const name = ASSIGNMENT.exec(line)?.[1];
		if (name && removals.includes(name)) continue;
		if (name && Object.hasOwn(updates, name)) {
			if (!written.has(name)) out.push(`${name}=${updates[name]}`);
			written.add(name);
			continue;
		}
		out.push(line);
	}
	while (out.length && out.at(-1) === "") out.pop();
	for (const [name, value] of Object.entries(updates)) if (!written.has(name)) out.push(`${name}=${value}`);
	return `${out.join("\n")}\n`;
}
