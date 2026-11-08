import { Blocked, GREEN, RED } from "../lib/context.mjs";
import { publicUrl } from "../lib/schema.mjs";

const LOGIN_GATE = "stripe.login";
const webhooksOf = (cap) => Object.entries(cap.webhooks ?? {});

// The host that serves this app's webhooks: the capability Stripe calls back.
const hookBase = (ctx, cap) => publicUrl(ctx.stack, cap.on ?? "api_host");

export default {
	provider: "stripe",
	tools: [{ cmd: "stripe", args: ["--version"] }],
	validate(cap) {
		const errors = [];
		if (!["sandbox", "live"].includes(cap.mode)) errors.push("mode: sandbox or live");
		for (const [key, path] of webhooksOf(cap))
			if (typeof path !== "string" || !path.startsWith("/")) errors.push(`webhooks.${key}: a path like /webhooks/stripe`);
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
				prefill: { install: "brew install stripe/stripe-cli/stripe", command: "stripe login" },
				closedBy: "stripe.login",
			},
		];
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
		return [{ id: "stripe.login", status: /test_mode_api_key/.test(result.stdout) ? GREEN : RED, detail: "CLI configured" }];
	},
	async import(ctx, name, cap) {
		const { data = [] } = await ctx.json("stripe", ["webhook_endpoints", "list", "--limit", "100"], { gate: LOGIN_GATE });
		const base = hookBase(ctx, cap);
		return webhooksOf(cap)
			.map(([key, path]) => [key, data.find((w) => w.url === `${base}${path}`)])
			.filter(([, w]) => w)
			.map(([key, w]) => ({ key: `stripe.webhook.${key}`, fields: { id: w.id, url: w.url } }));
	},
	async verify(ctx, name, cap) {
		const checks = [];
		const base = hookBase(ctx, cap);
		// An unsigned POST must be refused: proves the route is live and checks signatures.
		for (const [key, path] of webhooksOf(cap)) {
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
		const listed = await ctx
			.json("stripe", ["webhook_endpoints", "list", "--limit", "100"], { gate: LOGIN_GATE })
			.catch((error) => error);
		if (listed instanceof Blocked) {
			checks.push({ id: "stripe.login", status: "blocked", detail: listed.message, gate: listed.gate });
			return checks;
		}
		if (listed instanceof Error) throw listed;
		checks.push({ id: "stripe.login", status: GREEN, detail: "CLI signed in" });
		for (const [key, path] of webhooksOf(cap)) {
			const hook = listed.data.find((w) => w.url === `${base}${path}`);
			checks.push({
				id: `${name}.webhook.${key}`,
				status: hook?.status === "enabled" ? GREEN : RED,
				detail: hook ? `${hook.id} ${hook.status}, ${hook.enabled_events.length} events` : `no endpoint for ${base}${path}`,
			});
		}
		return checks;
	},
};
