import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseYaml } from "../skills/stack-setup/scripts/lib/yaml.mjs";
import { validateStack } from "../skills/stack-setup/scripts/lib/schema.mjs";
import { adapters } from "../skills/stack-setup/scripts/adapters/index.mjs";
import { parseSpan, route } from "../skills/stack-setup/scripts/lib/guide.mjs";
import { main } from "../skills/stack-setup/scripts/stack.mjs";
import { healthyWorld, overridesFor } from "./stack-setup/world.mjs";

// A synthetic app shaped like a phone-sign-in family app with an iOS client.
const CN = `app: family-cn
domain: family-example.cn
jurisdiction: cn-mainland
profile:
  subject: mainland-person
  province: guangdong
  forms: [api, ios-app]
  commercial: false
  children: true
  data_leaves_mainland: false
  domain: new
capabilities:
  dns: { provider: dnspod, registrar: tencent }
  api_host: { provider: tencent-lighthouse, region: ap-guangzhou }
  sms: { provider: tencent-sms }
contract:
  sms: [TENCENT_SMS_SDK_APP_ID]
`;

class Sink {
	text = "";
	write(chunk) {
		this.text += chunk;
	}
}

async function workspace(text = CN) {
	const dir = await mkdtemp(join(tmpdir(), "stack-guide-"));
	await mkdir(join(dir, "infra/stack"), { recursive: true });
	await writeFile(join(dir, "infra/stack/stack.yaml"), text);
	return dir;
}

async function run(dir, argv, { now = "2026-11-10T00:00:00Z", world = healthyWorld(), extra = {} } = {}) {
	const out = new Sink();
	const code = await main(argv, { cwd: dir, out, ...overridesFor(world, now), ...extra });
	return { code, out: out.text };
}

const readState = async (dir) => JSON.parse(await readFile(join(dir, "infra/stack/.stack/state.json"), "utf8"));
// What stack verify records when a probe-backed step's check turns green.
const probeDone = async (dir, id) => {
	const path = join(dir, "infra/stack/.stack/state.json");
	const state = JSON.parse(await readFile(path, "utf8"));
	state.gates[id] = { status: "done", at: "2026-11-10T00:00:00Z", by: `probe ${id}` };
	await writeFile(path, JSON.stringify(state));
};
const markDone = async (dir, ids, now) => {
	for (const id of ids) {
		const r = await run(dir, ["guide", "done", id], { now });
		assert.equal(r.code, 0, `${id}: ${r.out}`);
	}
};

