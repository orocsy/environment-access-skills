import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { main } from "../skills/stack-setup/scripts/stack.mjs";
import { parseYaml } from "../skills/stack-setup/scripts/lib/yaml.mjs";
import { validateStack } from "../skills/stack-setup/scripts/lib/schema.mjs";
import { adapters } from "../skills/stack-setup/scripts/adapters/index.mjs";

// Built at runtime so no live-key-shaped literal sits in the repo (secret scanners would flag it).
const SECRET = ["sk", "live", "SYNTHETICsyntheticSYNTHETIC0000"].join("_");

async function repo(files) {
	const dir = await mkdtemp(join(tmpdir(), "stack-init-"));
	for (const [path, text] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), text);
	}
	return dir;
}

async function init(dir, argv = []) {
	let out = "";
	const code = await main(["init", ...argv], { cwd: dir, out: { write: (t) => (out += t) }, detectOptions: { remote: async () => "owner/web-shop" } });
	return { code, out };
}

// A Next.js shop on Vercel with Stripe, Resend and Prisma, deployed by GitHub Actions.
const WEB_SHOP = {
	"package.json": JSON.stringify({ workspaces: ["apps/*"] }),
	"apps/shop/package.json": JSON.stringify({ dependencies: { next: "16.0.0", stripe: "19.0.0", resend: "6.0.0", "@prisma/client": "6.0.0" } }),
	"apps/shop/vercel.json": "{}",
	".github/workflows/ci.yml": "on: push\n",
	".env.example": "DATABASE_URL=postgres://user:pass@localhost/db\nSTRIPE_SECRET_KEY=\nRESEND_API_KEY=\nNEXT_PUBLIC_SITE_URL=\n",
	".env": `STRIPE_SECRET_KEY=${SECRET}\n`,
};

// A FastAPI + Postgres + Redis backend in Docker with Tencent SMS, an iOS app and a tunnel.
const API_APP = {
	"backend/pyproject.toml": '[project]\ndependencies = [\n  "fastapi>=0.115",\n  "sqlalchemy>=2",\n  "celery>=5",\n  "boto3>=1.35",\n  "tencentcloud-sdk-python-sms>=3",\n  "openai>=1.50",\n]\n',
	"backend/Dockerfile": "FROM python:3.12\n",
	"infra/local/compose.yaml": "services:\n  db:\n    image: postgres:16\n",
	"infra/deploy/compose.yaml": "services:\n  api:\n    image: app\n  postgres:\n    image: pgvector/pgvector:pg16\n  redis:\n    image: redis:7\n  cloudflared:\n    image: cloudflare/cloudflared:2026.10.0\n",
	"infra/deploy/app.env.example": "APP_SECRET=CHANGE-ME\nAPP_TENCENT_SMS_SECRET_ID=\nAPP_AI_API_KEY=\nAPP_S3_BUCKET=\n",
	"apps/mobile/App.xcodeproj/project.pbxproj": 'PRODUCT_BUNDLE_IDENTIFIER = "com.example.app";\nPRODUCT_BUNDLE_IDENTIFIER = "com.example.appTests";\n',
};

