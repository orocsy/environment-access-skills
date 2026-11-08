// A recorded, synthetic provider world for docs/stack-setup/example.stack.yaml.
// Every ID is made up. Nothing here reaches a real provider.

export const FAKE_TOKEN = "cf-synthetic-token-not-real";
// Shaped like a real key so tests can prove it never reaches output or state.
export const FAKE_SECRET = "sk_test_SYNTHETICsyntheticSYNTHETIC0000";

const json = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

export function healthyWorld() {
	return {
		files: { "~/.config/example-app/cloudflare.env": `CLOUDFLARE_API_TOKEN=${FAKE_TOKEN}\n` },
		hostEnv: {
			API_PUBLIC_URL: "https://api.example.com",
			RESEND_API_KEY: FAKE_SECRET,
			EMAIL_FROM: "Example <no-reply@mail.example.com>",
			STRIPE_SECRET_KEY: FAKE_SECRET,
			STRIPE_CONNECT_CLIENT_ID: "ca_synthetic",
			STRIPE_CONNECT_WEBHOOK_SECRET: FAKE_SECRET,
			STRIPE_BILLING_WEBHOOK_SECRET: FAKE_SECRET,
			GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
			GOOGLE_CLIENT_SECRET: FAKE_SECRET,
		},
		awsLoggedIn: true,
		instanceState: "running",
		openPorts: [22],
		containers: [
			"example-postgres-1\tpostgres:16-alpine\tUp 3 days (healthy)",
			"example-redis-1\tredis:7-alpine\tUp 3 days (healthy)",
			"example-api-1\tghcr.io/owner/example-app/api:sha-abc1234\tUp 2 hours (healthy)",
		],
		cloudflared: "active",
		tunnelStatus: "healthy",
		cname: { content: "tunnel-synthetic.cfargotunnel.com", proxied: true },
		resendRecords: ["verified", "verified", "verified"],
		stripeInstalled: true,
		secrets: ["APP_ENV", "DEPLOY_HOST", "DEPLOY_SSH_KEY"],
		deployConclusion: "success",
		calls: [],
	};
}

export function fakeRun(world) {
	return async (cmd, args, opts = {}) => {
		world.calls.push([cmd, ...args]);
		const line = args.join(" ");
		if (cmd === "node") return { code: 0, stdout: "v22.13.0\n", stderr: "" };
		if (cmd === "aws") {
			if (args[0] === "--version") return { code: 0, stdout: "aws-cli/2.39.4\n", stderr: "" };
			if (!world.awsLoggedIn) return { code: 255, stdout: "", stderr: "Your session has expired. Please reauthenticate using 'aws login'." };
			if (line.startsWith("sts get-caller-identity")) return json({ Account: "000000000000" });
			if (line.startsWith("ec2 describe-instances"))
				return json({
					Reservations: [
						{
							Instances: [
								{
									InstanceId: "i-0synthetic",
									InstanceType: "t3.micro",
									State: { Name: world.instanceState },
									PublicIpAddress: "203.0.113.10",
									SecurityGroups: [{ GroupId: "sg-0synthetic" }],
								},
							],
						},
					],
				});
			if (line.startsWith("ec2 describe-addresses"))
				return json({ Addresses: [{ AllocationId: "eipalloc-0synthetic", PublicIp: "203.0.113.10" }] });
			if (line.startsWith("ec2 describe-security-groups"))
				return json({
					SecurityGroups: [
						{ IpPermissions: world.openPorts.map((p) => ({ IpProtocol: "tcp", FromPort: p, ToPort: p, IpRanges: [{ CidrIp: "0.0.0.0/0" }] })) },
					],
				});
		}
		if (cmd === "ssh") {
			if (args[0] === "-V") return { code: 0, stdout: "", stderr: "OpenSSH_9.9\n" };
			const remote = args.at(-1);
			if (remote.startsWith("docker ps")) return { code: 0, stdout: `${world.containers.join("\n")}\n`, stderr: "" };
			if (remote === "systemctl is-active cloudflared") return { code: 0, stdout: `${world.cloudflared}\n`, stderr: "" };
			if (remote.startsWith("grep -oE")) return { code: 0, stdout: Object.keys(world.hostEnv).map((k) => `${k}=\n`).join(""), stderr: "" };
			const one = /^grep -E '\^([A-Z0-9_]+)='/.exec(remote);
			if (one) {
				const value = world.hostEnv[one[1]];
				return value === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: `${one[1]}=${value}\n`, stderr: "" };
			}
		}
		if (cmd === "vercel") {
			if (args[0] === "--version") return { code: 0, stdout: "Vercel CLI 65.11.0\n", stderr: "" };
			if (args[0] === "whoami") return { code: 0, stdout: "example-user\n", stderr: "" };
			const path = args[1];
			const project = /\/projects\/([^/?]+)/.exec(path)?.[1];
			if (path.includes("/domains"))
				return json({
					domains: [
						{ name: "example.com", verified: true },
						{ name: "www.example.com", verified: true, redirect: "example.com" },
					],
				});
			if (path.includes("/env"))
				return json({
					envs: [
						{ key: "API_URL", type: "sensitive", target: ["production"], value: FAKE_SECRET },
						{ key: "NEXT_PUBLIC_API_URL", type: "encrypted", target: ["production", "preview"] },
					],
				});
			return json({
				id: `prj_${project}`,
				name: project,
				accountId: "team_synthetic",
				link: { repo: "example-app" },
				targets: { production: { readyState: "READY" } },
			});
		}
		if (cmd === "gh") {
			if (args[0] === "--version") return { code: 0, stdout: "gh version 2.103.2\n", stderr: "" };
			if (args[0] === "auth") return { code: 0, stdout: "", stderr: "Logged in\n" };
			const path = args[1];
			if (path.includes("/actions/secrets")) return json({ secrets: world.secrets.map((name) => ({ name })) });
			if (path.includes("/runs"))
				return json({ workflow_runs: [{ conclusion: world.deployConclusion, updated_at: "2026-11-08T10:00:00Z" }] });
			return json({ id: 1, full_name: "owner/example-app", default_branch: "main", private: true });
		}
		if (cmd === "resend") {
			if (args[0] === "--version") return { code: 0, stdout: "resend-cli v2.28.0\n", stderr: "" };
			if (line.startsWith("domains list")) return json({ data: [{ id: "dom-synthetic", name: "mail.example.com" }] });
			if (line.startsWith("domains get"))
				return json({
					id: "dom-synthetic",
					name: "mail.example.com",
					status: world.resendRecords.every((s) => s === "verified") ? "verified" : "pending",
					region: "ap-northeast-1",
					capabilities: { sending: "enabled" },
					records: world.resendRecords.map((status, i) => ({ type: ["TXT", "MX", "TXT"][i], name: `r${i}.mail`, status, value: FAKE_SECRET })),
				});
			if (line.startsWith("api-keys list"))
				return json({ data: [{ id: "key-synthetic", name: "Example send-only", last_used_at: "2026-11-08 00:00:00" }] });
		}
		if (cmd === "stripe") {
			if (!world.stripeInstalled) return { code: 127, missing: true, stdout: "", stderr: "" };
			if (args[0] === "--version") return { code: 0, stdout: "stripe version 1.40.0\n", stderr: "" };
			if (args[0] === "config") return { code: 0, stdout: "test_mode_api_key = 'rk_test_***'\n", stderr: "" };
			if (line.startsWith("webhook_endpoints list"))
				return json({
					data: [
						{ id: "we_connect", url: "https://api.example.com/webhooks/stripe/connect", status: "enabled", enabled_events: ["a", "b"], secret: FAKE_SECRET },
						{ id: "we_billing", url: "https://api.example.com/webhooks/stripe/billing", status: "enabled", enabled_events: ["c"] },
					],
				});
		}
		if (cmd === "op") return { code: 127, missing: true, stdout: "", stderr: "" };
		throw new Error(`unexpected command in test: ${cmd} ${line}`);
	};
}