test("pack: an unknown jurisdiction or answer is an error; providers that don't serve the mainland are warned about", () => {
	assert.match(validateStack({ ...parseYaml(CN), jurisdiction: "mars" }, adapters).errors.join(), /jurisdiction: one of cn-mainland/);
	assert.match(validateStack({ ...parseYaml(CN), profile: { subject: "robot" } }, adapters).errors.join(), /profile\.subject: one of mainland-person/);
	const withGlobal = parseYaml(CN.replace("  sms: { provider: tencent-sms }", "  sms: { provider: tencent-sms }\n  signin: { provider: google-oauth, project: family-app }\n  payments: { provider: stripe, mode: sandbox }"));
	const { errors, warnings } = validateStack(withGlobal, adapters);
	assert.deepEqual(errors, []);
	assert.match(warnings.join("\n"), /signin: google-oauth — Google sign-in isn't reachable/);
	assert.match(warnings.join("\n"), /payments: stripe — Stripe doesn't onboard mainland businesses/);
});

test("guide: asks the up-front questions first when any are unanswered", async () => {
	const dir = await workspace(CN.replace("  children: true\n", ""));
	const { code, out } = await run(dir, ["guide"]);
	assert.equal(code, 10);
	assert.match(out, /Answer these first/);
	assert.match(out, /- children: Will children under 14 use it.*→ not answered/);
	assert.match(out, /- subject: Who files\? .*→ now: "mainland-person"/);
});

test("guide: one screen for the next owner step, with where, steps, documents and sources", async () => {
	const dir = await workspace();
	const { code, out } = await run(dir, ["guide"]);
	assert.equal(code, 0, out);
	assert.match(out, /^Step 1 of \d+ · account · you · minutes for a person/);
	assert.match(out, /Real-name verify your Tencent Cloud account as a person \(个人认证\)/);
	assert.match(out, /Where: https:\/\/console\.cloud\.tencent\.com\/developer\/auth/);
	assert.match(out, /Have ready:\n {2}☐ mainland ID card/);
	assert.match(out, /Based on: https:\/\/cloud\.tencent\.com\/document\/product\/243\/97668 \(checked 2026-11-10\)/);
	assert.match(out, /When it's done: stack guide done cn\.account\.realname/);
});

test("guide: the server is bought only when everything else for the filing is ready", async () => {
	const dir = await workspace();
	const all = await run(dir, ["guide", "all"]);
	assert.match(all.out, /· Buy the mainland server the filing is attached to — you approve; the agent buys, minutes 💲 \(bought only when everything else is ready\) · after cn\.account\.realname, tencent\.login, cn\.domain\.realname, cn\.filing\.prepare, cn\.app\.prepare/);
	await markDone(dir, ["cn.account.realname", "cn.domain.register", "cn.domain.realname", "cn.filing.prepare", "apple.developer"]);
	const notYet = await run(dir, ["guide", "all"]);
	assert.match(notYet.out, /· Buy the mainland server .* · after tencent\.login, cn\.app\.prepare/, "one filing input still missing: not bought yet");
	await markDone(dir, ["cn.app.prepare"]);
	const stillWaiting = await run(dir, ["guide", "all"]);
	assert.match(stillWaiting.out, /· Buy the mainland server .* · after tencent\.login/, "the agent buys it through the Tencent CLI, so the sign-in comes first");
	await probeDone(dir, "tencent.login");
	const now = await run(dir, ["guide"]);
	assert.match(now.out, /Buy the mainland server the filing is attached to {2}💲 Tencent's monthly price for the chosen size, shown before you agree/);
	assert.match(now.out, /1\. Only now, because a filing can't be submitted without it/);
});

test("guide: the 24-hour SMS clock starts when the face check is done, and shows overdue", async () => {
	const dir = await workspace();
	await markDone(dir, ["cn.account.realname", "cn.domain.register", "cn.domain.realname", "cn.filing.prepare", "apple.developer", "cn.app.prepare"]);
	await probeDone(dir, "tencent.login");
	await markDone(dir, ["cn.host.purchase", "cn.filing.submit"]);
	await markDone(dir, ["cn.filing.face"], "2026-11-12T08:00:00Z");
	const soon = await run(dir, ["guide"], { now: "2026-11-12T09:00:00Z" });
	assert.match(soon.out, /Answer the MIIT text message within 24 hours/);
	assert.match(soon.out, /⏰ due 2026-11-13 08:00 UTC\n/);
	const late = await run(dir, ["guide"], { now: "2026-11-13T09:00:00Z" });
	assert.match(late.out, /⏰ due 2026-11-13 08:00 UTC \(overdue\)/);
	assert.equal(parseSpan("30 days"), 30 * 86400000);
	assert.throws(() => parseSpan("a while"), /a time span/);
});

test("guide: stuck notes are kept on the step; checked steps can't be marked done by hand", async () => {
	const dir = await workspace();
	const stuck = await run(dir, ["guide", "stuck", "the", "face", "check", "app", "won't", "open"]);
	assert.equal(stuck.code, 0, stuck.out);
	assert.equal((await readState(dir)).gates["cn.account.realname"].stuck[0].text, "the face check app won't open");
	const global = await mkdtemp(join(tmpdir(), "stack-guide-global-"));
	await mkdir(join(global, "infra/stack"), { recursive: true });
	await copyFile(resolve("docs/stack-setup/example.stack.yaml"), join(global, "infra/stack/stack.yaml"));
	await assert.rejects(run(global, ["guide", "done", "google.client"]), /closed by the check signin\.redirect/);
	const next = await run(global, ["guide"]);
	assert.equal(next.code, 0, next.out);
	assert.match(next.out, /^Step \d+ of \d+ · preflight · you/);
});

test("guide all: tracks, money, deadlines and adviser flags in one view; payments only when commercial", async () => {
	const dir = await workspace();
	const { out } = await run(dir, ["guide", "all"]);
	for (const track of ["### account", "### domain", "### filing", "### launch"]) assert.match(out, new RegExp(track));
	assert.match(out, /Police filing \(公安联网备案\) within 30 days of going live — you, .*within 30 days of cn\.golive/);
	assert.match(out, /Chinese privacy policy and user agreement — agent drafts; you approve ⚖/);
	assert.match(out, /Add the app's filing number in App Store Connect/);
	assert.doesNotMatch(out, /Decide how to take payments/);
	const paid = await workspace(CN.replace("commercial: false", "commercial: true"));
	const withPay = await run(paid, ["guide", "all"]);
	assert.match(withPay.out, /Decide how to take payments — you ⚖/);
	const step = parseYaml(CN.replace("commercial: false", "commercial: true"));
	const { gates } = await import("../skills/stack-setup/scripts/packs/cn-mainland.mjs");
	assert.match(gates(step).find((g) => g.id === "cn.payments").steps[0], /A person \(no business\) can't open a WeChat Pay or Alipay merchant account/);
});

test("doctor: lists the agent skills and tools a stack needs, installed or not", async () => {
	const dir = await workspace(CN.replace("  sms: { provider: tencent-sms }", "  sms: { provider: tencent-sms }\n  web: { provider: tencent-cloudbase }"));
	const world = healthyWorld();
	const runFake = overridesFor(world).run;
	const { out } = await run(dir, ["doctor"], {
		world,
		extra: {
			run: async (cmd, args, o) => (cmd === "tccli" ? { code: 127, missing: true, stdout: "", stderr: "" } : runFake(cmd, args, o)),
			skillLookup: { plugins: [], has: async (path) => path.endsWith("secure-key-handoff") },
		},
	});
	assert.match(out, /`tool\.tccli` \| ❌ red \| tccli is not installed/);
	assert.match(out, /## Agent skills this stack uses/);
	assert.match(out, /✅ secure-key-handoff \(skill\) for any stack/);
	assert.match(out, /☐ cloudbase \(plugin\) for web \(tencent-cloudbase\): CloudBase's own rules .* Install \(asks first\): Tencent's CloudBase AI Toolkit plugin, pinned to a version, in this app's project only/);
});

test("route: a paid just-in-time step waits for everything else its dependents need", () => {
	const gates = [
		{ id: "buy", title: "Buy", cost: "x", justInTime: true, status: "open" },
		{ id: "docs", title: "Docs", status: "open" },
		{ id: "submit", title: "Submit", after: ["buy", "docs"], status: "open" },
	];
	const before = route(gates, { gates: {} });
	assert.equal(before.steps.find((s) => s.id === "buy").state, "blocked");
	assert.deepEqual(before.steps.find((s) => s.id === "buy").waitingOn, ["docs"]);
	assert.equal(before.next.id, "docs");
	const after = route(gates.map((g) => (g.id === "docs" ? { ...g, status: "done" } : g)), { gates: {} });
	assert.equal(after.next.id, "buy");
});

test("route: the owner's ready step comes before the agent's own work", () => {
	const gates = [
		{ id: "agent-work", title: "Agent", who: "agent", status: "open" },
		{ id: "owner-work", title: "Owner", who: "you", status: "open" },
	];
	assert.equal(route(gates, { gates: {} }).next.id, "owner-work");
	assert.equal(route([gates[0]], { gates: {} }).next.id, "agent-work", "agent work shows when nothing else is ready");
});

test("route: steps read in dependency order, and a loop is reported", () => {
	const gates = [
		{ id: "z-last", title: "Z", after: ["a-first"], status: "open", seq: 0 },
		{ id: "a-first", title: "A", status: "open", seq: 1 },
	];
	assert.deepEqual(route(gates, { gates: {} }).steps.map((s) => s.id), ["a-first", "z-last"]);
	assert.throws(() => route([{ id: "x", after: ["y"] }, { id: "y", after: ["x"] }], { gates: {} }), /in a loop: x, y/);
});

const COMPANY = CN.replace("  subject: mainland-person\n", "  subject: company\n  registration: cluster-host\n  city: guangzhou-nansha\n").replace("commercial: false", "commercial: true");

test("business track: a one-person company at a hosted address comes first, and everything that needs it waits", async () => {
	const dir = await workspace(COMPANY);
	const { out } = await run(dir, ["guide", "all"]);
	assert.match(out, /^## Route for family-cn: 0 of \d+ done\n\n### business\n/);
	assert.match(out, /Plan the one-person limited company \(一人有限责任公司\)/);
	assert.match(out, /Choose an approved hosted address \(集群注册\) in the district — you, a few days to compare two hosts 💲/);
	assert.match(out, /Real-name verify your Tencent Cloud account as a business .* · after cn\.biz\.bank/);
	assert.match(out, /Buy family-example\.cn at Tencent Domains .* · after cn\.biz\.register/);
	assert.match(out, /Open WeChat Pay and Alipay merchant accounts — you.* · after cn\.biz\.bank, cn\.filing\.review/);
	const first = await run(dir, ["guide"]);
	assert.match(first.out, /Plan the one-person limited company/, "the agent's plan is the only thing ready at the start");
	await run(dir, ["guide", "done", "cn.biz.plan"]);
	const host = await run(dir, ["guide"]);
	assert.match(host.out, /Choose an approved hosted address \(集群注册\)/);
	assert.match(host.out, /请问本区有哪些备案的集群注册托管机构/);
	assert.match(host.out, /Walk away: unregistered addresses are rejected/);
});

test("business track: city is asked for a business being formed, not for a person", async () => {
	const missingCity = await workspace(COMPANY.replace("  city: guangzhou-nansha\n", ""));
	const asked = await run(missingCity, ["guide"]);
	assert.equal(asked.code, 10);
	assert.match(asked.out, /- city: For a business: which city and district.*→ not answered/);
	const person = await workspace();
	const ask = await run(person, ["guide", "ask"]);
	assert.doesNotMatch(ask.out, /- registration:|- city:/, "a person isn't asked business questions");
	const all = await run(person, ["guide", "all"]);
	assert.doesNotMatch(all.out, /### business/);
});
