import { GREEN, RED } from "../lib/context.mjs";
import { publicUrl } from "../lib/schema.mjs";

// Google has no API for "Sign in with Google" clients, so this adapter only
// checks from outside and turns the console work into pre-filled gates.
export default {
	provider: "google-oauth",
	tools: [],
	validate(cap) {
		const errors = [];
		if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(cap.project ?? "")) errors.push("project: the Google Cloud project ID");
		if (cap.client_id !== undefined && !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(cap.client_id))
			errors.push("client_id: …apps.googleusercontent.com");
		if (cap.probe !== undefined && !String(cap.probe).startsWith("/")) errors.push("probe: a path on the API that redirects to Google");
		return errors;
	},
	gates(cap, stack, name) {
		const api = publicUrl(stack, cap.on ?? "api_host");
		const base = "https://console.cloud.google.com/auth";
		return [
			{
				id: "google.consent-screen",
				bundle: "app",
				type: "terms",
				title: "Set up the Google consent screen and accept Google's user data policy",
				link: `${base}/branding?project=${cap.project}`,
				prefill: { audience: "External", authorisedDomain: stack.domain },
			},
			{
				id: "google.client",
				bundle: "app",
				type: "console",
				title: "Create the web sign-in client",
				link: `${base}/clients/create?project=${cap.project}`,
				prefill: {
					type: "Web application",
					redirects: (cap.redirects ?? []).map((path) => (path.startsWith("/") ? `${api}${path}` : path)),
				},
				receive: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
				closedBy: `${name}.redirect`,
			},
			{
				id: "google.publish",
				bundle: "go-live",
				type: "console",
				title: "Publish the sign-in app so anyone can sign in",
				link: `${base}/audience?project=${cap.project}`,
				note: "Needs a live home page, privacy policy and terms on the authorised domain.",
			},
		];
	},
	async verify(ctx, name, cap) {
		if (!cap.probe) return [];
		const url = `${publicUrl(ctx.stack, cap.on ?? "api_host")}${cap.probe}`;
		const response = await ctx.fetch(url, { redirect: "manual" });
		const location = response.headers.get("location") ?? "";
		let target;
		try {
			target = new URL(location);
		} catch {
			return [{ id: `${name}.redirect`, status: RED, detail: `${cap.probe} → ${response.status}, no redirect to Google` }];
		}
		const client = target.searchParams.get("client_id");
		const ok =
			[302, 303].includes(response.status) &&
			target.hostname === "accounts.google.com" &&
			(!cap.client_id || client === cap.client_id);
		return [
			{
				id: `${name}.redirect`,
				status: ok ? GREEN : RED,
				detail: `${cap.probe} → ${response.status} ${target.hostname}${cap.client_id && client !== cap.client_id ? ", unexpected client" : ", expected client"}; returns to ${target.searchParams.get("redirect_uri") ?? "?"}`,
			},
		];
	},
};
