// Builds a new API host when none exists: key pair, firewall, instance, fixed
// address, then the app's own bootstrap script over SSH. Steps that cost money
// say so, and apply refuses them without --accept-cost.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Blocked, firstLine } from "../lib/context.mjs";
import { recordCreated } from "../lib/state.mjs";
import { awsArgs, hostShell } from "./aws-ec2-docker.mjs";
import { TAG } from "./aws-agent.mjs";

const AMI_PARAM = {
	x86_64: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64",
	arm64: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
};
// Rough on-demand prices in Sydney; the owner confirms the real bill.
const MONTHLY = { "t3.micro": "about US$10", "t3.small": "about US$19", "t4g.small": "about US$15" };
const arch = (size) => (/^[a-z]+\dg/.test(size) ? "arm64" : "x86_64");

const tags = (ctx, cap, type) => `ResourceType=${type},Tags=[{Key=Name,Value=${cap.name}},{Key=${TAG},Value=${ctx.stack.app}}]`;

async function findInstance(ctx, cap) {
	const data = await ctx.json("aws", await awsArgs(ctx, cap, ["ec2", "describe-instances", "--filters", `Name=tag:Name,Values=${cap.name}`, "Name=instance-state-name,Values=pending,running,stopping,stopped"]), { gate: "aws.login" });
	return data.Reservations.flatMap((r) => r.Instances)[0] ?? null;
}

async function waitFor(ctx, what, test, { tries = 40, ms = 15000 } = {}) {
	for (let i = 0; i < tries; i++) {
		if (await test()) return;
		await ctx.sleep(ms);
	}
	throw new Error(`gave up waiting for ${what}`);
}

