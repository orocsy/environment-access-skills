# stack-setup: design

Status: draft for owner approval, 7 Nov 2026. Research: [Automated stack provisioning for agents](../../reports/Automated%20stack%20provisioning%20for%20agents.md).

## What it is

A skill in this repo that sets up one app's stack from a short file in that app's repo. The owner picks a provider for each job (hosting, database, email, payments, sign-in, DNS). The agent does everything an API or CLI allows. The owner is left with only:

- signing in once per machine;
- approving access;
- accepting terms;
- paying;
- the few console buttons a provider refuses to let an agent press.

Two apps never get identical deployments, because each app's file names its own providers. What every app shares is the adapters, one per provider, and the rules.

It is not a deploy tool. Shipping code stays with each app's CI (for WiggleTrail, merge to main → image → deploy). stack-setup prepares what that CI needs: accounts, DNS, keys, secrets and webhooks.

## Why our own, not an existing product

- **Stripe Projects** can't be copied: its orchestrator API is invite-only. It also can't carry this stack. It skips AWS, GitHub secrets, Google sign-in, Stripe Connect settings and the server env file, and says it leaves production hosts to you.
- **Vercel Marketplace** only fills Vercel projects. The API server on EC2 would get nothing.
- **Terraform/Pulumi** handle Cloudflare, Vercel, GitHub and AWS well. They miss the parts that cost time:
  - the human steps;
  - secrets shown only once;
  - wiring between providers (Resend records into Cloudflare, the API URL into a Stripe webhook, the signing secret into GitHub and the server).

  Some secrets would also sit in their state file.

So we borrow their shapes instead:

| Borrowed from | What we take |
|---|---|
| Stripe Projects and Vercel | The object model: connection → resource → credential |
| Stripe and Vercel | The human-handoff payload: reason, link, code, expiry |
| Stripe | A committed state file that holds IDs and never secrets |
| Railway and Terraform | A dry-run plan before apply |
| Vercel and Neon | "The agent provisions, the human claims" where a provider offers it |

A provider's own umbrella can still be used inside an adapter when it is the shortest path, for example `vercel integration add` for a Marketplace database.

## The four parts

### 1. `stack.yaml`, committed in each app repo

The file says what the app wants, never secrets. Each capability names a provider and promises the app a fixed set of env var names, so app code doesn't change when the provider does. Example: [example.stack.yaml](example.stack.yaml).

```yaml
app: wiggletrail
domain: wiggletrail.com
capabilities:
  dns:      { provider: cloudflare, registrar: godaddy }
  api_host: { provider: aws-ec2-docker, region: ap-southeast-2, ingress: cloudflare-tunnel, hostname: api }
  web:      { provider: vercel, projects: [console, storefront] }
  database: { provider: docker-postgres, on: api_host }
  email:    { provider: resend, subdomain: mail, region: ap-northeast-1, sender: no-reply }
  payments: { provider: stripe, mode: sandbox, connect: oauth }
  signin:   { provider: google-oauth, surfaces: [api, console] }
  ci:       { provider: github, repo: orocsy/coachflow }
secrets:
  canonical: { type: server-env, host: api_host, path: ~/coachflow/coachflow.env }
  mirrors:   [ { type: github-secret, name: COACHFLOW_ENV } ]
  vercel:    [ { name: API_URL, from: api_host.url } ]   # config values, not secrets
```

A second app might say `database: { provider: neon }`, `signin: { provider: clerk }` and `api_host: { provider: render }`. The same runner then uses different adapters.

### 2. `.stack/state.json`, committed beside it

It records every resource ID and key ID the adapters created or found, the status of each human step, and when each item was last verified. No secret values. Re-runs read it to update instead of re-creating; `import` fills it from resources made by hand. For WiggleTrail that means the Cloudflare zone, tunnel and record IDs, the EC2 instance and Elastic IP, the Resend domain and key IDs, the Stripe webhook IDs, and the Google project and client ID.

### 3. Adapters: one folder per provider, one contract

