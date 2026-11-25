// The AWS CLI's ~/.aws/credentials format: [section] then key = value lines.

export function iniSections(text) {
	return [...text.matchAll(/^\s*\[([^\]]+)\]\s*$/gm)].map((m) => m[1].trim());
}

// Replaces one section's body (or adds the section), leaving every other line alone.
// `values` null removes the section.
export function updateIniSection(text, section, values) {
	for (const [k, v] of Object.entries(values ?? {}))
		if (!/^[a-z_]+$/.test(k) || typeof v !== "string" || /[\r\n]/.test(v)) throw new Error(`bad credentials entry ${k}`);
	const lines = text.split(/\r?\n/);
	const out = [];
	let skipping = false;
	let replaced = false;
	for (const line of lines) {
		const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
		if (header) {
			skipping = header[1].trim() === section;
			if (skipping && values && !replaced) {
				out.push(`[${section}]`, ...Object.entries(values).map(([k, v]) => `${k} = ${v}`));
				replaced = true;
			}
			if (skipping) continue;
		}
		if (!skipping) out.push(line);
	}
	while (out.length && out.at(-1).trim() === "") out.pop();
	if (values && !replaced) out.push(...(out.length ? [""] : []), `[${section}]`, ...Object.entries(values).map(([k, v]) => `${k} = ${v}`));
	return out.length ? `${out.join("\n")}\n` : "";
}
