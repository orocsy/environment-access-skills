import { Blocked, GREEN, RED } from "../lib/context.mjs";
import { publicUrl } from "../lib/schema.mjs";
import { recordCreated } from "../lib/state.mjs";
import { canRevokeSafely, storeAndSpread } from "../lib/rotate.mjs";

const LOGIN_GATE = "stripe.login";

// webhooks: { connect: /path } or { connect: { path, events: [...], connect: true, secret_env: NAME } }.
// Only a hook with events can be created; a bare path is checked, not managed.
const webhooksOf = (cap) =>
	Object.entries(cap.webhooks ?? {}).map(([key, value]) => (typeof value === "string" ? { key, path: value } : { key, ...value }));

// The host that serves this app's webhooks: the capability Stripe calls back.
const hookBase = (ctx, cap) => publicUrl(ctx.stack, cap.on ?? "api_host");
const mode = (cap) => (cap.mode === "live" ? ["--live"] : []);
const list = (ctx, cap) => ctx.json("stripe", ["webhook_endpoints", "list", "--limit", "100", ...mode(cap)], { gate: LOGIN_GATE });
const sameEvents = (a = [], b = []) => [...a].sort().join() === [...b].sort().join();

async function createEndpoint(ctx, cap, hook) {
	const made = await ctx.call("stripe", [
		"webhook_endpoints",
		"create",
		...mode(cap),
		"-d",
		`url=${hookBase(ctx, cap)}${hook.path}`,
		...hook.events.flatMap((e) => ["-d", `enabled_events[]=${e}`]),
		...(hook.connect ? ["-d", "connect=true"] : []),
		"-d",
		`description=${ctx.stack.app} ${hook.key} (stack-setup)`,
	]);
	if (!made.id || typeof made.secret !== "string") throw new Error("Stripe did not return the endpoint's signing secret");
	recordCreated(ctx, `stripe.webhook.${made.id}`, "stripe", { id: made.id, name: `${hook.key} webhook`, url: made.url, env: hook.secret_env });
	return made;
}

