import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseYaml } from "../skills/stack-setup/scripts/lib/yaml.mjs";
import { validateStack } from "../skills/stack-setup/scripts/lib/schema.mjs";
import { adapters } from "../skills/stack-setup/scripts/adapters/index.mjs";

test("the China example parses and validates; its planned providers have no adapter yet", async () => {
	const raw = parseYaml(await readFile("docs/stack-setup/example-cn.stack.yaml", "utf8"));
	const { stack, errors } = validateStack(raw, adapters);
	assert.deepEqual(errors, []);
	assert.equal(stack.jurisdiction, "cn-mainland");
	assert.equal(stack.capabilities.sms.sign, "示例");
	const planned = Object.values(stack.capabilities).map((c) => c.provider).filter((p) => !adapters[p]);
	assert.deepEqual([...new Set(planned)].sort(), ["dnspod", "tencent-cloudbase", "tencent-cloudbase-mysql", "tencent-ses", "tencent-sms", "wechat-login", "wechat-pay"]);
});
