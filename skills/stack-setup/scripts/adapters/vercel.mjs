import { GREEN, RED } from "../lib/context.mjs";
import { recordCreated } from "../lib/state.mjs";
import { publicUrl } from "../lib/schema.mjs";

const LOGIN_GATE = "vercel.login";
const projectsOf = (cap) => (cap.projects ?? []).map((p) => (typeof p === "string" ? { name: p } : p));

const get = (ctx, cap, path) =>
	ctx.json("vercel", ["api", `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(cap.scope)}`, "--raw"], {
		gate: LOGIN_GATE,
	});

const send = (ctx, cap, method, path, body) =>
	ctx.call("vercel", ["api", `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(cap.scope)}`, "-X", method, "--input", "-", "--raw"], {
		input: JSON.stringify(body),
	});

// The value a config entry should have: written out, or another capability's URL.
export function configValue(stack, entry) {
	if (entry.value !== undefined) return entry.value;
	if (entry.from) return publicUrl(stack, entry.from.split(".")[0]);
	return undefined;
}

export default {
	provider: "vercel",
	// Config only (never secrets): created when missing, corrected when different.
	// "sensitive" values can't be read back, so those are only checked by name.
	async plan(ctx, name, cap) {
		const steps = [];
		const config = (ctx.stack.secrets?.config ?? []).filter((c) => c.target === "vercel");
		for (const p of projectsOf(cap)) {
			const wanted = config.filter((c) => !c.projects || c.projects.includes(p.name));
			if (!wanted.length) continue;
			const project = await get(ctx, cap, `/v9/projects/${encodeURIComponent(p.name)}`);
			const { envs = [] } = await get(ctx, cap, `/v10/projects/${project.id}/env`);
			for (const entry of wanted) {
				const value = configValue(ctx.stack, entry);
				const targets = entry.targets ?? ["production", "preview"];
				const found = envs.find((e) => e.key === entry.name && (e.target ?? []).includes("production"));
				const id = `${name}.${p.name}.env.${entry.name}`;
				if (!found) {
					steps.push(
						value === undefined
							? { id, kind: "blocked", summary: `${entry.name} is missing in ${p.name} and the stack gives no value` }
							: {
									id,
									kind: "create",
									summary: `${p.name}: ${entry.name}=${value} (${targets.join(", ")})`,
									run: async () => {
										const made = await send(ctx, cap, "POST", `/v10/projects/${project.id}/env?upsert=true`, { key: entry.name, value, type: "encrypted", target: targets });
										const createdEnv = made.created ?? made;
										recordCreated(ctx, `vercel.env.${p.name}.${entry.name}`, "vercel", { project: project.id, id: createdEnv.id ?? null, key: entry.name });
									},
								},
					);
					continue;
				}
				if (value === undefined || found.type === "sensitive") {
					steps.push({ id, kind: "noop", summary: `${p.name}: ${entry.name} present${found.type === "sensitive" ? " (sensitive, not compared)" : ""}` });
					continue;
				}
				const current = await get(ctx, cap, `/v1/projects/${project.id}/env/${found.id}`);
				steps.push(
					current.value === value
						? { id, kind: "noop", summary: `${p.name}: ${entry.name}=${value}` }
						: {
								id,
								kind: "update",
								summary: `${p.name}: ${entry.name} → ${value} (redeploy to take effect)`,
								run: () => send(ctx, cap, "PATCH", `/v9/projects/${project.id}/env/${found.id}`, { value }),
							},
				);
			}
		}
		return steps;
	},
	async remove(ctx, key, resource) {
		const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "vercel");
		const { envs = [] } = await get(ctx, cap, `/v10/projects/${resource.project}/env`);
		for (const e of envs.filter((e) => e.key === resource.key)) await send(ctx, cap, "DELETE", `/v9/projects/${resource.project}/env/${e.id}`, {});
		return `Vercel env ${resource.key}`;
	},
	tools: [{ cmd: "vercel", args: ["--version"] }],
	validate(cap) {
		const errors = [];
		if (typeof cap.scope !== "string" || !cap.scope) errors.push("scope: the Vercel team slug or ID");
		const projects = projectsOf(cap);
		if (!projects.length || projects.some((p) => !/^[a-z0-9._-]+$/.test(p.name ?? "")))
			errors.push("projects: a list of project names, or { name, domains }");
		return errors;
	},
	gates() {
		return [
			{
				id: LOGIN_GATE,
				bundle: "preflight",
				type: "consent",
				title: "Approve the Vercel CLI device login",
				prefill: { command: "vercel login" },
				closedBy: "vercel.login",
			},
		];
	},
	async doctor(ctx) {
		const result = await ctx.run("vercel", ["whoami"]);
		return [
			{
				id: "vercel.login",
				status: result.code === 0 ? GREEN : RED,
				detail: result.code === 0 ? `signed in as ${result.stdout.trim().split("\n").pop()}` : "not signed in",
			},
		];
	},
	async import(ctx, name, cap) {
		const out = [];
		for (const p of projectsOf(cap)) {
			const project = await get(ctx, cap, `/v9/projects/${encodeURIComponent(p.name)}`);
			out.push({ key: `vercel.project.${p.name}`, fields: { id: project.id, team: project.accountId, repo: project.link?.repo ?? null } });
		}
		return out;
	},
	async verify(ctx, name, cap) {
		const checks = [{ id: "vercel.login", status: GREEN, detail: `team ${cap.scope}` }];
		const config = (ctx.stack.secrets?.config ?? []).filter((c) => c.target === "vercel");
		for (const p of projectsOf(cap)) {
			const project = await get(ctx, cap, `/v9/projects/${encodeURIComponent(p.name)}`);
			const production = project.targets?.production;
			checks.push({
				id: `${name}.${p.name}.deploy`,
				status: production?.readyState === "READY" ? GREEN : RED,
				detail: `production ${production?.readyState ?? "never deployed"}${project.link?.repo ? `, from Git ${project.link.repo}` : ", not linked to Git"}`,
			});
			if (p.domains?.length) {
				const { domains = [] } = await get(ctx, cap, `/v9/projects/${encodeURIComponent(p.name)}/domains`);
				for (const domain of p.domains) {
					const found = domains.find((d) => d.name === domain);
					checks.push({
						id: `${name}.${p.name}.domain.${domain}`,
						status: found?.verified ? GREEN : RED,
						detail: found ? `${domain} ${found.verified ? "verified" : "not verified"}${found.redirect ? ` → ${found.redirect}` : ""}` : `${domain} not added`,
					});
				}
			}
			const wanted = config.filter((c) => !c.projects || c.projects.includes(p.name));
			if (wanted.length) {
				// Names and targets only; values stay in Vercel.
				const { envs = [] } = await get(ctx, cap, `/v10/projects/${encodeURIComponent(p.name)}/env`);
				const missing = wanted
					.map((c) => c.name)
					.filter((key) => !envs.some((e) => e.key === key && (e.target ?? []).includes("production")));
				checks.push({
					id: `${name}.${p.name}.env`,
					status: missing.length ? RED : GREEN,
					detail: missing.length ? `missing in production: ${missing.join(", ")}` : `${wanted.length} production names present`,
				});
			}
		}
		return checks;
	},
};
