import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// Agent skills and plugins worth having when an app uses a provider. stack-setup
// itself only needs CLIs; these help the coding agent follow each platform's own
// practices. doctor lists them; installing one is a download, so it's asked for first.
export const RECOMMENDED = {
	"tencent-cloudbase": [
		{
			name: "cloudbase",
			kind: "plugin",
			why: "CloudBase's own rules for its database, auth, functions and CloudRun when writing app code",
			install: "Tencent's CloudBase AI Toolkit plugin, pinned to a version, in this app's project only: https://github.com/TencentCloudBase/CloudBase-AI-ToolKit",
		},
	],
	cloudflare: [{ name: "cloudflare", kind: "plugin", why: "Cloudflare's Workers, Tunnel and DNS practices", install: "the Cloudflare plugin in the Anthropic plugin directory" }],
	vercel: [{ name: "vercel", kind: "plugin", why: "Vercel's deployment and Next.js practices", install: "the Vercel plugin (vercel-plugin@vercel)" }],
	stripe: [{ name: "stripe", kind: "plugin", why: "Stripe's API practices when writing payment code", install: "Stripe's Claude plugin" }],
};
// Every stack that receives keys from a person uses this.
const ALWAYS = [{ name: "secure-key-handoff", kind: "skill", why: "a person hands keys back without chat", install: "ln -s <environment-access-skills>/skills/secure-key-handoff ~/.claude/skills/" }];

async function installedPlugins() {
	try {
		const data = JSON.parse(await readFile(join(homedir(), ".claude/plugins/installed_plugins.json"), "utf8"));
		return Object.keys(data.plugins ?? data).map((id) => id.split("@")[0]);
	} catch {
		return [];
	}
}

const exists = (path) => stat(path).then(() => true, () => false);

export function recommendedFor(stack) {
	const seen = new Map(ALWAYS.map((s) => [s.name, { ...s, for: ["any stack"] }]));
	for (const [capName, cap] of Object.entries(stack.capabilities))
		for (const s of RECOMMENDED[cap.provider] ?? []) {
			const entry = seen.get(s.name) ?? { ...s, for: [] };
			entry.for.push(`${capName} (${cap.provider})`);
			seen.set(s.name, entry);
		}
	return [...seen.values()];
}

// Found in the user's skills, the app repo's skills, or an installed plugin whose name starts the same.
export async function skillStatus(stack, { repoRoot, lookup } = {}) {
	const plugins = lookup?.plugins ?? (await installedPlugins());
	const has = lookup?.has ?? ((path) => exists(path));
	const out = [];
	for (const s of recommendedFor(stack)) {
		const found =
			plugins.some((p) => p === s.name || p.startsWith(`${s.name}-`)) ||
			(await has(join(homedir(), ".claude/skills", s.name))) ||
			(repoRoot ? await has(join(repoRoot, ".claude/skills", s.name)) : false);
		out.push({ ...s, installed: found });
	}
	return out;
}
