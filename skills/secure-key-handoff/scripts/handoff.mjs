#!/usr/bin/env node
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, realpath } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX = 16384;
const fromPem = (pem) =>
	Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64");
const binding = (r) =>
	JSON.stringify({
		version: 1,
		id: r.id,
		platform: r.platform,
		environment: r.environment,
	});
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
		!Number.isFinite(Date.parse(r.expiresAt)) ||
		Date.parse(r.expiresAt) <= Date.now()
	)
		throw new Error("Invalid or expired request");
	const digest = createHash("sha256")
		.update(fromPem(r.publicKey))
		.digest("hex");
	if (digest !== r.fingerprint)
		throw new Error("Public key fingerprint mismatch");
}
function validateSecret(s) {
	if (typeof s !== "string" || !s.trim() || Buffer.byteLength(s) > MAX)
		throw new Error("Secret must contain 1 to 16384 UTF-8 bytes");
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
		throw new Error("Encrypted response does not match this request");
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
		throw new Error("Invalid encryption parameters");
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
	return text;
}
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
	const payload = JSON.stringify(request).replace(/</g, "\\u003c");
	return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';connect-src 'none';form-action 'none';base-uri 'none'"><title>密钥安全交接</title><style>body{max-width:620px;margin:40px auto;padding:24px;font:16px/1.7 system-ui;color:#173449}textarea,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0}textarea{height:100px}button{background:#155e75;color:white;border:0;border-radius:8px}small{overflow-wrap:anywhere;color:#526477}output{display:block}</style><h1>${escape(request.label)}</h1><p>平台：${escape(request.platform)} · 环境：${escape(request.environment)}<br>请在自己的电脑打开。粘贴密钥后，本机加密并下载文件，再把文件交给接收方。</p><form><label for="secret">粘贴本次要交接的密钥</label><textarea id="secret" required autocomplete="off" spellcheck="false" aria-label="粘贴密钥"></textarea><button>加密并下载</button></form><output aria-live="polite"></output><p><small>本页不联网、不保存输入。只使用接收方通过已确认渠道提供的文件。不要发送原始密钥或截图。请求有效期至 ${escape(request.expiresAt)}；该期限不等于撤销平台密钥。<br>公钥指纹：${escape(request.fingerprint)}</small></p><script>const request=${payload};const seal=${seal.toString()};document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const field=document.querySelector('textarea');const status=document.querySelector('output');try{const data=await seal(request,field.value);const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=request.platform+'-'+request.environment+'-encrypted.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);field.value='';status.textContent='已生成加密文件。请把下载的 encrypted.json 文件交给接收方。';}catch{status.textContent='未生成文件：请检查密钥是否为空、请求是否过期，或联系接收方。'}});</script></html>`;
}
async function json(path) {
	const raw = await readFile(path, "utf8");
	if (Buffer.byteLength(raw) > 100000) throw new Error("File too large");
	return JSON.parse(raw);
}
async function outsideGit(path) {
	await mkdir(path, { recursive: true, mode: 0o700 });
	let current = await realpath(path);
	while (true) {
		try {
			await lstat(join(current, ".git"));
			throw new Error("Private material must be outside every Git checkout");
		} catch (e) {
			if (e.code !== "ENOENT") throw e;
		}
		const parent = dirname(current);
		if (parent === current) return;
		current = parent;
	}
}
async function privateFile(path, contents) {
	await outsideGit(dirname(resolve(path)));
	await writeFile(path, contents, { flag: "wx", mode: 0o600 });
}
function options(args) {
	const o = {};
	for (let i = 0; i < args.length; i += 2) {
		if (!args[i]?.startsWith("--") || !args[i + 1] || o[args[i].slice(2)])
			throw new Error("Expected --option value");
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
			throw new Error(
				"prepare requires platform, environment, label, private-dir, out",
			);
		const hours = Number(o.hours ?? 24);
		if (!Number.isFinite(hours) || hours <= 0 || hours > 168)
			throw new Error("hours must be 0 to 168");
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
				fingerprint: request.fingerprint,
				output: resolve(o.out),
				privateKey: resolve(o["private-dir"], request.id + ".pem"),
			}),
		);
	} else if (mode === "seal") {
		const request = await json(o.request);
		validateRequest(request);
		// CLI backup for an owner with Node installed. Never accept secrets in arguments.
		const secret =
			o.stdin === "true" ? await readStdin() : await promptSecret();
		validateSecret(secret);
		await writeFile(o.out, JSON.stringify(await seal(request, secret)), {
			flag: "wx",
			mode: 0o600,
		});
		console.log("Encrypted response written. No secret printed.");
	} else if (mode === "receive") {
		const request = await json(o.request);
		const envelope = await json(o.input);
		const info = await lstat(o.key);
		if (
			info.isSymbolicLink() ||
			!info.isFile() ||
			(process.platform !== "win32" && info.mode & 0o077)
		)
			throw new Error("Private key must be a regular mode-0600 file");
		const secret = await open(request, envelope, await readFile(o.key, "utf8"));
		await privateFile(o.out, secret);
		console.log("Secret saved to a private file. No plaintext printed.");
	} else
		throw new Error(
			"Commands: prepare, seal, receive. See SKILL.md for options.",
		);
}
async function readStdin() {
	let size = 0;
	const chunks = [];
	for await (const chunk of process.stdin) {
		const bytes = Buffer.from(chunk);
		size += bytes.length;
		if (size > MAX) throw new Error("Secret too large");
		chunks.push(bytes);
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(
		Buffer.concat(chunks),
	);
}
async function promptSecret() {
	if (!process.stdin.isTTY)
		throw new Error("Use a terminal or explicit --stdin true");

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
				if (c === "\u0003") return finish(new Error("Cancelled"));
				if (c === "\r" || c === "\n") return finish();
				if (c === "\u007f" || c === "\b")
					value = Array.from(value).slice(0, -1).join("");
				else if (c >= " ") value += c;
				if (Buffer.byteLength(value) > MAX)
					return finish(new Error("Secret too large"));
			}
		};
		input.setRawMode(true);
		input.on("data", onData);
		input.resume();
		process.stderr.write("Paste secret (hidden), then press Enter: ");
	});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main(process.argv.slice(2)).catch(() => {
		console.error(
			"Handoff failed. Check options, request identity, expiry, permissions and encrypted-file integrity. Secret content was not logged.",
		);
		process.exitCode = 1;
	});