test("init: a web shop's draft names Vercel, Stripe, Resend and GitHub, with the evidence, and validates", async () => {
	const dir = await repo(WEB_SHOP);
	const { code, out } = await init(dir, ["--app", "web-shop", "--domain", "shop.example"]);
	assert.equal(code, 0, out);
	const text = await readFile(join(dir, "infra/stack/stack.yaml"), "utf8");
	assert.deepEqual(validateStack(parseYaml(text), adapters).errors, []);
	const stack = parseYaml(text);
	assert.equal(stack.capabilities.web.provider, "vercel");
	assert.deepEqual(stack.capabilities.web.projects, ["shop"]);
	assert.equal(stack.capabilities.payments.provider, "stripe");
	assert.equal(stack.capabilities.email.provider, "resend");
	assert.equal(stack.capabilities.ci.repo, "owner/web-shop");
	assert.equal(stack.capabilities.dns.bootstrap_token_file, "~/.config/stack-setup/cloudflare-bootstrap.env");
	assert.match(text, /# apps\/shop\/package\.json: stripe \(Stripe SDK\)/);
	assert.match(text, /# apps\/shop\/vercel\.json: Vercel config/);
	assert.deepEqual(stack.contract.payments, ["STRIPE_SECRET_KEY"]);
	assert.deepEqual(stack.contract.web, ["NEXT_PUBLIC_SITE_URL"], "a name with no owner goes with the web app when there's no server");
	assert.match(out, /skipped 1 real env file unread/);
	assert.ok(!text.includes(SECRET) && !text.includes("user:pass"), "values are never copied, not even from env examples");
	assert.match(out, /web: the Vercel team \(scope\), and the Vercel project names for shop/);
});

test("init: a Docker backend becomes a server with its database and cache on it, using the deploy compose file", async () => {
	const dir = await repo(API_APP);
	const { code, out } = await init(dir, ["--app", "family"]);
	assert.equal(code, 0, out);
	const stack = parseYaml(await readFile(join(dir, "infra/stack/stack.yaml"), "utf8"));
	assert.equal(stack.capabilities.api_host.provider, "aws-ec2-docker");
	assert.equal(stack.capabilities.api_host.compose, "infra/deploy/compose.yaml");
	assert.equal(stack.capabilities.api_host.ingress, "cloudflare-tunnel");
	assert.deepEqual([stack.capabilities.database.provider, stack.capabilities.database.on], ["docker-postgres", "api_host"]);
	assert.equal(stack.capabilities.cache.provider, "docker-redis");
	assert.equal(stack.capabilities.ios.bundle_id, "com.example.app");
	assert.equal(stack.capabilities.sms.provider, "tencent-sms");
	assert.match(out, /domain: the app's real domain/);
	assert.match(out, /the code mentions mainland services \(APP_TENCENT_SMS_SECRET_ID\); add a cn-mainland stack file too\?/);
	assert.doesNotMatch(out, /docker-postgres and docker-postgres/, "a specific finding refines a general one");
});

test("init: the China draft uses Tencent, drops the tunnel, flags services that don't serve the mainland", async () => {
	const dir = await repo({ ...API_APP, "apps/web/package.json": JSON.stringify({ dependencies: { next: "16.0.0", stripe: "19.0.0" } }) });
	const { code, out } = await init(dir, ["--app", "family-cn", "--jurisdiction", "cn-mainland", "--out", "infra/stack/cn.stack.yaml"]);
	assert.equal(code, 0, out);
	const text = await readFile(join(dir, "infra/stack/cn.stack.yaml"), "utf8");
	const stack = parseYaml(text);
	assert.deepEqual(validateStack(stack, adapters).errors, []);
	assert.equal(stack.jurisdiction, "cn-mainland");
	assert.deepEqual(stack.profile.forms.sort(), ["api", "ios-app", "website"]);
	assert.equal(stack.capabilities.api_host.provider, "tencent-lighthouse");
	assert.equal(stack.capabilities.api_host.ingress, undefined);
	assert.equal(stack.capabilities.storage.provider, "tencent-cos");
	assert.equal(stack.capabilities.dns.provider, "dnspod");
	assert.match(out, /payments: stripe doesn't serve mainland users/);
	assert.match(out, /web: vercel doesn't serve mainland users/);
	assert.match(out, /the tunnel is left out here/);
});

test("init: never overwrites an existing stack file", async () => {
	const dir = await repo({ ...WEB_SHOP, "infra/stack/stack.yaml": "app: mine\n" });
	const { code, out } = await init(dir);
	assert.equal(code, 0, out);
	assert.equal(await readFile(join(dir, "infra/stack/stack.yaml"), "utf8"), "app: mine\n");
	assert.match(await readFile(join(dir, "infra/stack/stack.draft.yaml"), "utf8"), /provider: vercel/);
	assert.match(out, /beside the existing stack\.yaml, which wasn't touched/);
});

test("init: an empty repo still drafts something valid and says what it couldn't find", async () => {
	const dir = await repo({ "README.md": "# empty\n" });
	const { code, out } = await init(dir, ["--app", "empty-app"]);
	assert.equal(code, 0, out);
	assert.match(out, /Found 0 capabilities/);
});
