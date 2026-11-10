# China mainland stacks: Tencent Cloud, serverless or servers, plus the filings

Status: research and design for owner approval, 10 Nov 2026. Not legal advice. Each fact names its source, and those marked **verify** were not confirmed from an official page. The guided flow itself is in [guided-setup.md](guided-setup.md).

## The short version

- **Same tool, different stack file.** An app can have several deployments, for example `infra/stack/global.stack.yaml` and `infra/stack/cn.stack.yaml`. Each picks its own providers. A top-level `jurisdiction: cn-mainland` loads the **China compliance pack**: extra checks, guided steps and warnings.
- **Two kinds of Tencent hosting, one choice per capability:**
  - **Serverless: Tencent CloudBase (TCB).** Static hosting, CloudRun containers, functions, database and storage, all driven by CloudBase CLI v3 (`tcb`).
  - **Servers: Lighthouse or CVM.** The same Docker-on-a-server shape as WiggleTrail's EC2 box, driven by `tccli`.
- **The slow part is the filings, not the code.** ICP filing must happen before a mainland server can serve a domain. A police (公安) filing is due within 30 days of going live. Apps and mini programs need their own filing. Payments, WeChat sign-in and SMS each need verified qualifications, mostly a business licence.
- **The biggest early decision is who files.** Normally a mainland company, or a person with a mainland ID. A foreign company needs a mainland entity (a WFOE or a partner). Foreign individuals can file with a passport only in some provinces. Selling online may also need a commercial ICP licence (B25), which is much harder.

## How it fits the existing design

Nothing about the core changes:
- the `stack.yaml` capabilities;
- the adapters' `validate`, `plan`, `verify` and `remove`;
- the secret stores;
- `rotate`, `teardown` and the cost gate.

China adds new **adapters**, and a **compliance pack**: a bundle of gates, an interview, validation rules and sources, loaded by `jurisdiction:`.

```yaml
app: example-cn
domain: example.cn
jurisdiction: cn-mainland          # loads the China compliance pack
profile:                           # the interview's answers (see guided-setup.md)
  subject: company                 # company | mainland-person | foreign-person
  province: guangdong
  commercial: false                # true adds the B25 licence track
  forms: [website, mini-program]
  data_leaves_mainland: false
  children: true
capabilities:
  dns:      { provider: dnspod, registrar: tencent }
  web:      { provider: tencent-cloudbase, env: example-cn-prod, hosting: static }
  api:      { provider: tencent-cloudbase, env: example-cn-prod, cloudrun: api }
  # or, not serverless:
  # api_host: { provider: tencent-lighthouse, region: ap-guangzhou, bundle: …, bootstrap: infra/bootstrap.sh }
  database: { provider: tencent-cloudbase-mysql, env: example-cn-prod }
  email:    { provider: tencent-ses, subdomain: mail }
  sms:      { provider: tencent-sms, sign: 示例 }
  payments: { provider: wechat-pay }
  signin:   { provider: wechat-login, surfaces: [website, mini-program] }
  ci:       { provider: github }
```

A full synthetic example is in [example-cn.stack.yaml](example-cn.stack.yaml).

### What the pack checks before anything is bought