Each adapter exports the same six steps, taken from the umbrellas' model:

| Step | Does | Example (Resend) |
|---|---|---|
| `connect` | Checks or starts the once-per-machine login; tokens stay in the provider CLI's own keychain storage | `resend login --web --profile <app>` |
| `provision` | Gets or creates by a natural key, so re-runs are safe | the domain `mail.<domain>` |
| `mint` | Creates a narrow runtime key | `sending_access` key limited to that domain |
| `sync` | Pipes the value to the canonical secret store, then to the mirrors | stdin → server env → `gh secret set` |
| `verify` | Probes by metadata only, never by printing a value | domain `verified`; the key present on the server |
| `gates` | Returns the human steps it can't do, as data | none for Resend |

Adapters can hand outputs to each other. The Resend adapter outputs DNS records, the Cloudflare adapter writes them, and Resend's verify then polls. The runner orders the steps from these links.

Each adapter calls the provider's official CLI with JSON output where one exists, otherwise its REST API with the CLI's stored token. Node 22 built-ins only, like `secure-key-handoff`.

### 4. The gate ledger

Every human step becomes one item, stored in the state file:

| Field | Meaning |
|---|---|
| type | `consent` (sign in or approve access), `terms`, `money`, `console` (a button the provider keeps for humans), `identity` (KYC, D-U-N-S), or `time` (waiting for DNS or review) |
| link | Deep link to the exact console page |
| prefill | Every value pre-computed, ready to copy (names, redirect addresses, emails) |
| receive | Names of the secrets the human will hand back, collected through `secure-key-handoff` or a download picked up by pipe; never chat |
| probe | A check that closes the item without taking the human's word |
| status | `open`, `waiting`, `done` or `skipped`, with when and who |

Gates come in three bundles so the owner is interrupted at most three times:

1. **Pre-flight, once per machine or new account:** every CLI login and access approval for the chosen providers, before any work.
2. **Per app:** the console-only steps, each pre-filled. The Google client gets its redirect addresses, and the home page and privacy policy go live first, so it can be published right away. The Stripe Connect redirect follows the same pattern.
3. **Go-live:** Google publishing and brand verification, Stripe identity checks and live keys, Apple keys, and AWS plan upgrades.

## Commands

```text
stack connect      run the pre-flight bundle: list, start and check every login
stack plan         show what will be created, changed or left alone, plus open gates (no changes)
stack apply        do the plan in order; pause at a gate, resume where it stopped
stack gates        list open gates with links and pre-filled values
stack verify       probe everything; report green/red per item
stack sync         copy the canonical secrets to every mirror again
stack rotate <key> mint a new key, sync it, verify, then revoke the old one at the issuer
stack import       record resources that already exist (made by hand) into state
stack doctor       check CLIs, versions, logins and deadlines
```

`apply` writes a dated entry to the app's deploy log. In WiggleTrail that is `docs/deploy/deploy-execution.md`, the same record this session kept by hand.

## Rules built in

- The agent's management login may be broad but revocable. Runtime keys are always minted narrow: send-only, one domain, one zone, restricted.
- Secrets move by pipe or stdin only. Never on a command line, never `echo`, never printed, never in chat. Checks report names, counts and prefixes only.
- A secret never goes in a `NEXT_PUBLIC_` variable. Public values go into Vercel as config type.
- Terms are accepted by the owner, never by the agent clicking or passing `--accept-tos` on their behalf. Every purchase is confirmed in chat with item, term and price.
- Destructive changes need a plan shown first and an explicit `--confirm`. Nothing is deleted when it disappears from the file.
- Revocation happens at the issuer, not just by deleting a local token.
- Every provider deadline lives in `stack doctor`. Current ones: Stripe MCP needs agent-tagged keys by 30 Nov 2026; Railway's old config files stop on 1 Dec 2026; Cloudflare's registrar API is beta.

## What this session proves, mapped to the design

