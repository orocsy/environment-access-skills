// The small YAML subset stack.yaml needs, so the skill runs on Node built-ins only.
// Supported: block maps and lists, one-line flow maps/lists, quoted and plain scalars,
// comments. Anything else (anchors, tags, block scalars, several documents) is refused
// with its line number instead of being guessed at.

export class YamlError extends Error {
	constructor(message, line) {
		super(line ? `stack.yaml line ${line}: ${message}` : message);
		this.line = line;
	}
}

function stripComment(text) {
	let quote = null;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === "\\" && quote === '"') i++;
			else if (c === quote) quote = null;
		} else if (c === '"' || c === "'") quote = c;
		else if (c === "#" && (i === 0 || /\s/.test(text[i - 1])))
			return text.slice(0, i);
	}
	return text;
}

function scalar(raw, line) {
	const s = raw.trim();
	if (s.startsWith('"')) {
		if (!s.endsWith('"') || s.length < 2)
			throw new YamlError("unclosed double quote", line);
		try {
			return JSON.parse(s);
		} catch {
			throw new YamlError("bad escape in double-quoted text", line);
		}
	}
	if (s.startsWith("'")) {
		if (!s.endsWith("'") || s.length < 2)
			throw new YamlError("unclosed single quote", line);
		return s.slice(1, -1).replaceAll("''", "'");
	}
	if (/^[&*!|>%@`]/.test(s))
		throw new YamlError(`unsupported YAML feature "${s[0]}"`, line);
	if (s === "" || s === "~" || s === "null") return null;
	if (s === "true") return true;
	if (s === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
	return s;
}

// Index of the "key: value" separator outside quotes and brackets, or -1.
function keySeparator(text) {
	let quote = null;
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === "\\" && quote === '"') i++;
			else if (c === quote) quote = null;
		} else if (c === '"' || c === "'") quote = c;
		else if (c === "{" || c === "[") depth++;
		else if (c === "}" || c === "]") depth--;
		else if (
			c === ":" &&
			depth === 0 &&
			(i === text.length - 1 || text[i + 1] === " ")
		)
			return i;
	}
	return -1;
}

function parseFlow(text, line) {
	let i = 0;
	const ws = () => {
		while (i < text.length && /\s/.test(text[i])) i++;
	};
	const plain = (stops) => {
		const start = i;
		let quote = null;
		while (i < text.length) {
			const c = text[i];
			if (quote) {
				if (c === "\\" && quote === '"') i++;
				else if (c === quote) quote = null;
			} else if (c === '"' || c === "'") quote = c;
			else if (stops.includes(c)) break;
			i++;
		}
		return text.slice(start, i);
	};
	const value = () => {
		ws();
		if (text[i] === "{") {
			i++;
			const out = {};
			ws();
			if (text[i] === "}") {
				i++;
				return out;
			}
			for (;;) {
				ws();
				const key = scalar(plain(":,}"), line);
				if (text[i] !== ":")
					throw new YamlError(`expected ":" after "${key}"`, line);
				i++;
				if (typeof key !== "string" || !key)
					throw new YamlError("map keys must be text", line);
				if (Object.hasOwn(out, key))
					throw new YamlError(`duplicate key "${key}"`, line);
				out[key] = value();
				ws();
				if (text[i] === ",") {
					i++;
					continue;
				}
				if (text[i] === "}") {
					i++;
					return out;
				}
				throw new YamlError('expected "," or "}"', line);
			}
		}
		if (text[i] === "[") {
			i++;
			const out = [];
			ws();
			if (text[i] === "]") {
				i++;
				return out;
			}
			for (;;) {
				out.push(value());
				ws();
				if (text[i] === ",") {
					i++;
					continue;
				}
				if (text[i] === "]") {
					i++;
					return out;
				}
				throw new YamlError('expected "," or "]"', line);
			}
		}
		return scalar(plain(",]}"), line);
	};
	const result = value();
	ws();
	if (i !== text.length)
		throw new YamlError(`unexpected text "${text.slice(i)}"`, line);
	return result;
}

function inline(text, line) {
	const t = text.trim();
	return t.startsWith("{") || t.startsWith("[")
		? parseFlow(t, line)
		: scalar(t, line);
}

const isItem = (text) => text === "-" || text.startsWith("- ");

export function parseYaml(source) {
	const lines = [];
	source.split(/\r?\n/).forEach((raw, index) => {
		const n = index + 1;
		const body = stripComment(raw).replace(/\s+$/, "");
		if (!body.trim()) return;
		const indent = body.length - body.trimStart().length;
		if (body.slice(0, indent).includes("\t"))
			throw new YamlError("use spaces, not tabs, for indentation", n);
		const text = body.trim();
		if (text === "---" || text === "...") {
			if (lines.length)
				throw new YamlError("only one YAML document is supported", n);
			return;
		}
		lines.push({ indent, text, n });
	});
	let pos = 0;

	function node(minIndent) {
		const line = lines[pos];
		if (!line || line.indent < minIndent) return null;
		return isItem(line.text) ? list(line.indent) : map(line.indent);
	}

	function child(parent) {
		const next = lines[pos];
		if (next && next.indent > parent.indent) return node(next.indent);
		// "key:" followed by a list at the same indent is valid YAML.
		if (next && next.indent === parent.indent && isItem(next.text) && !isItem(parent.text))
			return list(next.indent);
		return null;
	}

	function map(indent) {
		const out = {};
		while (pos < lines.length) {
			const line = lines[pos];
			if (line.indent < indent) break;
			if (line.indent > indent)
				throw new YamlError("unexpected indentation", line.n);
			if (isItem(line.text)) break;
			const at = keySeparator(line.text);
			if (at < 0) throw new YamlError(`expected "key: value"`, line.n);
			const key = scalar(line.text.slice(0, at), line.n);
			if (typeof key !== "string" || !key)
				throw new YamlError("map keys must be text", line.n);
			if (Object.hasOwn(out, key))
				throw new YamlError(`duplicate key "${key}"`, line.n);
			const rest = line.text.slice(at + 1).trim();
			pos++;
			out[key] = rest ? inline(rest, line.n) : child(line);
		}
		return out;
	}

	function list(indent) {
		const out = [];
		while (pos < lines.length) {
			const line = lines[pos];
			if (line.indent < indent) break;
			if (line.indent > indent)
				throw new YamlError("unexpected indentation", line.n);
			if (!isItem(line.text)) break;
			const rest = line.text.slice(1).trimStart();
			if (!rest) {
				pos++;
				out.push(child(line));
			} else if (!/^[{["']/.test(rest) && keySeparator(rest) >= 0) {
				// "- key: value" starts a map indented to where its key begins.
				const inner = indent + (line.text.length - rest.length);
				lines[pos] = { indent: inner, text: rest, n: line.n };
				out.push(map(inner));
			} else {
				pos++;
				out.push(inline(rest, line.n));
			}
		}
		return out;
	}

	const result = node(0);
	if (pos < lines.length)
		throw new YamlError("unexpected indentation", lines[pos].n);
	return result ?? {};
}
