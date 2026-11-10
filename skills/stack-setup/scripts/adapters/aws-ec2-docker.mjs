import { BLOCKED, Blocked, GREEN, RED, expandHome, firstLine } from "../lib/context.mjs";
import { publicUrl } from "../lib/schema.mjs";

const LOGIN_GATE = "aws.login";
const awsArgs = (cap, args) => [...args, "--profile", cap.profile, "--region", cap.region, "--output", "json"];

async function instance(ctx, cap) {
	return ctx.once(`aws.instance.${cap.name}`, async () => {
		const data = await ctx.json(
			"aws",
			awsArgs(cap, [
				"ec2",
				"describe-instances",
				"--filters",
				`Name=tag:Name,Values=${cap.name}`,
				"Name=instance-state-name,Values=pending,running,stopping,stopped",
			]),
			{ gate: LOGIN_GATE },
		);
		const found = data.Reservations.flatMap((r) => r.Instances);
		if (found.length > 1) throw new Error(`${found.length} instances are tagged Name=${cap.name}; expected one`);
		return found[0] ?? null;
	});
}

// Runs one fixed command on the host. Callers pass only literal text or
// names already checked by the schema, never secret values.
export async function hostShell(ctx, capName, remote, { input } = {}) {
	const cap = ctx.stack.capabilities[capName];
	// The recorded or declared address keeps SSH checks working while the AWS login has lapsed.
	const host =
		ctx.state.resources[`aws.address.${cap.name}`]?.ip ?? cap.ssh.host ?? (await instance(ctx, cap))?.PublicIpAddress;
	if (!host) throw new Blocked(`no address known for ${capName}; run stack import`);
	const result = await ctx.run("ssh", [
		"-F",
		"/dev/null",
		"-i",
		expandHome(cap.ssh.key),
		"-o",
		"BatchMode=yes",
		"-o",
		"ConnectTimeout=10",
		"-o",
		"StrictHostKeyChecking=accept-new",
		`${cap.ssh.user}@${host}`,
		remote,
	], { input });
	if (result.missing) throw new Blocked("ssh is not installed");
	if (result.code === 255) throw new Blocked(`ssh to ${capName} failed: ${firstLine(result.stderr)}`);
	return result;
}

export async function containers(ctx, capName) {
	return ctx.once(`host.containers.${capName}`, async () => {
		const result = await hostShell(ctx, capName, "docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'");
		if (result.code !== 0) throw new Error(`docker ps failed on ${capName}: ${firstLine(result.stderr)}`);
		return result.stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [name, image, status] = line.split("\t");
				return { name, image, status };
			});
	});
}

// What only the AWS API can tell: instance, address and firewall.
async function awsChecks(ctx, name, cap) {
	const checks = [{ id: "aws.login", status: GREEN, detail: `profile ${cap.profile}` }];
	const found = await instance(ctx, cap);
	if (!found) return [...checks, { id: `${name}.instance`, status: RED, detail: `no instance tagged ${cap.name} in ${cap.region}` }];
	const state = found.State.Name;
	const sizeOk = !cap.size || found.InstanceType === cap.size;
	checks.push({
		id: `${name}.instance`,
		status: state === "running" && sizeOk ? GREEN : RED,
		detail: `${found.InstanceId} ${found.InstanceType} ${state}${sizeOk ? "" : `, expected ${cap.size}`}`,
	});
	const addresses = await ctx.json(
		"aws",
		awsArgs(cap, ["ec2", "describe-addresses", "--filters", `Name=instance-id,Values=${found.InstanceId}`]),
		{ gate: LOGIN_GATE },
	);
	const eip = addresses.Addresses[0];
	checks.push({
		id: `${name}.address`,
		status: eip ? GREEN : RED,
		detail: eip ? `Elastic IP ${eip.PublicIp}` : "no Elastic IP; the address changes on restart",
	});
	const groups = await ctx.json(
		"aws",
		awsArgs(cap, ["ec2", "describe-security-groups", "--group-ids", ...found.SecurityGroups.map((g) => g.GroupId)]),
		{ gate: LOGIN_GATE },
	);
	const open = [
		...new Set(
			groups.SecurityGroups.flatMap((g) => g.IpPermissions)
				.filter((p) => (p.IpRanges ?? []).some((r) => r.CidrIp === "0.0.0.0/0") || (p.Ipv6Ranges ?? []).length)
				.map((p) => (p.IpProtocol === "-1" ? "all" : p.FromPort === p.ToPort ? String(p.FromPort) : `${p.FromPort}-${p.ToPort}`)),
		),
	].sort();
	const allowed = cap.ingress === "cloudflare-tunnel" ? ["22"] : ["22", "443", "80"];
	const extra = open.filter((p) => !allowed.includes(p));
	checks.push({
		id: `${name}.firewall`,
		status: extra.length ? RED : GREEN,
		detail: `open to the internet: ${open.join(", ") || "nothing"}${extra.length ? `; not expected: ${extra.join(", ")}` : ""}`,
	});
	return checks;
}

