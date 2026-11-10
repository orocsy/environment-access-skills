import { GREEN, RED } from "../lib/context.mjs";

const LOGIN_GATE = "vercel.login";
const projectsOf = (cap) => (cap.projects ?? []).map((p) => (typeof p === "string" ? { name: p } : p));

const get = (ctx, cap, path) =>
	ctx.json("vercel", ["api", `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(cap.scope)}`, "--raw"], {
		gate: LOGIN_GATE,
	});

export default {
	provider: "vercel",
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