const response = (status, body, headers = {}) => ({
	ok: status >= 200 && status < 300,
	status,
	headers: new Headers(headers),
	json: async () => body,
	text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

export function fakeFetch(world) {
	return async (url, init = {}) => {
		world.calls.push(["fetch", init.method ?? "GET", url]);
		const u = new URL(url);
		if (u.hostname === "api.cloudflare.com") {
			if (init.headers?.authorization !== `Bearer ${FAKE_TOKEN}`) return response(403, { success: false });
			const path = u.pathname.replace("/client/v4", "");
			if (path === "/user/tokens/verify") return response(200, { success: true, result: { status: "active" } });
			if (path === "/zones")
				return response(200, {
					success: true,
					result: [{ id: "zone-synthetic", name: "example.com", status: "active", name_servers: ["a.ns.example", "b.ns.example"], account: { id: "acct-synthetic" } }],
				});
			if (path.endsWith("/cfd_tunnel"))
				return response(200, { success: true, result: [{ id: "tunnel-synthetic", name: "example-api", status: world.tunnelStatus, connections: [{}, {}] }] });
			if (path.endsWith("/configurations"))
				return response(200, {
					success: true,
					result: { config: { ingress: [{ hostname: "api.example.com", service: "http://localhost:3001" }, { service: "http_status:404" }] } },
				});
			if (path.includes("/cfd_tunnel/"))
				return response(200, { success: true, result: { id: "tunnel-synthetic", name: "example-api", status: world.tunnelStatus, connections: [{}, {}] } });
			if (path.endsWith("/dns_records"))
				return response(200, { success: true, result: world.cname ? [world.cname] : [] });
		}
		if (u.hostname === "api.example.com") {
			if (u.pathname === "/health") return response(200, '{"status":"ok"}');
			if (u.pathname.startsWith("/webhooks/stripe/")) return response(400, "bad signature");
			if (u.pathname === "/auth/google/authorize")
				return response(302, "", {
					location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=123-abc.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fapi.example.com%2Fauth%2Fgoogle%2Fcallback",
				});
		}
		throw new Error(`unexpected fetch in test: ${init.method ?? "GET"} ${url}`);
	};
}

export function overridesFor(world, now = "2026-11-09T00:00:00Z") {
	return {
		run: fakeRun(world),
		fetch: fakeFetch(world),
		readText: async (path) => {
			if (!(path in world.files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
			return world.files[path];
		},
		now: () => new Date(now),
	};
}