| Done by hand in this session | stack-setup equivalent | Gate type left to the owner |
|---|---|---|
| AWS account, EC2 t3.micro, swap, Elastic IP, security group | `aws-ec2-docker` provision | consent (`aws login`, 12 h); money (the account, once) |
| Cloudflare zone, tunnel, `api` CNAME, nameservers at GoDaddy | `cloudflare` provision | consent (API token through handoff); console (nameservers at GoDaddy) |
| Box env, `COACHFLOW_ENV`, API recreate | `sync` canonical → mirrors | none |
| Vercel `API_URL` / `NEXT_PUBLIC_API_URL`, redeploys | `vercel` sync (config type) | consent (`vercel login`) |
| Stripe sandbox keys, webhooks edited in place | `stripe` provision and verify | consent; console (Connect OAuth on, client ID, redirect) |
| Stripe Connect test provider and round trip | `stripe` verify (connect probe) | console ("Use blank account") |
| Resend domain, four DNS records, send-only key, test send | `resend` + `cloudflare` | consent (OAuth approval) |
| Google project, consent screen, web client, secret into prod | `google-oauth` gate with prefill + pickup | terms; console (client creation); go-live (publish) |

## First build (to approve)

1. **M1: inventory and verify (read-only).**
   - Build the schema, state, runner, gate ledger, and `verify`, `import`, `gates` and `doctor`.
   - Write adapters that only probe: Cloudflare, AWS, Vercel, GitHub, Resend, Stripe, Google.
   - Done when WiggleTrail's real `stack.yaml` and `state.json` show every item green, plus the two open gates (Google publish, iOS sign-in config).
2. **M2: provision, mint and sync** for Cloudflare DNS, Resend, GitHub, Vercel and the server env. Done when the WiggleTrail email domain could be rebuilt from scratch in a throwaway subdomain, then removed.
   - Done 9 Nov 2026: `stackproof.wiggletrail.com` was built live (domain, 4 DNS records, verification, send-only key, local store, GitHub mirror), sent a delivered email, then torn down with the key revoked. WiggleTrail's own `plan` showed nothing to change.
3. **M3: Stripe and Google.** Stripe webhooks, Connect checks and restricted-key gates; the Google gate with prefill and secret pickup; AWS host bootstrap reusing `infra/ec2-bootstrap.sh`.
4. **M4: a second, different app (KidsBuddy)** with at least two different providers, to prove the "never identical" goal.

Tests follow this repo's style: `node --test`. Adapters are tested against recorded CLI and API JSON with synthetic values, with no live calls in tests. Live checks only ever run `verify`.

## Owner decisions (7 Nov 2026)

1. **Canonical secret store: choosable per app.** `secrets.canonical.type` is `server-env` (a file on the API host, today's WiggleTrail setup) or `1password` (a vault item). Mirrors and checks work the same way for both.
2. **Language: clear, easy English** that agents and people can both follow. The README keeps a short Chinese summary.
3. **WiggleTrail's real `stack.yaml` lives in the backend repo**, under `infra/stack/`, because its IDs don't belong in this public repo.

Terraform/OpenTofu was weighed against this design in [terraform-comparison.md](terraform-comparison.md). The verdict is hybrid: stack-setup orchestrates, and OpenTofu may later run inside some adapters.

## More than one kind of stack (10 Nov 2026)

One app can have several deployments, each with its own stack file. Their providers can be completely different: Vercel and AWS for one, Tencent CloudBase or Lighthouse servers for a China mainland one. A top-level `jurisdiction:` loads a **compliance pack**: an interview, validation rules and guided steps for that place's filings.
- Guided steps for long human flows, one screen at a time: [guided-setup.md](guided-setup.md).
- China mainland (Tencent CloudBase or servers, ICP, police filing, mini programs, WeChat Pay and sign-in, PIPL): [china-mainland.md](china-mainland.md), with a synthetic [example-cn.stack.yaml](example-cn.stack.yaml).
- One sign-in per provider, with the agent minting everything else, and an agent inbox for confirmation emails: [one-login.md](one-login.md).