- **Unreachable providers:** `google-oauth`, `stripe` and Vercel hosting are flagged for a mainland-facing stack. Google sign-in is not reachable from the mainland; Stripe does not onboard mainland businesses; mainland visitors to an overseas host are slow and unreliable.
- **Domain:** the suffix must be on MIIT's approved list, and the registrar must be MIIT-approved. A domain at a foreign registrar such as GoDaddy has to be transferred first. It must be real-name verified in the filing subject's own name, with more than 45 days left before it expires ([Aliyun: prepare the domain](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/prepare-and-check-the-domain-name)).
- **Hosting:**
  - For a filing on Tencent Cloud you need an eligible mainland resource, bought first. A CVM, a Lighthouse server, a Serverless service or a load balancer all qualify, or an authorisation code (备案授权码) from another account ([Tencent: first filing](https://cloud.tencent.com/document/product/243/97668)).
  - Lighthouse must be a mainland region and billed monthly or yearly ([Tencent: Lighthouse ICP](https://cloud.tencent.com/document/product/1207/45756)).
  - **Verify:** which CloudBase plans count as filing resources, and whether a custom domain on CloudBase static hosting needs a filing. I found no official statement. Older guides say it does.
- **Limits:** a person can add one website per filing order. A company can add up to 10, with one domain per website ([Tencent: how to file](https://cloud.tencent.com/document/product/243/19628)).

## Adapters to add

| Provider | Capability | Tooling (official only) | Notes |
|---|---|---|---|
| `dnspod` | DNS | DNSPod API or `tccli dnspod` | Has a CAM policy scoped to one domain ([DNSPod CAM](https://docs.dnspod.com/dns/using-cam-policy-for-dnspod/)) |
| `tencent-domains` | registrar | Tencent Domains console; transfer-in by API where possible | Real-name template in the filing subject's own name |
| `tencent-cloudbase` | web, API, functions, storage | CloudBase CLI v3 `tcb`: `tcb hosting deploy`, `tcb app deploy`, `tcb cloudrun deploy -e <env>`, `tcb fn deploy` ([CLI v3](https://cloudbase.cloud.tencent.com/en/blog/2026/04/21/cloudbase-cli-v3), [cloudrun deploy](https://docs.cloudbase.net/en/cli-v1/cloudrun/deploy)) | Serverless. The environment ID is the resource. |
| `tencent-lighthouse`, `tencent-cvm` | API host | `tccli lighthouse …`, `tccli cvm …` | Same bootstrap shape as `aws-ec2-docker`. Monthly billing for filing. |
| `tencent-cloudbase-mysql`, `tencentdb` | database | `tcb`, `tccli cdb` | Data stays in the mainland region |
| `tencent-ses` | email | `tccli ses` | Sending domain plus DNS records, like Resend. **Verify** its domain rules. |
| `tencent-sms` | SMS | `tccli sms` | Signature and templates need qualification review, then carrier registration, before anything sends ([Tencent SMS notice](https://cloud.tencent.com/announce/detail/2156)) |
| `wechat-pay`, `alipay` | payments | merchant platforms | A merchant account needs a business licence (individual business or company) |
| `wechat-login` | sign-in | WeChat Open Platform | Developer qualification is a paid review, about CNY 300 in older guides (**verify**), plus a review of the website app, which needs a live site |

### The agent's own Tencent identity (like the AWS agent key)

The owner signs in once with `tccli auth login`, which opens the browser ([TCCLI login](https://tencentcloud.com/document/product/1013/64709)). Then `apply` creates:
- a **CAM sub-user** for the agent;
- a policy limited to this app's resources (the DNSPod policy, the CloudBase environment, tagged servers in one region);
- a key in a 0600 credentials file.

It works the same as the AWS agent: `rotate agent-key` replaces the key, and the owner's sign-in is needed only to change the agent's permissions. The CloudBase CLI needs a read-only CAM policy for a sub-account signing in on the web ([CloudBase CLI install](https://docs.cloudbase.net/en/cli-v1/install)).

### Do we need the CloudBase skills?

Only for **writing app code** on CloudBase. Not for stack-setup.
- **For app code:** Tencent publishes an official agent toolkit with skills, an MCP server and a Claude Code plugin ([CloudBase AI Toolkit](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit), [skills](https://docs.cloudbase.net/en/ai/cloudbase-ai-toolkit/prompts/how-to-use), [MCP for Claude Code](https://docs.cloudbase.net/en/recipes/add-claude-code-mcp-cloudbase)). It's worth adding to a China app's own repo when that app is built, so the coding agent follows CloudBase's practices for its database, auth and functions. Pin a version rather than `@latest`, and install it in that project only: an MCP server acts with the signed-in account's full rights.
- **For stack-setup:** it keeps calling the official CLIs (`tcb`, `tccli`). Those are scriptable, testable with recorded output, and limited by the agent's CAM policy.

Installing either is a download from a third party, so it's asked for first.

## The route, step by step

The guided flow (see [guided-setup.md](guided-setup.md)) turns this into one screen per step. ★ = only the owner can do it, ⏳ = a wait, 💲 = costs money.

### Track A: account and domain (days 0–7)
1. ★ **Tencent Cloud real-name verification**, as a person or a company. It decides which filing types are possible.
2. **Domain.**
   - The agent checks the suffix and the registrar against MIIT's lists.
   - If the domain is at a foreign registrar: ★💲 the owner unlocks it and gets the transfer code; the agent starts the transfer into Tencent Domains. ⏳ About 5–7 days (**verify**).
   - ★ Real-name template in the filing subject's name. ⏳ Then 2–3 working days for the details to sync ([Aliyun](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/prepare-and-check-the-domain-name)).

### Track B: hosting (day 1, alongside A)
3. 💲 **Buy the filing resource.** A monthly-billed mainland Lighthouse or CVM server, or the CloudBase plan that counts (**verify**). The plan shows the price.
4. The agent **builds everything that doesn't need the domain:**
   - the CloudBase environment or server;
   - the database;
   - deploying to the default test domain.

   The app is tested end to end before filing.

### Track C: ICP filing (from day 2, once A and B are done)
5. The agent **prepares the filing:**
   - pre-filled values: site name, service description, the responsible people;
   - a document checklist, with each document's format checked.
6. ★ **Submit** in the console ([how to file](https://cloud.tencent.com/document/product/243/19628)). ⏳ Tencent's review, 1–2 working days. They may phone.
7. ★ **Face check** in the 腾讯云助手 mini program.
8. ★ **MIIT SMS check, within 24 hours** of the text. This is a hard clock. The guide warns ahead of time and shows the exact page to open.
9. ⏳ **The provincial authority reviews it** (管局), within 20 working days by rule ([MIIT notice via The Paper](https://m.thepaper.cn/newsDetail_forward_24155262)).
10. The agent, once the filing number exists:
    - points the domain at the mainland host;
    - adds the filing number to the footer, linked to `beian.miit.gov.cn`;
    - turns on the CDN and HTTPS;
    - checks it all.

### Track D: after go-live (clock starts at launch)
11. ★ **Police filing (公安联网备案) within 30 days of the site opening**, at the national platform. Then show the police filing number in the footer within 30 days of approval ([Aliyun: police filing](https://help.aliyun.com/document_detail/36981.html)). A site that serves only an API, or isn't live yet, can wait ([Tencent ICP overview](https://cloud.tencent.com/document/product/243/18907)).

### Track E: other forms and services (only if the interview says so)
12. **Mini program or app filing.** Filed like a website, through the platform or the access provider. New ones must be filed before launch, and each needs its own police filing ([IT之家](https://ithome.com/0/711/106.htm), [secrss](https://www.secrss.com/articles/57613)).
13. **Payments:**
    - ★ a WeChat Pay or Alipay merchant account (business licence);
    - the agent wires keys and callbacks through secure-key-handoff, as with Stripe.
14. **WeChat sign-in:**
    - ★💲 developer qualification on the Open Platform;
    - ★ the website app review, which needs the live, filed site.
15. **SMS:** ★ signature qualification, then ⏳ carrier registration. The agent drafts templates to the review rules.

### Track F: law (flagged, not decided by the agent)
16. **Commercial licence (B25)** if the service sells or takes payment online. Vendor guides put it at 60–90 working days, with capital and staffing requirements, and conflicting accounts of the foreign-ownership limit. That's an agency's or lawyer's job ([China Briefing](https://www.china-briefing.com/news/china-internet-business-licenses-foreign-companies/), [MS Advisory](https://msadvisory.com/icp-license-china/)).
17. **Personal data (PIPL):**
    - a Chinese privacy policy;
    - separate consent for sensitive data;
    - a parent's consent for under-14s.

    If data leaves the mainland, it needs one of three routes: a security assessment, a standard-contract filing, or certification (all in force from 1 Jan 2026), unless an exemption applies ([Mondaq](https://www.mondaq.com/china/security/1701278/china-finalizes-certification-route-for-cross-border-data-transfer), [China Briefing](https://www.china-briefing.com/news/china-simplified-data-compliance-for-small-companies/)). The simplest design is a separate China deployment whose data never leaves.
18. **MLPS (等保) grading**, for systems that handle personal information. Ask the same adviser.

### Roughly how long

With a mainland subject ready: about 2–5 weeks to a filed, live site. That's account and domain in week 1, filing review in weeks 1–4, then the police filing within a month of launch. Starting from a foreign company with no mainland entity, vendor guides say 3–6 months, mostly setting up the entity.

## Choices for an app built outside China

| Route | Filing needed | Good for | Catch |
|---|---|---|---|
| **A. Full mainland stack** (CloudBase, or Lighthouse and Docker) | ICP, police, app/mini-program filings | Real mainland users; WeChat Pay; WeChat sign-in | Needs a mainland subject; weeks of filings; data stays in China |
| **B. WeChat mini program on CloudBase** | Mini-program filing, plus police filing | Reaching users inside WeChat, with no website of its own | Still needs a subject; WeChat's own review |
| **C. Host in Hong Kong or Singapore, mainland users visit** | No ICP; still police filing if accessible from the mainland ([Aliyun](https://help.aliyun.com/document_detail/36981.html)) | Testing interest without a mainland entity | Slower and less reliable; WeChat Pay and sign-in still need a Chinese entity |

The interview recommends one of these from the answers. It doesn't stop the owner choosing another.

## Milestones (to approve, after M3 merges)

1. **G1:** `guide` for the existing stacks (see [guided-setup.md](guided-setup.md)).
2. **C1:** Tencent read-only adapters: `dnspod`, `tencent-cloudbase`, `tencent-lighthouse`, plus the `doctor` checks for `tcb` and `tccli`. Tested with recorded output.
3. **C2:** the China compliance pack. The interview, the validation rules above, and tracks A–F as guided gates, each with its sources and last-checked date.
4. **C3:** provision for CloudBase and Lighthouse; the Tencent CAM agent key; DNSPod records; Tencent SES and SMS.
5. **C4:** a dry run, `plan` and `guide all`, for a real candidate app, once the owner picks one and answers the interview.

## Questions for the owner

1. Which app would go to the mainland, and as what: a website, a mini program or an app?
2. Who would file? An existing mainland company, a partner, a person with a mainland ID, or yourself with a passport, depending on the province?
3. Would it take payments in China? This decides whether B25 matters.
4. Should China data stay fully separate from the overseas deployment? I recommend yes.
