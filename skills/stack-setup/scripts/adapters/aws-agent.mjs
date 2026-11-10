// A narrow, long-lived AWS identity for the agent, so checks and routine work
// don't need the owner's 12-hour console sign-in. It can read the account,
// manage only resources tagged for this app in one region, and rotate its own
// key. Creating it (once) needs the owner's sign-in.
import { iniSections, updateIniSection } from "../lib/ini.mjs";
import { recordCreated } from "../lib/state.mjs";

export const TAG = "stack-setup:app";
export const CREDENTIALS = "~/.aws/credentials";
export const agentUser = (stack) => `stack-setup-${stack.app}`;
// A managed policy, not an inline one: inline user policies stop at 2,048 bytes.
const policyName = (stack) => `stack-setup-agent-${stack.app}`;

export function agentPolicy({ account, region, app, user }) {
	const inRegion = { StringEquals: { "aws:RequestedRegion": region } };
	return {
		Version: "2012-10-17",
		Statement: [
			{
				Sid: "Read",
				Effect: "Allow",
				Action: ["ec2:Describe*", "sts:GetCallerIdentity", "iam:GetAccountSummary", "ssm:GetParameter", "ssm:GetParameters"],
				Resource: "*",
			},
			{
				Sid: "CreateTaggedForThisApp",
				Effect: "Allow",
				Action: ["ec2:RunInstances", "ec2:CreateSecurityGroup", "ec2:AllocateAddress", "ec2:ImportKeyPair", "ec2:CreateVolume"],
				Resource: [`arn:aws:ec2:${region}:${account}:instance/*`, `arn:aws:ec2:${region}:${account}:security-group/*`, `arn:aws:ec2:${region}:${account}:elastic-ip/*`, `arn:aws:ec2:${region}:${account}:key-pair/*`, `arn:aws:ec2:${region}:${account}:volume/*`],
				Condition: { StringEquals: { [`aws:RequestTag/${TAG}`]: app, "aws:RequestedRegion": region } },
			},
			{
				Sid: "RunInstancesSupportingResources",
				Effect: "Allow",
				Action: "ec2:RunInstances",
				Resource: [`arn:aws:ec2:${region}::image/*`, `arn:aws:ec2:${region}:${account}:subnet/*`, `arn:aws:ec2:${region}:${account}:network-interface/*`, `arn:aws:ec2:${region}:${account}:security-group/*`, `arn:aws:ec2:${region}:${account}:key-pair/*`],
				Condition: inRegion,
			},
			{
				Sid: "SecurityGroupsInTheVpc",
				Effect: "Allow",
				Action: "ec2:CreateSecurityGroup",
				Resource: `arn:aws:ec2:${region}:${account}:vpc/*`,
				Condition: inRegion,
			},
			{
				Sid: "TagOnlyWhileCreating",
				Effect: "Allow",
				Action: "ec2:CreateTags",
				Resource: "*",
				Condition: { StringEquals: { "ec2:CreateAction": ["RunInstances", "CreateSecurityGroup", "AllocateAddress", "ImportKeyPair", "CreateVolume"], "aws:RequestedRegion": region } },
			},
			{
				Sid: "ManageOnlyThisAppsResources",
				Effect: "Allow",
				Action: [
					"ec2:StartInstances",
					"ec2:StopInstances",
					"ec2:RebootInstances",
					"ec2:TerminateInstances",
					"ec2:AssociateAddress",
					"ec2:DisassociateAddress",
					"ec2:ReleaseAddress",
					"ec2:AuthorizeSecurityGroupIngress",
					"ec2:RevokeSecurityGroupIngress",
					"ec2:DeleteSecurityGroup",
					"ec2:DeleteKeyPair",
				],
				Resource: "*",
				Condition: { StringEquals: { [`aws:ResourceTag/${TAG}`]: app, "aws:RequestedRegion": region } },
			},
			{
				Sid: "RotateOwnKey",
				Effect: "Allow",
				Action: ["iam:CreateAccessKey", "iam:DeleteAccessKey", "iam:ListAccessKeys", "iam:UpdateAccessKey", "iam:GetUser"],
				Resource: `arn:aws:iam::${account}:user/${user}`,
			},
		],
	};
}

// The actions the policy must allow and refuse; run against AWS's own policy
// simulator before the user is created, and in tests against the JSON.
export const POLICY_EXPECTATIONS = {
	allowed: ["ec2:DescribeInstances", "sts:GetCallerIdentity", "iam:ListAccessKeys"],
	denied: ["iam:CreateUser", "iam:AttachUserPolicy", "s3:ListAllMyBuckets", "ec2:TerminateInstances", "billing:ModifyAccount", "organizations:LeaveOrganization"],
};

