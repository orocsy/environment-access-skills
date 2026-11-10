// A recorded, synthetic provider world for docs/stack-setup/example.stack.yaml.
// Every ID is made up. Nothing here reaches a real provider.

export const FAKE_TOKEN = "cf-synthetic-token-not-real";
// Shaped like a real key so tests can prove it never reaches output or state.
export const FAKE_SECRET = "sk_test_SYNTHETICsyntheticSYNTHETIC0000";

const json = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const envText = (env) => Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join("");
const parseEnv = (text) => Object.fromEntries(text.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

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
		// Changeable state for plan/apply/teardown.
		resend: {
			domains: [{ id: "dom-synthetic", name: "mail.example.com", region: "ap-northeast-1", fixed: true }],
			keys: [{ id: "key-synthetic", name: "Example send-only", last_used_at: "2026-11-08 00:00:00" }],
			propagates: true,
			next: 1,
		},
		records: [],
		recordSeq: 1,
		secretValues: {},
		sshDown: false,
		failGhSet: false,
		vercelEnvs: {},
		iam: { users: {}, policies: {}, keys: [], seq: 1, mfa: 1 },
		ec2: { instances: [], addresses: [], groups: [], keyPairs: [], seq: 1, sshReady: true },
		stripeEndpoints: [
			{ id: "we_connect", url: "https://api.example.com/webhooks/stripe/connect", status: "enabled", enabled_events: ["a", "b"], secret: FAKE_SECRET },
			{ id: "we_billing", url: "https://api.example.com/webhooks/stripe/billing", status: "enabled", enabled_events: ["c"] },
		],
		bootstrapRuns: [],
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
			const profile = args[args.indexOf("--profile") + 1];
			const creds = world.files["~/.aws/credentials"] ?? "";
			const agentOk = world.iam.keys.some((k) => creds.includes(`aws_access_key_id = ${k.id}`) && k.active);
			const signedIn = profile === "example-agent" ? agentOk : world.awsLoggedIn;
			if (!signedIn) return { code: 255, stdout: "", stderr: "Your session has expired. Please reauthenticate using 'aws login'." };
			const iam = world.iam;
			const opt = (f) => args[args.indexOf(f) + 1];
			if (line.startsWith("sts get-caller-identity")) return json({ Account: "000000000000" });
			if (line.startsWith("iam get-account-summary")) return json({ SummaryMap: { AccountMFAEnabled: iam.mfa } });
			if (line.startsWith("iam get-user ")) return iam.users[opt("--user-name")] ? json({ User: iam.users[opt("--user-name")] }) : { code: 254, stdout: "", stderr: "NoSuchEntity" };
			if (line.startsWith("iam create-user")) {
				const user = { UserName: opt("--user-name"), Arn: `arn:aws:iam::000000000000:user/${opt("--user-name")}` };
				iam.users[user.UserName] = user;
				return json({ User: user });
			}
			iam.managed ??= {};
			iam.attached ??= {};
			if (line.startsWith("iam get-policy ")) {
				const m = iam.managed[opt("--policy-arn")];
				return m ? json({ Policy: { Arn: opt("--policy-arn"), DefaultVersionId: `v${m.versions.length}` } }) : { code: 254, stdout: "", stderr: "NoSuchEntity" };
			}
			if (line.startsWith("iam get-policy-version")) {
				const m = iam.managed[opt("--policy-arn")];
				return json({ PolicyVersion: { Document: encodeURIComponent(JSON.stringify(m.versions[Number(opt("--version-id").slice(1)) - 1])) } });
			}
			if (line.startsWith("iam create-policy ")) {
				const arn = `arn:aws:iam::000000000000:policy/${opt("--policy-name")}`;
				iam.managed[arn] = { versions: [JSON.parse(opt("--policy-document"))] };
				return json({ Policy: { Arn: arn } });
			}
			if (line.startsWith("iam create-policy-version")) {
				iam.managed[opt("--policy-arn")].versions.push(JSON.parse(opt("--policy-document")));
				return ok("{}");
			}
			if (line.startsWith("iam list-policy-versions")) {
				const m = iam.managed[opt("--policy-arn")];
				return json({ Versions: m.versions.map((_, i) => ({ VersionId: `v${i + 1}`, IsDefaultVersion: i === m.versions.length - 1, CreateDate: `2026-11-0${i + 1}T00:00:00Z` })) });
			}
			if (line.startsWith("iam delete-policy-version")) return ok();
			if (line.startsWith("iam delete-policy ")) {
				delete iam.managed[opt("--policy-arn")];
				return ok();
			}
			if (line.startsWith("iam attach-user-policy")) {
				(iam.attached[opt("--user-name")] ??= []).push(opt("--policy-arn"));
				return ok();
			}
			if (line.startsWith("iam detach-user-policy")) {
				iam.attached[opt("--user-name")] = (iam.attached[opt("--user-name")] ?? []).filter((a) => a !== opt("--policy-arn"));
				return ok();
			}
			if (line.startsWith("iam list-attached-user-policies")) return json({ AttachedPolicies: (iam.attached[opt("--user-name")] ?? []).map((PolicyArn) => ({ PolicyArn })) });
			if (line.startsWith("iam delete-user ") && (iam.attached[opt("--user-name")] ?? []).length) return { code: 254, stdout: "", stderr: "DeleteConflict: must detach all policies first" };
			if (line.startsWith("iam get-user-policy"))
				return iam.policies[opt("--user-name")] ? json({ PolicyDocument: iam.policies[opt("--user-name")] }) : { code: 254, stdout: "", stderr: "NoSuchEntity" };
			if (line.startsWith("iam put-user-policy")) {
				iam.policies[opt("--user-name")] = JSON.parse(opt("--policy-document"));
				return ok();
			}
			if (line.startsWith("iam delete-user-policy")) {
				delete iam.policies[opt("--user-name")];
				return ok();
			}
			if (line.startsWith("iam delete-user")) {
				delete iam.users[opt("--user-name")];
				return ok();
			}
			if (line.startsWith("iam create-access-key")) {
				const n = iam.seq++;
				const key = { id: `AKIASYNTHETIC${String(n).padStart(7, "0")}`, secret: `synthetic/secret/${n}/SYNTHETICsyntheticSYNTH`, active: true, user: opt("--user-name") };
				iam.keys.push(key);
				return json({ AccessKey: { AccessKeyId: key.id, SecretAccessKey: key.secret, UserName: key.user } });
			}
			if (line.startsWith("iam list-access-keys")) return json({ AccessKeyMetadata: iam.keys.filter((k) => k.active).map((k) => ({ AccessKeyId: k.id })) });
			if (line.startsWith("iam delete-access-key")) {
				iam.keys = iam.keys.filter((k) => k.id !== opt("--access-key-id"));
				return ok();
			}
			const ec2 = world.ec2;
			if (line.startsWith("ssm get-parameter")) return json({ Parameter: { Value: "ami-0synthetic" } });
			if (line.startsWith("ec2 import-key-pair")) {
				ec2.keyPairs.push(opt("--key-name"));
				return json({ KeyName: opt("--key-name") });
			}
			if (line.startsWith("ec2 create-security-group")) {
				const g = { GroupId: `sg-new${ec2.seq++}`, ports: [] };
				ec2.groups.push(g);
				return json({ GroupId: g.GroupId });
			}
			if (line.startsWith("ec2 authorize-security-group-ingress")) {
				ec2.groups.find((g) => g.GroupId === opt("--group-id")).ports.push(Number(opt("--port")));
				return ok();
			}
			if (line.startsWith("ec2 run-instances")) {
				const i = { InstanceId: `i-new${ec2.seq++}`, type: opt("--instance-type"), image: opt("--image-id"), group: opt("--security-group-ids"), state: "running", args };
				ec2.instances.push(i);
				return json({ Instances: [{ InstanceId: i.InstanceId }] });
			}
			if (line.startsWith("ec2 wait")) return ok();
			if (line.startsWith("ec2 allocate-address")) {
				const a = { AllocationId: `eipalloc-new${ec2.seq++}`, PublicIp: "203.0.113.99" };
				ec2.addresses.push(a);
				return json(a);
			}
			if (line.startsWith("ec2 associate-address")) {
				Object.assign(ec2.addresses.find((a) => a.AllocationId === opt("--allocation-id")), { InstanceId: opt("--instance-id"), AssociationId: "eipassoc-1" });
				return ok();
			}
			if (line.startsWith("ec2 disassociate-address")) {
				for (const a of ec2.addresses) if (a.AssociationId === opt("--association-id")) delete a.AssociationId;
				return ok();
			}
			if (line.startsWith("ec2 release-address")) {
				ec2.addresses = ec2.addresses.filter((a) => a.AllocationId !== opt("--allocation-id"));
				return ok();
			}
			if (line.startsWith("ec2 terminate-instances")) {
				ec2.instances = ec2.instances.filter((i) => i.InstanceId !== opt("--instance-ids"));
				return ok();
			}
			if (line.startsWith("ec2 delete-security-group")) {
				ec2.groups = ec2.groups.filter((g) => g.GroupId !== opt("--group-id"));
				return ok();
			}
			if (line.startsWith("ec2 delete-key-pair")) {
				ec2.keyPairs = ec2.keyPairs.filter((k) => k !== opt("--key-name"));
				return ok();
			}
			if (line.startsWith("ec2 describe-addresses --allocation-ids")) return json({ Addresses: ec2.addresses.filter((a) => a.AllocationId === opt("--allocation-ids")) });
			if (line.startsWith("ec2 describe-instances") && world.noInstance)
				return json({ Reservations: ec2.instances.length ? [{ Instances: ec2.instances.map((i) => ({ InstanceId: i.InstanceId, InstanceType: i.type, State: { Name: i.state }, PublicIpAddress: "203.0.113.99", SecurityGroups: [{ GroupId: i.group }] })) }] : [] });
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
			if (world.sshDown || (world.noInstance && !world.ec2.sshReady)) return { code: 255, stdout: "", stderr: "ssh: connect to host 203.0.113.10 port 22: Operation timed out" };
			if (remote === "true") return ok();
			if (remote.startsWith("umask 077 && cat > ~/.stack-bootstrap.env")) {
				world.bootstrapEnv = opts.input;
				return ok();
			}
			if (remote.startsWith("set -a; . ~/.stack-bootstrap.env")) {
				world.bootstrapRuns.push({ script: opts.input, env: world.bootstrapEnv, host: args.at(-2) });
				return ok("bootstrapped\n");
			}
			if (remote === world.reloadCommand) {
				world.reloads = (world.reloads ?? 0) + 1;
				return ok();
			}
			if (remote.startsWith("umask 077 && cat > ")) {
				world.hostEnv = parseEnv(opts.input);
				world.hostWrites = (world.hostWrites ?? 0) + 1;
				return ok();
			}
			if (remote.startsWith("cat ")) return ok(envText(world.hostEnv));
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
			const project = /\/projects\/(?:prj_)?([^/?]+)/.exec(path)?.[1];
			const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
			const envs = (world.vercelEnvs[project] ??= [
				{ id: "env-1", key: "API_URL", type: "sensitive", target: ["production"], value: FAKE_SECRET },
				{ id: "env-2", key: "NEXT_PUBLIC_API_URL", type: "encrypted", target: ["production", "preview"], value: "https://api.example.com" },
			]);
			const envId = /\/env\/([^/?]+)/.exec(path)?.[1];
			if (path.includes("/env") && method !== "GET") {
				world.vercelWrites = (world.vercelWrites ?? 0) + 1;
				const body = JSON.parse(opts.input ?? "{}");
				if (method === "POST") {
					const made = { id: `env-${envs.length + 1}`, ...body };
					envs.push(made);
					return json({ created: made });
				}
				const index = envs.findIndex((e) => e.id === envId);
				if (method === "PATCH") Object.assign(envs[index], body);
				if (method === "DELETE") envs.splice(index, 1);
				return json({});
			}
			if (envId) return json(envs.find((e) => e.id === envId));
			if (path.includes("/domains"))
				return json({
					domains: [
						{ name: "example.com", verified: true },
						{ name: "www.example.com", verified: true, redirect: "example.com" },
					],
				});
			if (path.includes("/env")) return json({ envs: envs.map(({ value, ...e }) => (e.type === "sensitive" ? e : { ...e, value })) });
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
			if (args[0] === "secret") {
				const name = args[2];
				if (args[1] === "set") {
					if (world.failGhSet) return { code: 1, stdout: "", stderr: "HTTP 403: Resource not accessible" };
					world.secretValues[name] = opts.input;
					if (!world.secrets.includes(name)) world.secrets.push(name);
				} else {
					delete world.secretValues[name];
					world.secrets = world.secrets.filter((n) => n !== name);
				}
				return ok();
			}
			const path = args[1];
			if (path.includes("/actions/secrets")) return json({ secrets: world.secrets.map((name) => ({ name })) });
			if (path.includes("/runs"))
				return json({ workflow_runs: [{ conclusion: world.deployConclusion, updated_at: "2026-11-08T10:00:00Z" }] });
			return json({ id: 1, full_name: "owner/example-app", default_branch: "main", private: true });
		}
		if (cmd === "resend") {
			const r = world.resend;
			if (args[0] === "--version") return { code: 0, stdout: "resend-cli v2.28.0\n", stderr: "" };
			const flag = (f) => args[args.indexOf(f) + 1];
			if (line.startsWith("domains list")) return json({ data: r.domains.map(({ id, name }) => ({ id, name })) });
			if (line.startsWith("domains create")) {
				const name = flag("--name");
				const sub = name.split(".")[0];
				const domain = {
					id: `dom-new-${r.next++}`,
					name,
					region: flag("--region"),
					records: [
						{ record: "DKIM", type: "TXT", name: `resend._domainkey.${sub}`, value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCsynthetic" },
						{ record: "SPF", type: "MX", name: `send.${sub}`, value: "feedback-smtp.ap-northeast-1.amazonses.com", priority: 10 },
						{ record: "SPF", type: "TXT", name: `send.${sub}`, value: '"v=spf1 include:amazonses.com ~all"' },
					],
				};
				r.domains.push(domain);
				return json({ id: domain.id, name, region: domain.region, records: domain.records });
			}
			const domain = r.domains.find((d) => d.id === args[2]);
			if (line.startsWith("domains verify")) {
				domain.verifyRequested = true;
				return json({ object: "domain", id: domain.id });
			}
			if (line.startsWith("domains delete")) {
				r.domains = r.domains.filter((d) => d !== domain);
				return json({ deleted: true });
			}
			if (line.startsWith("domains get")) {
				if (domain.fixed)
					return json({
						id: domain.id,
						name: domain.name,
						status: world.resendRecords.every((s) => s === "verified") ? "verified" : "pending",
						region: domain.region,
						capabilities: { sending: "enabled" },
						records: world.resendRecords.map((status, i) => ({ type: ["TXT", "MX", "TXT"][i], name: `r${i}.mail`, status, value: FAKE_SECRET })),
					});
				const inDns = (rec) => world.records.some((d) => d.type === rec.type && d.name === `${rec.name}.example.com` && d.content === rec.value);
				const records = domain.records.map((rec) => ({ ...rec, status: domain.verifyRequested && r.propagates && inDns(rec) ? "verified" : "pending" }));
				return json({
					id: domain.id,
					name: domain.name,
					region: domain.region,
					status: records.every((x) => x.status === "verified") ? "verified" : domain.verifyRequested ? "pending" : "not_started",
					capabilities: { sending: "enabled" },
					records,
				});
			}
			if (line.startsWith("api-keys list")) return json({ data: r.keys.map(({ token, ...k }) => k) });
			if (line.startsWith("api-keys create")) {
				const n = r.next++;
				const key = { id: `key-new-${n}`, name: flag("--name"), domain: flag("--domain-id"), token: `re_SYNTHkey${n}_SYNTHETICvalue${n}` };
				r.keys.push(key);
				return json({ id: key.id, token: key.token });
			}
			if (line.startsWith("api-keys delete")) {
				r.keys = r.keys.filter((k) => k.id !== args[2]);
				return json({ deleted: true });
			}
		}
		if (cmd === "stripe") {
			if (!world.stripeInstalled) return { code: 127, missing: true, stdout: "", stderr: "" };
			if (args[0] === "--version") return { code: 0, stdout: "stripe version 1.40.0\n", stderr: "" };
			if (args[0] === "config") return { code: 0, stdout: "test_mode_api_key = 'rk_test_***'\n", stderr: "" };
			if (line.startsWith("webhook_endpoints list")) return json({ data: world.stripeEndpoints.map(({ secret, ...w }) => w) });
			const d = (key) => args.flatMap((a, i) => (args[i - 1] === "-d" && a.startsWith(`${key}=`) ? [a.slice(key.length + 1)] : []));
			if (line.startsWith("webhook_endpoints create")) {
				const w = { id: `we_new${world.stripeEndpoints.length + 1}`, url: d("url")[0], status: "enabled", enabled_events: d("enabled_events[]"), connect: d("connect")[0] === "true", secret: `whsec_SYNTHETICnew${world.stripeEndpoints.length + 1}secret` };
				world.stripeEndpoints.push(w);
				return json(w);
			}
			if (line.startsWith("webhook_endpoints update")) {
				Object.assign(world.stripeEndpoints.find((w) => w.id === args[2]), { enabled_events: d("enabled_events[]") });
				return json({});
			}
			if (line.startsWith("webhook_endpoints delete")) {
				world.stripeEndpoints = world.stripeEndpoints.filter((w) => w.id !== args[2]);
				return json({ deleted: true });
			}
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
			if (path.endsWith("/token")) return response(200, { success: true, result: "TUNNELsyntheticTOKENnotreal" });
			if (path.includes("/cfd_tunnel/"))
				return response(200, { success: true, result: { id: "tunnel-synthetic", name: "example-api", status: world.tunnelStatus, connections: [{}, {}] } });
			const all = () => [...(world.cname ? [{ id: "rec-api", type: "CNAME", name: "api.example.com", ...world.cname }] : []), ...world.records];
			if (path.endsWith("/dns_records") && (init.method ?? "GET") === "GET")
				return response(200, {
					success: true,
					result: all().filter((r) => (!u.searchParams.get("type") || r.type === u.searchParams.get("type")) && (!u.searchParams.get("name") || r.name === u.searchParams.get("name"))),
				});
			if (path.endsWith("/dns_records") && init.method === "POST") {
				const made = { id: `rec-${world.recordSeq++}`, ...JSON.parse(init.body) };
				world.records.push(made);
				return response(200, { success: true, result: made });
			}
			if (path.includes("/dns_records/") && init.method === "DELETE") {
				const id = path.split("/").pop();
				world.records = world.records.filter((r) => r.id !== id);
				return response(200, { success: true, result: { id } });
			}
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
		writeSecretFile: async (path, text) => {
			world.files[path] = text;
			world.fileModes = { ...world.fileModes, [path]: 0o600 };
		},
		moveToTrash: async (path) => {
			world.trashed = [...(world.trashed ?? []), path];
			delete world.files[path];
		},
		sleep: async () => {},
		now: () => new Date(now),
	};
}
