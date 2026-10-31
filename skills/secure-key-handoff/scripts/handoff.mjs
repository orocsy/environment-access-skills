#!/usr/bin/env node
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	writeFile,
	lstat,
	realpath,
	readdir,
	rename,
	rm,
} from "node:fs/promises";
import { dirname, resolve, join, relative, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAX = 16384;
const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
// Messages of this class never contain secret values, so the CLI may print them.
class SafeError extends Error {}
const fromPem = (pem) =>
	Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64");
const binding = (r) =>
	JSON.stringify({
		version: 1,
		id: r.id,
		platform: r.platform,
		environment: r.environment,
	});
const shortCode = (fingerprint) =>
	String(fingerprint).slice(0, 16).toUpperCase().match(/.{4}/g).join("-");
function validateFields(fields) {
	if (fields === undefined) return true;
	return (
		Array.isArray(fields) &&
		fields.length >= 1 &&
		fields.length <= 10 &&
		new Set(fields.map((f) => f?.name)).size === fields.length &&
		fields.every(
			(f) =>
				NAME.test(f.name) &&
				Array.isArray(f.prefixes) &&
				f.prefixes.length <= 5 &&
				f.prefixes.every((p) => /^[A-Za-z0-9_-]{1,32}$/.test(p)),
		)
	);
}
function validateRequest(r) {
	if (
		!r ||
		r.version !== 1 ||
		typeof r.platform !== "string" ||
		!/^[-a-z0-9]{1,64}$/.test(r.platform) ||
		!["test", "live", "development"].includes(r.environment) ||
		typeof r.id !== "string" ||
		!/^[-a-f0-9]{36}$/.test(r.id) ||
		typeof r.publicKey !== "string" ||
		r.publicKey.length > 2000 ||
		typeof r.label !== "string" ||
		r.label.length > 120 ||
		![undefined, "zh", "en"].includes(r.lang) ||
		!validateFields(r.fields) ||
		!Number.isFinite(Date.parse(r.expiresAt)) ||
		Date.parse(r.expiresAt) <= Date.now()
	)
		throw new SafeError("Invalid or expired request");
	const digest = createHash("sha256")
		.update(fromPem(r.publicKey))
		.digest("hex");
	if (digest !== r.fingerprint)
		throw new SafeError("Public key fingerprint mismatch");
}
function validateSecret(s) {
	if (typeof s !== "string" || !s.trim() || Buffer.byteLength(s) > MAX)
		throw new SafeError("Secret must contain 1 to 16384 UTF-8 bytes");
}

// Self-contained: the offline page runs this exact function before encrypting,
// and the receiver runs it again after decrypting.
export function checkValue(request, name, value) {
	if (typeof value !== "string" || !value.trim()) return "empty";
	const field = (request.fields || []).find((f) => f.name === name);
	const prefixes = (field && field.prefixes) || [];
	if (
		request.environment !== "live" &&
		/(?:^|[^A-Za-z0-9])(?:sk|rk|pk)_live_/.test(value)
	)
		return "live";
	if (prefixes.length && !prefixes.some((p) => value.trim().startsWith(p)))
		return "prefix";
	return null;
}
function rejectValue(request, name, value) {
	const problem = checkValue(request, name, value);
	const what = name || "The value";
	if (problem === "empty") throw new SafeError(`${what} is empty`);
	if (problem === "prefix") {
		const field = request.fields.find((f) => f.name === name);
		throw new SafeError(
			`${what} does not start with ${field.prefixes.join(" or ")}`,
		);
	}
	if (problem === "live")
		throw new SafeError(
			`${what} looks like a live key, but this request is for ${request.environment}`,
		);
}
// Returns the named values of a multi-field request (trimmed), or null for a single value.
export function fieldValues(request, text) {
	if (!request.fields) {
		rejectValue(request, "", text);
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new SafeError("Expected a JSON object of the requested fields");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new SafeError("Expected a JSON object of the requested fields");
	const names = request.fields.map((f) => f.name);
	if (
		Object.keys(parsed).length !== names.length ||
		!names.every((n) => typeof parsed[n] === "string")
	)
		throw new SafeError(`Expected exactly these fields: ${names.join(", ")}`);
	const values = {};
	for (const n of names) {
		rejectValue(request, n, parsed[n]);
		values[n] = parsed[n].trim();
	}
	return values;
}

// Kept self-contained so exactly this implementation also runs in the offline page.
export async function seal(request, secret) {
	if (!secret?.trim() || new TextEncoder().encode(secret).length > 16384)
		throw new Error("请输入密钥，最多 16 KiB");
	if (Date.parse(request.expiresAt) <= Date.now())
		throw new Error("交接请求已过期，请联系接收方重新生成");
	const decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
	const encode = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
	const der = decode(request.publicKey.replace(/-----[^-]+-----|\s/g, ""));
	const hash = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", der)),
		(n) => n.toString(16).padStart(2, "0"),
	).join("");
	if (hash !== request.fingerprint) throw new Error("公钥指纹不一致");
	const recipient = await crypto.subtle.importKey(
		"spki",
		der,
		{ name: "RSA-OAEP", hash: "SHA-256" },
		false,
		["encrypt"],
	);
	const key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt"],
	);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const meta = {
		version: 1,
		id: request.id,
		platform: request.platform,
		environment: request.environment,
	};
	const data = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv,
			additionalData: new TextEncoder().encode(JSON.stringify(meta)),
		},
		key,
		new TextEncoder().encode(secret),
	);
	const wrapped = await crypto.subtle.encrypt(
		{ name: "RSA-OAEP" },
		recipient,
		await crypto.subtle.exportKey("raw", key),
	);
	return { ...meta, key: encode(wrapped), iv: encode(iv), data: encode(data) };
}
export async function open(request, envelope, privateKey) {
	validateRequest(request);
	if (
		!envelope ||
		envelope.version !== 1 ||
		binding(envelope) !== binding(request) ||
		!["key", "iv", "data"].every(
			(k) =>
				typeof envelope[k] === "string" &&
				envelope[k].length < 50000 &&
				/^[A-Za-z0-9+/]+={0,2}$/.test(envelope[k]),
		)
	)
		throw new SafeError("Encrypted response does not match this request");
	const privateCrypto = await crypto.subtle.importKey(
		"pkcs8",
		fromPem(privateKey),
		{ name: "RSA-OAEP", hash: "SHA-256" },
		false,
		["decrypt"],
	);
	const raw = await crypto.subtle.decrypt(
		{ name: "RSA-OAEP" },
		privateCrypto,
		Buffer.from(envelope.key, "base64"),
	);
	if (raw.byteLength !== 32 || Buffer.from(envelope.iv, "base64").length !== 12)
		throw new SafeError("Invalid encryption parameters");
	const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
		"decrypt",
	]);
	const text = new TextDecoder("utf-8", { fatal: true }).decode(
		await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: Buffer.from(envelope.iv, "base64"),
				additionalData: new TextEncoder().encode(binding(request)),
			},
			aes,
			Buffer.from(envelope.data, "base64"),
		),
	);
	validateSecret(text);
	fieldValues(request, text);
	return text;
}

