// stack init: a project's own agent (or its owner) drafts the stack file from
// the code. It reads manifests, Docker/compose files, workflows and env
// *examples* — never a real .env — and records why it chose each provider.
// Whatever the code can't tell becomes a question instead of a guess.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import { execFile } from "node:child_process";
import { findSecret } from "./guard.mjs";

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv", "venv", "__pycache__", "DerivedData", "Pods", ".turbo", "coverage", ".stack"]);
const MAX_DEPTH = 4;

async function walk(root, dir = root, depth = 0, out = []) {
	if (depth > MAX_DEPTH) return out;
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		if (SKIP.has(e.name)) continue;
		const path = join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name.endsWith(".xcodeproj")) out.push(relative(root, path));
			await walk(root, path, depth + 1, out);
		} else out.push(relative(root, path));
	}
	return out;
}

// A real env file holds secrets; only examples and templates are read.
export const isEnvExample = (path) => /(^|\/)(\.env\.(example|sample|template)|[^/]*\.env\.(example|sample|template)|env\.example)$/i.test(path);
const isRealEnv = (path) => /(^|\/)\.env(\.[a-z]+)?$/i.test(path) && !isEnvExample(path);

const DEP_RULES = [
	// [dependency pattern, capability, provider, why]
	[/^next$/, "web", "vercel", "Next.js app"],
	[/^stripe$/, "payments", "stripe", "Stripe SDK"],
	[/^resend$/, "email", "resend", "Resend SDK"],
	[/^@supabase\/supabase-js$/, "database", "supabase", "Supabase client"],
	[/^(@prisma\/client|prisma|pg|postgres|drizzle-orm|sqlalchemy|psycopg2?(-binary)?|psycopg|asyncpg|alembic)$/, "database", "postgres", "Postgres driver or ORM"],
	[/^(redis|ioredis|bullmq|celery)$/, "cache", "redis", "Redis client or queue"],
	[/^@clerk\//, "signin", "clerk", "Clerk SDK"],
	[/^(next-auth|@auth\/core|passport-google-oauth20|google-auth-library)$/, "signin", "google-oauth", "Google sign-in library"],
	[/^(@aws-sdk\/client-s3|boto3|aioboto3)$/, "storage", "s3-compatible", "S3 client"],
	[/^(tencentcloud-sdk-python(-sms)?|tencentcloud-sdk-nodejs(-sms)?)$/, "sms", "tencent-sms", "Tencent Cloud SDK (SMS)"],
	[/^twilio$/, "sms", "twilio", "Twilio SDK"],
	[/^(openai|@anthropic-ai\/sdk|anthropic|dashscope)$/, "ai", "llm-api", "an LLM API client"],
	[/^(@sentry\/[a-z-]+|sentry-sdk)$/, "monitoring", "sentry", "Sentry SDK"],
	[/^posthog(-js|-node)?$/, "analytics", "posthog", "PostHog SDK"],
];

// A specific finding refines a general one rather than conflicting with it.
const REFINES = { postgres: ["docker-postgres", "supabase"], redis: ["docker-redis"], "s3-compatible": [] };
const refines = (general, specific) => (REFINES[general] ?? []).includes(specific);

// Env names strong enough to name a provider even without its SDK (a plain HTTP call).
const ENV_PROVIDERS = [
	[/^RESEND_API_KEY$|_RESEND_API_KEY$/, "email", "resend"],
	[/^STRIPE_SECRET_KEY$|_STRIPE_SECRET_KEY$/, "payments", "stripe"],
	[/^GOOGLE_CLIENT_ID$|_GOOGLE_CLIENT_ID$/, "signin", "google-oauth"],
	[/TENCENT_SMS_SECRET_ID$/, "sms", "tencent-sms"],
	[/^TWILIO_ACCOUNT_SID$|_TWILIO_ACCOUNT_SID$/, "sms", "twilio"],
	[/(_AI_API_KEY|^OPENAI_API_KEY|^ANTHROPIC_API_KEY|DEEPSEEK_API_KEY)$/, "ai", "llm-api"],
];

// Env names → the capability that provides them.
const ENV_RULES = [
	[/^(STRIPE_|NEXT_PUBLIC_STRIPE_)/, "payments"],
	[/(^|_)RESEND_|^EMAIL_FROM$/, "email"],
	[/^(GOOGLE_|NEXT_PUBLIC_GOOGLE_)/, "signin"],
	[/(DATABASE_URL|POSTGRES_|_DB_)/, "database"],
	[/(REDIS_URL|REDIS_)/, "cache"],
	[/(_S3_|^S3_|_R2_|^R2_|_COS_)/, "storage"],
	[/(TENCENT_SMS|TWILIO_|_SMS_)/, "sms"],
	[/(_AI_|^OPENAI_|^ANTHROPIC_|_ASR_|DEEPSEEK)/, "ai"],
	[/(TUNNEL_TOKEN)/, "api_host"],
];

const composeScore = (path) => (/local|test|smoke|dev|interim|s3-smoke/i.test(path) ? -1 : /deploy|ec2/i.test(path) ? 3 : /infra/i.test(path) ? 2 : /prod/i.test(path) ? 1 : 0);

const parseJson = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

function pythonDeps(text, file) {
	const deps = new Set();
	if (file.endsWith("pyproject.toml")) {
		for (const m of text.matchAll(/^\s*"([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*[<>=~!;"]/gm)) deps.add(m[1].toLowerCase());
		for (const m of text.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=\s*["{]/gm)) deps.add(m[1].toLowerCase());
	} else for (const m of text.matchAll(/^\s*([A-Za-z0-9_.-]+)/gm)) deps.add(m[1].toLowerCase());
	return [...deps];
}

function composeServices(text) {
	// Enough YAML for compose: top-level services and their image lines.
	const services = [];
	let inServices = false;
	let current = null;
	for (const line of text.split(/\r?\n/)) {
		if (/^services:\s*$/.test(line)) {
			inServices = true;
			continue;
		}
		if (/^\S/.test(line)) inServices = false;
		if (!inServices) continue;
		const svc = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
		if (svc) {
			current = { name: svc[1], image: "" };
			services.push(current);
			continue;
		}
		const image = /^ {4}image:\s*["']?([^"'\s]+)/.exec(line);
		if (image && current) current.image = image[1];
	}
	return services;
}

const remoteRepo = (dir) =>
	new Promise((resolve) =>
		execFile("git", ["-C", dir, "remote", "get-url", "origin"], (error, stdout) => {
			const m = !error && /github\.com[:/]([^/\s]+\/[^/\s]+?)(\.git)?\s*$/.exec(stdout);
			resolve(m ? m[1] : null);
		}),
	);

export async function detect(root, { remote = remoteRepo } = {}) {
	const files = await walk(root);
	const read = (path) => readFile(join(root, path), "utf8").catch(() => "");
	const found = new Map(); // capability → { provider, options, evidence[] }
	const note = (cap, provider, evidence, options = {}) => {
		const entry = found.get(cap) ?? { provider, options: {}, evidence: [] };
		if (refines(entry.provider, provider)) entry.provider = provider;
		else if (entry.provider !== provider && !refines(provider, entry.provider) && !entry.conflicts?.includes(provider)) entry.conflicts = [...(entry.conflicts ?? []), provider];
		// The deployment's compose file wins over a local or test one.
		if (options.compose && entry.options.compose && composeScore(options.compose) <= composeScore(entry.options.compose)) delete options.compose;
		Object.assign(entry.options, options);
		entry.evidence.push(evidence);
		found.set(cap, entry);
	};
	const envNames = new Set();
	const hints = { forms: new Set(), cn: [], skipped: [], webApps: [] };

	for (const file of files) {
		const name = basename(file);
		if (isRealEnv(file)) {
			hints.skipped.push(file);
			continue;
		}
		if (name === "package.json") {
			const pkg = parseJson(await read(file));
			const deps = Object.keys({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) });
			for (const dep of deps)
				for (const [re, cap, provider, why] of DEP_RULES) if (re.test(dep)) note(cap, provider, `${file}: ${dep} (${why})`);
			if (deps.includes("next")) {
				hints.forms.add("website");
				if (file.includes("/")) hints.webApps.push(basename(file.slice(0, -"/package.json".length)));
			}
		} else if (name === "pyproject.toml" || /^requirements.*\.txt$/.test(name)) {
			const deps = pythonDeps(await read(file), file);
			for (const dep of deps)
				for (const [re, cap, provider, why] of DEP_RULES) if (re.test(dep)) note(cap, provider, `${file}: ${dep} (${why})`);
			if (deps.includes("fastapi") || deps.includes("django") || deps.includes("flask")) {
				note("api_host", "container-host", `${file}: ${deps.find((d) => ["fastapi", "django", "flask"].includes(d))} API`);
				hints.forms.add("api");
			}
		} else if (/(^|-)compose[^/]*\.ya?ml$/.test(name)) {
			for (const s of composeServices(await read(file))) {
				if (/postgres|pgvector/.test(s.image)) note("database", "docker-postgres", `${file}: service ${s.name} (${s.image})`, { on: "api_host" });
				if (/redis|valkey/.test(s.image)) note("cache", "docker-redis", `${file}: service ${s.name} (${s.image})`, { on: "api_host" });
				if (/cloudflared/.test(s.image)) note("api_host", "container-host", `${file}: service ${s.name} runs a Cloudflare Tunnel`, { ingress: "cloudflare-tunnel" });
				if (/minio|garage/.test(s.image)) note("storage", "s3-compatible", `${file}: service ${s.name} (${s.image}, a local S3 stand-in)`);
			}
			note("api_host", "container-host", `${file}: Docker Compose deployment`, { compose: file });
		} else if (name === "Dockerfile") {
			note("api_host", "container-host", `${file}: Dockerfile`);
		} else if (name === "vercel.json") {
			note("web", "vercel", `${file}: Vercel config`);
		} else if (name === "wrangler.toml" || name === "wrangler.jsonc") {
			note("web", "cloudflare-workers", `${file}: Cloudflare Workers config`);
		} else if (file.startsWith(".github/workflows/")) {
			note("ci", "github", `${file}: GitHub Actions workflow`);
		} else if (file.endsWith(".xcodeproj")) {
			hints.forms.add("ios-app");
			const pbx = await read(join(file, "project.pbxproj"));
			const ids = [...new Set([...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([A-Za-z0-9.-]+)"?;/g)].map((m) => m[1]))].filter((id) => !/Tests?$/i.test(id));
			note("ios", "apple-app-store", `${file}: iOS app${ids.length ? ` (${ids.join(", ")})` : ""}`, ids[0] ? { bundle_id: ids[0] } : {});
		} else if (isEnvExample(file)) {
			for (const line of (await read(file)).split(/\r?\n/)) {
				const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
				if (!m) continue;
				envNames.add(m[1]);
				for (const [re, cap, provider] of ENV_PROVIDERS) if (re.test(m[1]) && !found.has(cap)) note(cap, provider, `${file}: ${m[1]} (no SDK; the env name says so)`);
				if (/TENCENT|DEEPSEEK|DASHSCOPE|ALIYUN/.test(m[1])) hints.cn.push(m[1]);
			}
		}
	}

	const contract = {};
	for (const name of [...envNames].sort()) {
		const cap = ENV_RULES.find(([re]) => re.test(name))?.[1] ?? "api_host";
		(contract[cap] ??= []).push(name);
	}
	const repo = (await remote(root)) ?? null;
	if (repo && found.has("ci")) found.get("ci").options.repo = repo;
	return { found, contract, forms: [...hints.forms], cnHints: hints.cn, skipped: hints.skipped, repo, webApps: hints.webApps };
}

// Generic findings → this stack's providers. Only choices the code can't make are questions.
export function draft(detected, { app, domain, jurisdiction }) {
	const cn = jurisdiction === "cn-mainland";
	const caps = {};
	const questions = [];
	const why = {};
	for (const [cap, f] of detected.found) {
		let provider = f.provider;
		const options = { ...f.options };
		if (provider === "container-host") {
			provider = cn ? "tencent-lighthouse" : "aws-ec2-docker";
			if (cn) Object.assign(options, { region: "ap-guangzhou" });
			else Object.assign(options, { profile: app, region: "ap-southeast-2", name: `${app}-api`, ssh: { user: "ec2-user", key: `~/.ssh/${app}-prod` } });
			options.hostname = "api";
			questions.push(cn ? "api_host: Lighthouse region (ap-guangzhou assumed) and the server size" : "api_host: AWS profile, region and the instance's Name tag; or another host (Render, Railway, Fly)");
		}
		if (provider === "postgres") {
			provider = caps.api_host || detected.found.has("api_host") ? "docker-postgres" : "neon";
			if (provider === "docker-postgres") options.on = "api_host";
			else questions.push("database: a managed Postgres (Neon, Supabase, TencentDB) or one on your own server?");
		}
		if (provider === "redis") {
			provider = detected.found.has("api_host") ? "docker-redis" : "upstash";
			if (provider === "docker-redis") options.on = "api_host";
		}
		if (provider === "s3-compatible") {
			provider = cn ? "tencent-cos" : "cloudflare-r2";
			questions.push(`storage: ${cn ? "Tencent COS (mainland)" : "Cloudflare R2"} assumed for the S3-compatible storage; bucket names?`);
		}
		if (provider === "llm-api") {
			questions.push("ai: which model provider (and, in China, its filed model)?");
		}
		if (cn && ["stripe", "google-oauth", "resend", "vercel"].includes(provider))
			questions.push(`${cap}: ${provider} doesn't serve mainland users; replace it for the China deployment`);
		if (f.conflicts?.length) questions.push(`${cap}: the code points to both ${[provider, ...f.conflicts].join(" and ")}; which one runs in production?`);
		caps[cap] = { provider, ...options };
		why[cap] = f.evidence;
	}
	if (caps.web?.provider === "vercel") {
		caps.web.scope = "todo-team";
		caps.web.projects = detected.webApps?.length ? detected.webApps.map((a) => a.toLowerCase().replace(/[^a-z0-9._-]/g, "-")) : ["todo-project"];
		questions.push(`web: the Vercel team (scope)${detected.webApps?.length ? `, and the Vercel project names for ${detected.webApps.join(", ")}` : " and project names"}`);
	}
	if (cn && caps.api_host?.ingress === "cloudflare-tunnel") {
		delete caps.api_host.ingress;
		questions.push("api_host: the code runs a Cloudflare Tunnel; a mainland deployment serves the filed domain directly from the server (ports 80/443), so the tunnel is left out here");
	}
	if (caps.api_host?.ingress === "cloudflare-tunnel") {
		caps.api_host.tunnel = `${app}-api`;
		questions.push(`api_host: the Cloudflare Tunnel's name (${app}-api assumed)`);
	}
	if (caps.signin?.provider === "google-oauth") {
		caps.signin.project = `${app}-app`.slice(0, 30).replace(/-+$/, "");
		questions.push("signin: the Google Cloud project ID and the sign-in redirect paths");
	}
	if (caps.email?.provider === "resend") Object.assign(caps.email, { profile: app, subdomain: "mail", sender: "no-reply" });
	if (caps.payments?.provider === "stripe") Object.assign(caps.payments, { mode: "sandbox" });
	if (caps.ci && !caps.ci.repo) {
		caps.ci.repo = "owner/repo";
		questions.push("ci: the GitHub repository (owner/name)");
	}
	if (caps.ios) questions.push("ios: App Store Connect access (an API key you create once) and the team");
	if (Object.keys(caps).length && !caps.dns) {
		caps.dns = cn ? { provider: "dnspod", registrar: "tencent" } : { provider: "cloudflare", token_file: `~/.config/${app}/cloudflare.env`, bootstrap_token_file: "~/.config/stack-setup/cloudflare-bootstrap.env" };
		why.dns = ["no DNS in the code; the usual choice for this region"];
	}
	if (domain === "example.com") questions.unshift("domain: the app's real domain");
	if (!cn && detected.cnHints.length) questions.push(`the code mentions mainland services (${[...new Set(detected.cnHints)].slice(0, 4).join(", ")}); add a cn-mainland stack file too? (stack init --jurisdiction cn-mainland --out infra/stack/cn.stack.yaml)`);
	// Env names whose capability wasn't found go with the server that reads them.
	const contract = {};
	for (const [cap, names] of Object.entries(detected.contract)) {
		const target = caps[cap] ? cap : caps.api_host ? "api_host" : caps.web ? "web" : Object.keys(caps)[0];
		if (target) contract[target] = [...new Set([...(contract[target] ?? []), ...names])].sort();
	}
	const secrets = caps.api_host ? { canonical: { type: "server-env", host: "api_host", path: `~/${app}/${app}.env` } } : { canonical: { type: "local-env", path: `~/.config/${app}/app.env` } };
	return { stack: { app, domain, ...(cn && { jurisdiction }), capabilities: caps, contract, secrets }, why, questions: [...new Set(questions)] };
}

// YAML for the draft, with the evidence as comments so the owner can see why.
export function render({ stack, why, questions }, { forms }) {
	const scalar = (v) => (typeof v === "string" && /^[A-Za-z0-9_./~@-]+$/.test(v) ? v : JSON.stringify(v));
	const inline = (v) =>
		Array.isArray(v) ? `[${v.map(inline).join(", ")}]` : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${inline(x)}`).join(", ")} }` : scalar(v);
	const lines = [
		"# Drafted by `stack init` from this repo's code. Check every line, answer the",
		"# questions at the bottom, then run: stack doctor, stack plan.",
		`app: ${stack.app}`,
		`domain: ${stack.domain}${stack.domain === "example.com" ? "                 # TODO: the real domain" : ""}`,
	];
	if (stack.jurisdiction) lines.push(`jurisdiction: ${stack.jurisdiction}`, "profile:", `  forms: [${forms.join(", ")}]`, "  # stack guide ask lists the rest of the questions");
	lines.push("", "capabilities:");
	for (const [cap, value] of Object.entries(stack.capabilities)) {
		for (const reason of why[cap] ?? []) lines.push(`  # ${reason}`);
		const { provider, ...rest } = value;
		lines.push(`  ${cap}:`, `    provider: ${provider}`);
		for (const [k, v] of Object.entries(rest)) lines.push(`    ${k}: ${inline(v)}`);
	}
	if (Object.keys(stack.contract).length) {
		lines.push("", "# Env names the code reads (from env examples; values are never read).", "contract:");
		for (const [cap, names] of Object.entries(stack.contract)) lines.push(`  ${cap}: [${names.join(", ")}]`);
	}
	lines.push("", "secrets:", `  canonical: ${inline(stack.secrets.canonical)}`);
	if (questions.length) lines.push("", "# Questions the code can't answer:", ...questions.map((q) => `#  - ${q}`));
	const text = `${lines.join("\n")}\n`;
	const leak = findSecret(text);
	if (leak) throw new Error(`the draft would contain a ${leak}; nothing was written`);
	return text;
}

export async function exists(path) {
	return stat(path).then(() => true, () => false);
}