export async function hostSteps(ctx, name, cap) {
	if (await findInstance(ctx, cap)) return [{ id: `${name}.host`, kind: "noop", summary: `instance ${cap.name} exists` }];
	const size = cap.size ?? "t3.micro";
	const script = resolve(ctx.repoRoot ?? process.cwd(), cap.bootstrap);
	const call = async (args) => ctx.call("aws", await awsArgs(ctx, cap, args));
	const created = (suffix) => Object.entries(ctx.state.resources).find(([k, r]) => k.startsWith(`aws.host.${suffix}.`) && r.host === cap.name)?.[1];
	const step = (id, summary, run, extra = {}) => ({ id: `${name}.host.${id}`, kind: "create", summary, run, ...extra });
	return [
		step("key", `key pair ${cap.name} from ${cap.ssh.key}.pub`, async () => {
			const pub = await ctx.readText(`${cap.ssh.key}.pub`);
			await call(["ec2", "import-key-pair", "--key-name", cap.name, "--public-key-material", Buffer.from(pub.trim()).toString("base64"), "--tag-specifications", tags(ctx, cap, "key-pair")]);
			recordCreated(ctx, `aws.host.keypair.${cap.name}`, "aws-ec2-docker", { name: cap.name, host: cap.name });
		}),
		step("firewall", `security group ${cap.name}: SSH only${cap.ingress === "cloudflare-tunnel" ? " (web traffic comes through the tunnel)" : ", plus 80 and 443"}`, async () => {
			const made = await call(["ec2", "create-security-group", "--group-name", cap.name, "--description", `${ctx.stack.app} API host (stack-setup)`, "--tag-specifications", tags(ctx, cap, "security-group")]);
			recordCreated(ctx, `aws.host.sg.${made.GroupId}`, "aws-ec2-docker", { id: made.GroupId, name: cap.name, host: cap.name });
			for (const port of cap.ingress === "cloudflare-tunnel" ? [22] : [22, 80, 443])
				await call(["ec2", "authorize-security-group-ingress", "--group-id", made.GroupId, "--protocol", "tcp", "--port", String(port), "--cidr", "0.0.0.0/0"]);
		}),
		step(
			"instance",
			`${size} instance ${cap.name} (Amazon Linux 2023, 20 GB encrypted disk, IMDSv2 only, no CPU-credit surcharges)`,
			async () => {
				const { Parameter } = await call(["ssm", "get-parameter", "--name", AMI_PARAM[arch(size)]]);
				const sg = created("sg");
				const made = await call([
					"ec2",
					"run-instances",
					"--image-id",
					Parameter.Value,
					"--instance-type",
					size,
					"--key-name",
					cap.name,
					"--security-group-ids",
					sg.id,
					"--metadata-options",
					"HttpTokens=required,HttpEndpoint=enabled",
					...(size.startsWith("t") ? ["--credit-specification", "CpuCredits=standard"] : []),
					"--block-device-mappings",
					"DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}",
					"--tag-specifications",
					tags(ctx, cap, "instance"),
					tags(ctx, cap, "volume"),
				]);
				const id = made.Instances[0].InstanceId;
				recordCreated(ctx, `aws.host.instance.${id}`, "aws-ec2-docker", { id, name: cap.name, host: cap.name });
				await call(["ec2", "wait", "instance-running", "--instance-ids", id]);
			},
			{ cost: `${MONTHLY[size] ?? "check the AWS price"} a month for ${size}, plus the disk` },
		),
		step(
			"address",
			"Elastic IP, attached to the instance",
			async () => {
				const made = await call(["ec2", "allocate-address", "--domain", "vpc", "--tag-specifications", tags(ctx, cap, "elastic-ip")]);
				recordCreated(ctx, `aws.host.address.${made.AllocationId}`, "aws-ec2-docker", { id: made.AllocationId, ip: made.PublicIp, name: made.PublicIp, host: cap.name });
				await call(["ec2", "associate-address", "--allocation-id", made.AllocationId, "--instance-id", created("instance").id]);
				ctx.state.resources[`aws.address.${cap.name}`] = { id: made.AllocationId, ip: made.PublicIp, firstSeen: ctx.now().toISOString(), lastSeen: ctx.now().toISOString() };
			},
			{ cost: "about US$3.65 a month for the public IPv4 address" },
		),
		step("bootstrap", `wait for SSH, then run ${cap.bootstrap} on the host${cap.ingress === "cloudflare-tunnel" ? ` with tunnel ${cap.tunnel}'s token on stdin` : ""}`, async () => {
			const body = await readFile(script, "utf8").catch(() => {
				throw new Blocked(`${cap.bootstrap} not found in this repo`);
			});
			await waitFor(ctx, "SSH on the new host", async () => (await hostShell(ctx, name, "true").catch(() => ({ code: 1 }))).code === 0, { tries: 40, ms: 10000 });
			// The script arrives on stdin; the tunnel token goes into a 0600 env file
			// that the run reads and then deletes, so it never appears in argv.
			const env = cap.ingress === "cloudflare-tunnel" ? `TUNNEL_TOKEN=${await ctx.dns.tunnelToken(cap.tunnel)}\n` : "";
			const put = await hostShell(ctx, name, "umask 077 && cat > ~/.stack-bootstrap.env", { input: env });
			if (put.code !== 0) throw new Error("could not stage the bootstrap environment");
			const ran = await hostShell(ctx, name, "set -a; . ~/.stack-bootstrap.env; set +a; rm -f ~/.stack-bootstrap.env; bash -s", { input: body });
			if (ran.code !== 0) throw new Error(`${cap.bootstrap} failed on the host: ${firstLine(ran.stderr || ran.stdout)}`);
		}),
	];
}

export async function removeHost(ctx, key, resource) {
	const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "aws-ec2-docker" && c.name === resource.host);
	const call = async (args) => ctx.call("aws", await awsArgs(ctx, cap, args));
	if (key.startsWith("aws.host.address.")) {
		const { Addresses: [address] = [] } = await call(["ec2", "describe-addresses", "--allocation-ids", resource.id]);
		if (address?.AssociationId) await call(["ec2", "disassociate-address", "--association-id", address.AssociationId]);
		await call(["ec2", "release-address", "--allocation-id", resource.id]);
		delete ctx.state.resources[`aws.address.${resource.host}`];
		return `Elastic IP ${resource.ip}`;
	}
	if (key.startsWith("aws.host.instance.")) {
		await call(["ec2", "terminate-instances", "--instance-ids", resource.id]);
		await call(["ec2", "wait", "instance-terminated", "--instance-ids", resource.id]);
		return `instance ${resource.id} (terminated)`;
	}
	if (key.startsWith("aws.host.sg.")) {
		await call(["ec2", "delete-security-group", "--group-id", resource.id]);
		return `security group ${resource.id}`;
	}
	await call(["ec2", "delete-key-pair", "--key-name", resource.name]);
	return `key pair ${resource.name}`;
}