const read = async (ctx) => {
	try {
		return await ctx.readText(CREDENTIALS);
	} catch (error) {
		if (error.code === "ENOENT") return "";
		throw error;
	}
};

export async function hasAgentCredentials(ctx, cap) {
	return iniSections(await read(ctx)).includes(cap.agent.profile);
}

const admin = (cap, args) => [...args, "--profile", cap.profile, "--output", "json"];

export async function agentSteps(ctx, name, cap) {
	const user = agentUser(ctx.stack);
	const who = await ctx.json("aws", admin(cap, ["sts", "get-caller-identity"]), { gate: "aws.login" });
	const policy = agentPolicy({ account: who.Account, region: cap.region, app: ctx.stack.app, user });
	const exists = await ctx.run("aws", admin(cap, ["iam", "get-user", "--user-name", user]));
	const steps = [];
	if (exists.code !== 0)
		steps.push({
			id: `${name}.agent.user`,
			kind: "create",
			summary: `IAM user ${user} for the agent (no console password, no admin rights)`,
			run: async () => {
				const made = await ctx.call("aws", admin(cap, ["iam", "create-user", "--user-name", user, "--tags", `Key=${TAG},Value=${ctx.stack.app}`]));
				recordCreated(ctx, `aws.agent.${user}`, "aws-ec2-docker", { name: user, arn: made.User?.Arn ?? null, profile: cap.agent.profile });
			},
		});
	steps.push(...(await policySteps(ctx, name, cap, { account: who.Account, user, policy, userExists: exists.code === 0 })));
	steps.push(
		(await hasAgentCredentials(ctx, cap))
			? { id: `${name}.agent.key`, kind: "noop", summary: `access key in ${CREDENTIALS} [${cap.agent.profile}] (replace it with stack rotate agent-key)` }
			: {
					id: `${name}.agent.key`,
					kind: "create",
					summary: `access key for ${user} → ${CREDENTIALS} [${cap.agent.profile}] (0600)`,
					run: async () => {
						const made = await ctx.call("aws", admin(cap, ["iam", "create-access-key", "--user-name", user]));
						await writeAgentKey(ctx, cap, made.AccessKey);
						recordKey(ctx, cap, user, made.AccessKey.AccessKeyId);
					},
				},
	);
	return steps;
}

async function policySteps(ctx, name, cap, { account, user, policy, userExists }) {
	const arn = `arn:aws:iam::${account}:policy/${policyName(ctx.stack)}`;
	const found = await ctx.run("aws", admin(cap, ["iam", "get-policy", "--policy-arn", arn]));
	const summary = `policy ${policyName(ctx.stack)}: read the account; manage only resources tagged ${TAG}=${ctx.stack.app} in ${cap.region}; rotate its own key`;
	const steps = [];
	if (found.code !== 0)
		steps.push({
			id: `${name}.agent.policy`,
			kind: "create",
			summary,
			run: async () => {
				await ctx.call("aws", admin(cap, ["iam", "create-policy", "--policy-name", policyName(ctx.stack), "--policy-document", JSON.stringify(policy), "--tags", `Key=${TAG},Value=${ctx.stack.app}`]));
				recordCreated(ctx, `aws.agent-policy.${policyName(ctx.stack)}`, "aws-ec2-docker", { name: policyName(ctx.stack), arn, user });
			},
		});
	else {
		const version = JSON.parse(found.stdout).Policy.DefaultVersionId;
		const { PolicyVersion } = await ctx.call("aws", admin(cap, ["iam", "get-policy-version", "--policy-arn", arn, "--version-id", version]));
		const doc = typeof PolicyVersion.Document === "string" ? JSON.parse(decodeURIComponent(PolicyVersion.Document)) : PolicyVersion.Document;
		steps.push(
			JSON.stringify(doc) === JSON.stringify(policy)
				? { id: `${name}.agent.policy`, kind: "noop", summary: `policy ${policyName(ctx.stack)} (${version})` }
				: {
						id: `${name}.agent.policy`,
						kind: "update",
						summary: `${summary} (new version; the old one is kept until five exist)`,
						run: async () => {
							const { Versions = [] } = await ctx.call("aws", admin(cap, ["iam", "list-policy-versions", "--policy-arn", arn]));
							if (Versions.length >= 5) {
								const oldest = Versions.filter((v) => !v.IsDefaultVersion).sort((a, b) => a.CreateDate.localeCompare(b.CreateDate))[0];
								await ctx.call("aws", admin(cap, ["iam", "delete-policy-version", "--policy-arn", arn, "--version-id", oldest.VersionId]));
							}
							await ctx.call("aws", admin(cap, ["iam", "create-policy-version", "--policy-arn", arn, "--policy-document", JSON.stringify(policy), "--set-as-default"]));
						},
					},
		);
	}
	const attached = userExists ? JSON.parse((await ctx.run("aws", admin(cap, ["iam", "list-attached-user-policies", "--user-name", user]))).stdout || "{}").AttachedPolicies ?? [] : [];
	steps.push(
		attached.some((p) => p.PolicyArn === arn)
			? { id: `${name}.agent.attach`, kind: "noop", summary: `${policyName(ctx.stack)} attached to ${user}` }
			: { id: `${name}.agent.attach`, kind: "create", summary: `attach ${policyName(ctx.stack)} to ${user}`, run: () => ctx.call("aws", admin(cap, ["iam", "attach-user-policy", "--user-name", user, "--policy-arn", arn])) },
	);
	return steps;
}