export default {
	provider: "aws-ec2-docker",
	tools: [{ cmd: "aws", args: ["--version"] }, { cmd: "ssh", args: ["-V"] }],
	validate(cap) {
		const errors = [];
		for (const key of ["profile", "region", "name"])
			if (typeof cap[key] !== "string" || !/^[A-Za-z0-9_.-]+$/.test(cap[key])) errors.push(`${key} is required`);
		if (!cap.ssh?.user || !cap.ssh?.key) errors.push("ssh: { user, key } is required");
		if (cap.ssh?.host !== undefined && !/^[A-Za-z0-9.:-]+$/.test(cap.ssh.host)) errors.push("ssh.host: an IP address or hostname");
		if (cap.ingress === "cloudflare-tunnel" && !cap.tunnel) errors.push("tunnel: the Cloudflare Tunnel name");
		return errors;
	},
	gates(cap) {
		return [
			{
				id: LOGIN_GATE,
				bundle: "preflight",
				type: "consent",
				title: `Sign in to AWS for profile ${cap.profile}`,
				prefill: { command: `aws login --profile ${cap.profile}` },
				note: "AWS sign-ins last 12 hours, so this comes back.",
				closedBy: "aws.login",
			},
		];
	},
	async doctor(ctx, name, cap) {
		const who = await ctx.json("aws", awsArgs(cap, ["sts", "get-caller-identity"]), { gate: LOGIN_GATE });
		return [{ id: "aws.login", status: GREEN, detail: `signed in to account ${who.Account}` }];
	},
	async import(ctx, name, cap) {
		const found = await instance(ctx, cap);
		if (!found) return [];
		const out = [
			{
				key: `aws.instance.${cap.name}`,
				fields: {
					id: found.InstanceId,
					type: found.InstanceType,
					region: cap.region,
					securityGroups: found.SecurityGroups.map((g) => g.GroupId),
				},
			},
		];
		const addresses = await ctx.json(
			"aws",
			awsArgs(cap, ["ec2", "describe-addresses", "--filters", `Name=instance-id,Values=${found.InstanceId}`]),
			{ gate: LOGIN_GATE },
		);
		const eip = addresses.Addresses[0];
		if (eip) out.push({ key: `aws.address.${cap.name}`, fields: { id: eip.AllocationId, ip: eip.PublicIp } });
		return out;
	},
	async verify(ctx, name, cap) {
		const checks = [...(await awsChecks(ctx, name, cap).catch((error) => {
			if (!(error instanceof Blocked)) throw error;
			return [{ id: "aws.login", status: BLOCKED, detail: error.message, gate: error.gate }];
		}))];
		const url = publicUrl(ctx.stack, name);
		if (url && cap.health) {
			try {
				const response = await ctx.fetch(`${url}${cap.health}`, { redirect: "manual" });
				const body = await response.text();
				checks.push({
					id: `${name}.health`,
					status: response.status === 200 ? GREEN : RED,
					detail: `${url}${cap.health} → ${response.status}${/"ok"/.test(body) ? " ok" : ""}`,
				});
			} catch (error) {
				checks.push({ id: `${name}.health`, status: RED, detail: `${url}${cap.health}: ${error.message}` });
			}
		}
		const list = await containers(ctx, name);
		checks.push({ id: `${name}.ssh`, status: GREEN, detail: `${list.length} containers running` });
		if (cap.ingress === "cloudflare-tunnel") {
			const result = await hostShell(ctx, name, "systemctl is-active cloudflared");
			checks.push({
				id: `${name}.connector`,
				status: result.stdout.trim() === "active" ? GREEN : RED,
				detail: `cloudflared service ${result.stdout.trim() || "missing"}`,
			});
		}
		return checks;
	},
};