export default {
	provider: "stripe",
	tools: [{ cmd: "stripe", args: ["--version"] }],
	validate(cap) {
		const errors = [];
		if (!["sandbox", "live"].includes(cap.mode)) errors.push("mode: sandbox or live");
		for (const hook of webhooksOf(cap)) {
			if (typeof hook.path !== "string" || !hook.path.startsWith("/")) errors.push(`webhooks.${hook.key}: a path like /webhooks/stripe, or { path, events, secret_env }`);
			if (hook.events !== undefined && (!Array.isArray(hook.events) || !hook.events.every((e) => /^[a-z_.*]+$/.test(e)))) errors.push(`webhooks.${hook.key}.events: Stripe event names`);
			if (hook.events && !/^[A-Z][A-Z0-9_]*$/.test(hook.secret_env ?? "")) errors.push(`webhooks.${hook.key}.secret_env: the env name for its signing secret`);
		}
		if (cap.connect_redirect !== undefined && !String(cap.connect_redirect).startsWith("/"))
			errors.push("connect_redirect: the API path Stripe returns to, like /payments/connect/callback");
		if (cap.account !== undefined && !/^acct_[A-Za-z0-9]+$/.test(cap.account)) errors.push("account: acct_…");
		return errors;
	},
	gates(cap, stack) {
		const gates = [
			{
				id: LOGIN_GATE,
				bundle: "preflight",
				type: "consent",
				title: "Install the Stripe CLI and approve its login",
				prefill: { install: "brew install stripe/stripe-cli/stripe (or Stripe's signed release)", command: "stripe login" },
				closedBy: "stripe.login",
			},
		];
		if (cap.restricted_key)
			gates.push({
				id: "stripe.restricted-key",
				bundle: "app",
				type: "console",
				title: `Create a restricted ${cap.mode === "live" ? "live" : "test"} key for the API`,
				link: `https://dashboard.stripe.com/${cap.mode === "live" ? "" : "test/"}apikeys/create?name=${encodeURIComponent(`${stack.app} API (stack-setup)`)}`,
				prefill: { name: `${stack.app} API (stack-setup)`, permissions: (cap.restricted_key.permissions ?? []).join(", ") },
				receive: [cap.restricted_key.env ?? "STRIPE_SECRET_KEY"],
				note: "Stripe makes restricted keys only in the dashboard. Hand it back with secure-key-handoff, then: stack gates pickup stripe.restricted-key --file <decrypted .env>",
			});
		if (cap.connect === "oauth")
			gates.push({
				id: "stripe.connect-oauth",
				bundle: "app",
				type: "console",
				title: "Turn on Connect OAuth and register the redirect",
				link: "https://dashboard.stripe.com/test/settings/connect/onboarding-options/oauth",
				prefill: cap.connect_redirect ? { redirect: `${publicUrl(stack, cap.on ?? "api_host")}${cap.connect_redirect}`, default: "yes" } : {},
				note: "Then copy the test client ID (ca_…). It is not secret, so chat is fine.",
			});
		gates.push({
			id: "stripe.live",
			bundle: "go-live",
			type: "identity",
			title: "Activate the Stripe account for live payments",
			link: "https://dashboard.stripe.com/account/onboarding",
			note: "Company details, bank account and identity check. Live keys follow.",
		});
		return gates;
	},
	async doctor(ctx) {
		const result = await ctx.run("stripe", ["config", "--list"]);
		if (result.missing) throw new Blocked("stripe is not installed", LOGIN_GATE);
		return [{ id: "stripe.login", status: /test_mode_api_key/.test(result.stdout) ? GREEN : RED, detail: /test_mode_api_key/.test(result.stdout) ? "CLI signed in" : "CLI not signed in" }];
	},
	async plan(ctx, name, cap, { storeHas, storeReadable }) {
		const managed = webhooksOf(cap).filter((h) => h.events);
		if (!managed.length) return [];
		const { data = [] } = await list(ctx, cap);
		const steps = [];
		for (const hook of managed) {
			const url = `${hookBase(ctx, cap)}${hook.path}`;
			const found = data.find((w) => w.url === url);
			const id = `${name}.webhook.${hook.key}`;
			if (!found) {
				steps.push(
					!storeReadable
						? { id, kind: "blocked", summary: `no endpoint for ${url}; not creating one until the secret store can be read, since Stripe shows its secret only once` }
						: {
								id,
								kind: "create",
								summary: `webhook ${url} (${hook.events.length} events${hook.connect ? ", connected accounts" : ""}) → ${hook.secret_env}`,
								mints: [hook.secret_env],
								run: async () => ctx.minted.set(hook.secret_env, (await createEndpoint(ctx, cap, hook)).secret),
							},
				);
				continue;
			}
			if (!storeHas(hook.secret_env)) {
				steps.push({ id, kind: "blocked", summary: `${found.id} exists but ${hook.secret_env} isn't in the store; Stripe shows a secret only once, so run stack rotate ${hook.secret_env}` });
				continue;
			}
			steps.push(
				sameEvents(found.enabled_events, hook.events)
					? { id, kind: "noop", summary: `webhook ${found.id} with its ${hook.events.length} events` }
					: {
							id,
							kind: "update",
							summary: `webhook ${found.id} events → ${hook.events.join(", ")} (secret unchanged)`,
							run: () => ctx.call("stripe", ["webhook_endpoints", "update", found.id, ...mode(cap), ...hook.events.flatMap((e) => ["-d", `enabled_events[]=${e}`])]),
						},
			);
		}
		return steps;
	},
	// A new endpoint (Stripe can't re-issue a secret), the store and app switched
	// to its secret, then the old endpoint deleted.
	async rotate(ctx, name, cap, target) {
		const hook = webhooksOf(cap).find((h) => h.events && h.secret_env === target);
		if (!hook) return null;
		const url = `${hookBase(ctx, cap)}${hook.path}`;
		const old = (await list(ctx, cap)).data.filter((w) => w.url === url);
		const made = await createEndpoint(ctx, cap, hook);
		await storeAndSpread(ctx, { [target]: made.secret });
		if (!canRevokeSafely(ctx.stack))
			return `new endpoint ${made.id} and ${target} are in the store; the old endpoint ${old.map((w) => w.id).join(", ")} keeps running until the app is redeployed (no secrets.canonical.reload); delete it then`;
		for (const w of old) {
			await ctx.call("stripe", ["webhook_endpoints", "delete", w.id, "--confirm", ...mode(cap)]);
			delete ctx.state.resources[`stripe.webhook.${w.id}`];
		}
		return `new endpoint ${made.id}; ${target} in the store, mirrors and app; deleted ${old.map((w) => w.id).join(", ") || "nothing"}`;
	},
	async remove(ctx, key, resource) {
		const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "stripe");
		await ctx.call("stripe", ["webhook_endpoints", "delete", resource.id, "--confirm", ...mode(cap)]);
		return `Stripe webhook ${resource.url}`;
	},
	async import(ctx, name, cap) {
		const { data = [] } = await list(ctx, cap);
		const base = hookBase(ctx, cap);
		return webhooksOf(cap)
			.map((hook) => [hook, data.find((w) => w.url === `${base}${hook.path}`)])
			.filter(([, w]) => w)
			.map(([hook, w]) => ({ key: `stripe.webhook.${w.id}`, fields: { id: w.id, url: w.url, name: `${hook.key} webhook` } }));
	},
	async verify(ctx, name, cap) {
		const checks = [];
		const base = hookBase(ctx, cap);
		// An unsigned POST must be refused: proves the route is live and checks signatures.
		for (const { key, path } of webhooksOf(cap)) {
			const url = `${base}${path}`;
			try {
				const response = await ctx.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
				checks.push({
					id: `${name}.webhook.${key}.route`,
					status: response.status === 400 ? GREEN : RED,
					detail: `unsigned POST ${path} → ${response.status}${response.status === 400 ? " (refused, as it should be)" : ""}`,
				});
			} catch (error) {
				checks.push({ id: `${name}.webhook.${key}.route`, status: RED, detail: `${url}: ${error.message}` });
			}
		}
		const listed = await list(ctx, cap).catch((error) => error);
		if (listed instanceof Blocked) {
			checks.push({ id: "stripe.login", status: "blocked", detail: listed.message, gate: listed.gate });
			return checks;
		}
		if (listed instanceof Error) throw listed;
		checks.push({ id: "stripe.login", status: GREEN, detail: "CLI signed in" });
		for (const hook of webhooksOf(cap)) {
			const found = listed.data.filter((w) => w.url === `${base}${hook.path}`);
			const enabled = found.find((w) => w.status === "enabled");
			const eventsOk = !hook.events || (enabled && sameEvents(enabled.enabled_events, hook.events));
			checks.push({
				id: `${name}.webhook.${hook.key}`,
				status: enabled && eventsOk && found.length === 1 ? GREEN : RED,
				detail: !found.length
					? `no endpoint for ${base}${hook.path}`
					: `${found.map((w) => `${w.id} ${w.status}`).join(", ")}, ${enabled?.enabled_events.length ?? 0} events${eventsOk ? "" : " (not the events stack.yaml lists)"}${found.length > 1 ? "; more than one endpoint for this URL" : ""}`,
			});
		}
		return checks;
	},
};