const PAGE_TEXT = {
	zh: {
		title: "密钥安全交接",
		platform: "平台：",
		environment: "环境：",
		intro:
			"请在自己的电脑打开。粘贴密钥后，本机加密并下载文件，再把文件交给接收方。",
		paste: "粘贴本次要交接的密钥",
		aria: "粘贴密钥",
		starts: "应以此开头：",
		show: "显示粘贴内容",
		button: "加密并下载",
		code: "核对码",
		codeNote: "应与接收方告诉你的核对码一致；不一致请停止。",
		note: "本页不联网、不保存输入。只使用接收方通过已确认渠道提供的文件。不要发送原始密钥或截图。请求有效期至",
		noteEnd: "；该期限不等于撤销平台密钥。",
		value: "密钥",
		done: "已生成加密文件。请把下载的文件交给接收方，并清空剪贴板。",
		failed: "未生成文件：请检查密钥是否为空、请求是否过期，或联系接收方。",
		empty: "未生成文件：{name} 为空。",
		prefix: "未生成文件：{name} 的开头与要求不符，请确认复制的是正确的密钥。",
		live: "未生成文件：{name} 看起来是正式环境（live）密钥，但本次只要测试密钥。",
	},
	en: {
		title: "Secure key handoff",
		platform: "Platform: ",
		environment: "Environment: ",
		intro:
			"Open this on your own computer. Paste the key; this page encrypts it on your machine and downloads a file. Send that file back.",
		paste: "Paste the key for this handoff",
		aria: "Paste key",
		starts: "Starts with:",
		show: "Show what I pasted",
		button: "Encrypt and download",
		code: "Check code",
		codeNote:
			"It should match the code the receiver gave you. If it doesn't, stop.",
		note: "This page makes no network requests and saves nothing. Only use a file the receiver sent you through a channel you trust. Never send the raw key or a screenshot. Request valid until",
		noteEnd: ". Expiry does not revoke the key on the platform.",
		value: "The key",
		done: "Encrypted file downloaded. Send that file to the receiver, then clear your clipboard.",
		failed:
			"No file created: the key may be empty or the request expired. Contact the receiver.",
		empty: "No file created: {name} is empty.",
		prefix:
			"No file created: {name} doesn't start the expected way. Check you copied the right key.",
		live: "No file created: {name} looks like a live key, but this request is for a test key.",
	},
};
export function ownerPage(request) {
	const escape = (s) =>
		String(s).replace(
			/[&<>"']/g,
			(c) =>
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;",
					"'": "&#39;",
				})[c],
		);
	const lang = request.lang === "en" ? "en" : "zh";
	const t = PAGE_TEXT[lang];
	const fields = request.fields?.length
		? request.fields
		: [{ name: "", prefixes: [] }];
	const inputs = fields
		.map((f, i) => {
			const hint = f.prefixes.length
				? `<small>${t.starts} ${escape(f.prefixes.join(" / "))}</small>`
				: "";
			return `<label for="f${i}">${escape(f.name || t.paste)}</label>${hint}<textarea id="f${i}" class="mask" data-name="${escape(f.name)}" required autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${escape(f.name || t.aria)}"></textarea>`;
		})
		.join("");
	const payload = JSON.stringify(request).replace(/</g, "\\u003c");
	const messages = JSON.stringify(t).replace(/</g, "\\u003c");
	return `<!doctype html><html lang="${lang === "en" ? "en" : "zh-CN"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';connect-src 'none';form-action 'none';base-uri 'none'"><title>${t.title}</title><style>body{max-width:620px;margin:40px auto;padding:24px;font:16px/1.7 system-ui;color:#173449}label{display:block;margin-top:12px;font-weight:600}textarea,button{box-sizing:border-box;width:100%;padding:14px;margin:8px 0}textarea{height:90px;font-family:ui-monospace,monospace}.mask{-webkit-text-security:disc;text-security:disc}.show{font-weight:400}.show input{width:auto;margin-right:8px}button{background:#155e75;color:white;border:0;border-radius:8px;font-size:16px}small{display:block;overflow-wrap:anywhere;color:#526477}.code{font:600 20px ui-monospace,monospace;letter-spacing:1px}output{display:block;font-weight:600}</style><h1>${escape(request.label)}</h1><p>${t.platform}${escape(request.platform)} · ${t.environment}${escape(request.environment)}<br>${t.intro}</p><p>${t.code}: <span class="code">${escape(shortCode(request.fingerprint))}</span><small>${t.codeNote}</small></p><form>${inputs}<label class="show"><input type="checkbox" id="show">${t.show}</label><button>${t.button}</button></form><output aria-live="polite"></output><p><small>${t.note} <time id="expires" datetime="${escape(request.expiresAt)}">${escape(request.expiresAt)}</time>${t.noteEnd}<br>SHA-256: ${escape(request.fingerprint)}</small></p><script>const request=${payload};const T=${messages};const seal=${seal.toString()};const checkValue=${checkValue.toString()};const boxes=[...document.querySelectorAll('textarea')];const expires=document.getElementById('expires');expires.textContent=new Date(request.expiresAt).toLocaleString();document.getElementById('show').addEventListener('change',e=>boxes.forEach(b=>b.classList.toggle('mask',!e.target.checked)));document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const status=document.querySelector('output');const read=b=>b.dataset.name?b.value.trim():b.value;for(const b of boxes){const problem=checkValue(request,b.dataset.name,read(b));if(problem){status.textContent=T[problem].replace('{name}',b.dataset.name||T.value);b.focus();return}}try{const secret=request.fields?JSON.stringify(Object.fromEntries(boxes.map(b=>[b.dataset.name,read(b)]))):read(boxes[0]);const data=await seal(request,secret);const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=request.platform+'-'+request.environment+'-'+request.id.slice(0,8)+'-encrypted.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);boxes.forEach(b=>{b.value='';b.classList.add('mask')});document.getElementById('show').checked=false;status.textContent=T.done;}catch{status.textContent=T.failed}});</script></html>`;
}
async function json(path) {
	const raw = await readFile(path, "utf8");
	if (Buffer.byteLength(raw) > 100000) throw new SafeError("File too large");
	try {
		return JSON.parse(raw);
	} catch {
		throw new SafeError("File is not valid JSON");
	}
}
async function gitRoot(path) {
	let current = await realpath(path);
	while (true) {
		try {
			await lstat(join(current, ".git"));
			return current;
		} catch (e) {
			if (e.code !== "ENOENT") throw e;
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
async function outsideGit(path) {
	await mkdir(path, { recursive: true, mode: 0o700 });
	if (await gitRoot(path))
		throw new SafeError("Private material must be outside every Git checkout");
}
async function privateFile(path, contents) {
	await outsideGit(dirname(resolve(path)));
	await writeFile(path, contents, { flag: "wx", mode: 0o600 });
}
// An env file may sit inside a checkout only if Git ignores it and doesn't track it.
async function envFileAllowed(file) {
	const folder = await realpath(dirname(file));
	const root = await gitRoot(folder);
	if (!root) return;
	const rel = relative(root, join(folder, basename(file)));
	const git = (...args) =>
		spawnSync("git", ["-C", root, ...args, "--", rel], { encoding: "utf8" });
	const tracked = git("ls-files", "--error-unmatch");
	if (tracked.error) throw new SafeError("Git is needed to check the env file");
	if (tracked.status === 0) throw new SafeError(`${rel} is tracked by Git`);
	if (git("check-ignore", "-q").status !== 0)
		throw new SafeError(
			`${rel} is not ignored by Git; add it to .gitignore first`,
		);
}
function envLine(name, value) {
	if (/^[A-Za-z0-9_\-.:/+=@,]+$/.test(value)) return `${name}=${value}`;
	if (!/[\r\n'"\\]/.test(value)) return `${name}='${value}'`;
	throw new SafeError(
		`${name} has characters an env file can't hold safely; use --out instead`,
	);
}
async function installEnv(path, values, replace) {
	const file = resolve(path);
	await envFileAllowed(file);
	let lines = [];
	try {
		if ((await lstat(file)).isSymbolicLink())
			throw new SafeError("The env file must not be a symbolic link");
		lines = (await readFile(file, "utf8")).split("\n");
		if (lines.at(-1) === "") lines.pop();
	} catch (e) {
		if (e.code !== "ENOENT") throw e;
	}
	const at = (name) =>
		lines.findIndex((l) =>
			new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l),
		);
	const taken = Object.keys(values).filter((n) => at(n) >= 0);
	if (taken.length && !replace)
		throw new SafeError(
			`Already set: ${taken.join(", ")}. Pass --replace true to change it`,
		);
	for (const [name, value] of Object.entries(values)) {
		const line = envLine(name, value);
		const i = at(name);
		if (i >= 0) lines[i] = line;
		else lines.push(line);
	}
	const temp = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, lines.join("\n") + "\n", { flag: "wx", mode: 0o600 });
		await rename(temp, file);
	} finally {
		await rm(temp, { force: true });
	}
}
// --input may be the downloads folder: pick the newest response for this request.
async function findResponse(input, id) {
	if (!(await lstat(input)).isDirectory()) return input;
	const found = [];
	for (const name of await readdir(input)) {
		if (!name.endsWith(".json")) continue;
		const path = join(input, name);
		const info = await lstat(path);
		if (!info.isFile() || info.size > 100000) continue;
		try {
			if (JSON.parse(await readFile(path, "utf8")).id === id)
				found.push({ path, time: info.mtimeMs });
		} catch {}
	}
	if (!found.length)
		throw new SafeError(
			`No encrypted file for request ${id.slice(0, 8)} in ${input}`,
		);
	return found.sort((a, b) => b.time - a.time)[0].path;
}
function parseFields(spec) {
	if (spec === undefined) return undefined;
	const fields = spec.split(",").map((part) => {
		const [name, prefixes = ""] = part.split(":");
		return { name, prefixes: prefixes ? prefixes.split("|") : [] };
	});
	if (!validateFields(fields))
		throw new SafeError(
			"--fields takes NAME[:prefix|prefix],... with upper-case names, at most 10",
		);
	return fields;
}
function options(args) {
	const o = {};
	for (let i = 0; i < args.length; i += 2) {
		if (!args[i]?.startsWith("--") || !args[i + 1] || o[args[i].slice(2)])
			throw new SafeError("Expected --option value");
		o[args[i].slice(2)] = args[i + 1];
	}
	return o;
}
export async function main(args) {
	const [mode, ...rest] = args;
	const o = options(rest);
	if (mode === "prepare") {
		if (
			!o.platform ||
			!o.environment ||
			!o.label ||
			!o["private-dir"] ||
			!o.out
		)
			throw new SafeError(
				"prepare requires platform, environment, label, private-dir, out",
			);
		const hours = Number(o.hours ?? 24);
		if (!Number.isFinite(hours) || hours <= 0 || hours > 168)
			throw new SafeError("hours must be 0 to 168");
		if (o.lang && !["zh", "en"].includes(o.lang))
			throw new SafeError("lang must be zh or en");
		const fields = parseFields(o.fields);
		await outsideGit(resolve(o["private-dir"]));
		const { privateKey, publicKey } = generateKeyPairSync("rsa", {
			modulusLength: 4096,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		const request = {
			version: 1,
			id: randomUUID(),
			platform: o.platform,
			environment: o.environment,
			label: o.label,
			...(o.lang ? { lang: o.lang } : {}),
			...(fields ? { fields } : {}),
			publicKey,
			fingerprint: createHash("sha256")
				.update(fromPem(publicKey))
				.digest("hex"),
			expiresAt: new Date(Date.now() + hours * 3600000).toISOString(),
		};
		validateRequest(request);
		await mkdir(resolve(o.out));
		await privateFile(join(o["private-dir"], request.id + ".pem"), privateKey);
		await privateFile(
			join(o["private-dir"], request.id + ".request.json"),
			JSON.stringify(request, null, 2),
		);
		await writeFile(
			join(o.out, "request.json"),
			JSON.stringify(request, null, 2),
			{ flag: "wx" },
		);
		await writeFile(join(o.out, "public.pem"), publicKey, { flag: "wx" });
		await writeFile(join(o.out, "owner.html"), ownerPage(request), {
			flag: "wx",
		});
		console.log(
			JSON.stringify({
				requestId: request.id,
				shortCode: shortCode(request.fingerprint),
				fingerprint: request.fingerprint,
				output: resolve(o.out),
				page: resolve(o.out, "owner.html"),
				privateKey: resolve(o["private-dir"], request.id + ".pem"),
				request: resolve(o["private-dir"], request.id + ".request.json"),
			}),
		);
	} else if (mode === "seal") {
		const request = await json(o.request);
		validateRequest(request);
		// CLI backup for an owner with Node installed. Never accept secrets in arguments.
		let secret;
		if (o.stdin === "true") secret = await readStdin();
		else if (request.fields) {
			const values = {};
			for (const f of request.fields)
				values[f.name] = await promptSecret(
					`${f.name} (hidden), then press Enter: `,
				);
			secret = JSON.stringify(values);
		} else
			secret = await promptSecret("Paste secret (hidden), then press Enter: ");
		validateSecret(secret);
		fieldValues(request, secret);
		await writeFile(o.out, JSON.stringify(await seal(request, secret)), {
			flag: "wx",
			mode: 0o600,
		});
		console.log("Encrypted response written. No secret printed.");
	} else if (mode === "receive") {
		if (!o.request || !o.key || !o.input || !(o.out || o.dotenv))
			throw new SafeError(
				"receive requires request, key, input and out or dotenv",
			);
		const request = await json(o.request);
		const used = join(dirname(resolve(o.key)), request.id + ".used");
		try {
			await lstat(used);
			throw new SafeError("This request was already used; prepare a new one");
		} catch (e) {
			if (e.code !== "ENOENT") throw e;
		}
		const envelope = await json(await findResponse(o.input, request.id));
		const info = await lstat(o.key);
		if (
			info.isSymbolicLink() ||
			!info.isFile() ||
			(process.platform !== "win32" && info.mode & 0o077)
		)
			throw new SafeError("Private key must be a regular mode-0600 file");
		const secret = await open(request, envelope, await readFile(o.key, "utf8"));
		if (o.dotenv) {
			let values = fieldValues(request, secret);
			if (values && o["env-name"])
				throw new SafeError("--env-name is only for single-value requests");
			if (!values) {
				if (!NAME.test(o["env-name"] ?? ""))
					throw new SafeError("A single-value request needs --env-name NAME");
				values = { [o["env-name"]]: secret.trim() };
			}
			await installEnv(o.dotenv, values, o.replace === "true");
			console.log(
				`Installed ${Object.keys(values).join(", ")} into ${resolve(o.dotenv)}. No values printed.`,
			);
		} else {
			await privateFile(o.out, secret);
			console.log("Secret saved to a private file. No plaintext printed.");
		}
		await writeFile(used, new Date().toISOString(), {
			flag: "wx",
			mode: 0o600,
		});
	} else
		throw new SafeError(
			"Commands: prepare, seal, receive. See SKILL.md for options.",
		);
}
async function readStdin() {
	let size = 0;
	const chunks = [];
	for await (const chunk of process.stdin) {
		const bytes = Buffer.from(chunk);
		size += bytes.length;
		if (size > MAX) throw new SafeError("Secret too large");
		chunks.push(bytes);
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(
		Buffer.concat(chunks),
	);
}
async function promptSecret(prompt) {
	if (!process.stdin.isTTY)
		throw new SafeError("Use a terminal or explicit --stdin true");

	const { StringDecoder } = await import("node:string_decoder");
	const decoder = new StringDecoder("utf8");
	return new Promise((resolve, reject) => {
		let value = "";
		const input = process.stdin;
		const wasRaw = input.isRaw;
		const finish = (error) => {
			input.off("data", onData);
			input.setRawMode(Boolean(wasRaw));
			input.pause();
			process.stderr.write("\n");
			error ? reject(error) : resolve(value);
		};
		const onData = (chunk) => {
			for (const c of decoder.write(chunk)) {
				if (c === "\u0003") return finish(new SafeError("Cancelled"));
				if (c === "\r" || c === "\n") return finish();
				if (c === "\u007f" || c === "\b")
					value = Array.from(value).slice(0, -1).join("");
				else if (c >= " ") value += c;
				if (Buffer.byteLength(value) > MAX)
					return finish(new SafeError("Secret too large"));
			}
		};
		input.setRawMode(true);
		input.on("data", onData);
		input.resume();
		process.stderr.write(prompt);
	});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main(process.argv.slice(2)).catch((e) => {
		console.error(
			e instanceof SafeError
				? `Handoff failed: ${e.message}. Secret content was not logged.`
				: "Handoff failed. Check options, request identity, expiry, permissions and encrypted-file integrity. Secret content was not logged.",
		);
		process.exitCode = 1;
	});
