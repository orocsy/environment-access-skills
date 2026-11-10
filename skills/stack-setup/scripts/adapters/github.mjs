import { GREEN, RED } from "../lib/context.mjs";
import { recordCreated } from "../lib/state.mjs";

const LOGIN_GATE = "github.login";
const gh = (ctx, path) => ctx.json("gh", ["api", path], { gate: LOGIN_GATE });

// The value goes in on stdin, never as an argument.
export async function setSecret(ctx, repo, name, value) {
	const { secrets = [] } = await gh(ctx, `repos/${repo}/actions/secrets?per_page=100`);
	await ctx.call("gh", ["secret", "set", name, "--repo", repo], { input: value });
	if (!secrets.some((s) => s.name === name)) recordCreated(ctx, `github.secret.${repo}.${name}`, "github", { repo, name });
}

export default {
	provider: "github",
	async remove(ctx, key, resource) {
		await ctx.call("gh", ["secret", "delete", resource.name, "--repo", resource.repo]);
		return `GitHub secret ${resource.name} in ${resource.repo}`;
	},
	tools: [{ cmd: "gh", args: ["--version"] }],
	validate(cap) {
		const errors = [];
		if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(cap.repo ?? "")) errors.push("repo: owner/name");
		if (cap.deploy_workflow !== undefined && !/^[A-Za-z0-9._-]+\.ya?ml$/.test(cap.deploy_workflow))
			errors.push("deploy_workflow: a workflow file name like deploy.yml");
		return errors;
	},
	gates() {
		return [
			{
				id: LOGIN_GATE,
				bundle: "preflight",
				type: "consent",
				title: "Sign in to the GitHub CLI",
				prefill: { command: "gh auth login --web" },
				closedBy: "github.login",
			},
		];
	},
	async doctor(ctx) {
		const result = await ctx.run("gh", ["auth", "status"]);
		return [{ id: "github.login", status: result.code === 0 ? GREEN : RED, detail: result.code === 0 ? "signed in" : "not signed in" }];
	},
	async import(ctx, name, cap) {
		const repo = await gh(ctx, `repos/${cap.repo}`);
		return [{ key: `github.repo.${cap.repo}`, fields: { id: repo.id, defaultBranch: repo.default_branch, private: repo.private } }];
	},
	async verify(ctx, name, cap) {
		const repo = await gh(ctx, `repos/${cap.repo}`);
		const checks = [
			{ id: "github.login", status: GREEN, detail: "signed in" },
			{ id: `${name}.repo`, status: GREEN, detail: `${repo.full_name}, default branch ${repo.default_branch}` },
		];
		const wanted = [
			...(cap.required_secrets ?? []),
			...(ctx.stack.secrets?.mirrors ?? []).filter((m) => m.type === "github-secret" && (m.repo ?? cap.repo) === cap.repo).map((m) => m.name),
		];
		if (wanted.length) {
			const { secrets = [] } = await gh(ctx, `repos/${cap.repo}/actions/secrets?per_page=100`);
			const missing = wanted.filter((n) => !secrets.some((s) => s.name === n));
			checks.push({
				id: `${name}.secrets`,
				status: missing.length ? RED : GREEN,
				detail: missing.length ? `missing Actions secrets: ${missing.join(", ")}` : `${wanted.length} Actions secrets present`,
			});
		}
		if (cap.deploy_workflow) {
			const { workflow_runs: [run] = [] } = await gh(
				ctx,
				`repos/${cap.repo}/actions/workflows/${cap.deploy_workflow}/runs?branch=${repo.default_branch}&per_page=1&status=completed`,
			);
			checks.push({
				id: `${name}.deploy`,
				status: run?.conclusion === "success" ? GREEN : RED,
				detail: run ? `last ${cap.deploy_workflow} on ${repo.default_branch}: ${run.conclusion}, ${run.updated_at.slice(0, 10)}` : `${cap.deploy_workflow} never ran on ${repo.default_branch}`,
			});
		}
		return checks;
	},
};