// State keeps only the key's last four characters: AWS key IDs look like
// credentials to the guard, and AWS lists the user's keys whenever we need them.
function recordKey(ctx, cap, user, id) {
	recordCreated(ctx, `aws.agent-key.${user}`, "aws-ec2-docker", { name: `${user} access key`, user, profile: cap.agent.profile, keyEnding: id.slice(-4) });
}

export async function writeAgentKey(ctx, cap, key) {
	if (!key?.AccessKeyId || !key.SecretAccessKey) throw new Error("AWS did not return an access key");
	const text = updateIniSection(await read(ctx), cap.agent.profile, { aws_access_key_id: key.AccessKeyId, aws_secret_access_key: key.SecretAccessKey, region: cap.region });
	await ctx.writeSecretFile(CREDENTIALS, text);
}

export async function removeAgent(ctx, key, resource) {
	const cap = Object.values(ctx.stack.capabilities).find((c) => c.provider === "aws-ec2-docker");
	if (key.startsWith("aws.agent-key.")) {
		const { AccessKeyMetadata: keys = [] } = await ctx.call("aws", admin(cap, ["iam", "list-access-keys", "--user-name", resource.user]));
		for (const k of keys) await ctx.call("aws", admin(cap, ["iam", "delete-access-key", "--user-name", resource.user, "--access-key-id", k.AccessKeyId]));
		await ctx.writeSecretFile(CREDENTIALS, updateIniSection(await read(ctx), resource.profile, null));
		return `${keys.length} AWS access key${keys.length === 1 ? "" : "s"} for ${resource.user} (deleted at AWS, and from ${CREDENTIALS})`;
	}
	if (key.startsWith("aws.agent-policy.")) {
		await ctx.run("aws", admin(cap, ["iam", "detach-user-policy", "--user-name", resource.user, "--policy-arn", resource.arn]));
		const { Versions = [] } = await ctx.call("aws", admin(cap, ["iam", "list-policy-versions", "--policy-arn", resource.arn]));
		for (const v of Versions.filter((v) => !v.IsDefaultVersion)) await ctx.call("aws", admin(cap, ["iam", "delete-policy-version", "--policy-arn", resource.arn, "--version-id", v.VersionId]));
		await ctx.call("aws", admin(cap, ["iam", "delete-policy", "--policy-arn", resource.arn]));
		return `IAM policy ${resource.name}`;
	}
	await ctx.call("aws", admin(cap, ["iam", "delete-user", "--user-name", resource.name]));
	return `IAM user ${resource.name}`;
}

// New key first, prove it works, then delete the old one at AWS.
export async function rotateAgentKey(ctx, cap) {
	const user = agentUser(ctx.stack);
	const agent = (args) => [...args, "--profile", cap.agent.profile, "--output", "json"];
	const { AccessKeyMetadata: before = [] } = await ctx.call("aws", agent(["iam", "list-access-keys", "--user-name", user]));
	if (before.length > 1) throw new Error(`${user} already has two keys; delete the unused one first`);
	const made = await ctx.call("aws", agent(["iam", "create-access-key", "--user-name", user]));
	await writeAgentKey(ctx, cap, made.AccessKey);
	ctx.cache.clear();
	for (let attempt = 0; ; attempt++) {
		const probe = await ctx.run("aws", agent(["sts", "get-caller-identity"]));
		if (probe.code === 0) break;
		if (attempt >= 5) throw new Error("the new AWS key isn't working yet; the old key was kept");
		await ctx.sleep(5000); // new IAM keys take a few seconds to work everywhere
	}
	for (const old of before) await ctx.call("aws", agent(["iam", "delete-access-key", "--user-name", user, "--access-key-id", old.AccessKeyId]));
	recordKey(ctx, cap, user, made.AccessKey.AccessKeyId);
	return { replaced: before.map((k) => `…${k.AccessKeyId.slice(-4)}`), now: `…${made.AccessKey.AccessKeyId.slice(-4)}` };
}
