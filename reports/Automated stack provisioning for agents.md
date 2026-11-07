# Build your own orchestrator, borrow the umbrellas

No single product sets up a whole small-SaaS stack from start to finish. The 2026 umbrella platforms get close, but only inside their own walls. **Stripe Projects** turns one Stripe sign-in into accounts, paid plans and `.env` credentials at more than 60 providers. **Vercel's Marketplace** creates provider accounts from a signed identity token and puts the secrets straight into Vercel environment variables. Each one stops at its own edge. Stripe Projects says outright that it does not push credentials to production hosts. Vercel only feeds Vercel projects. PaaS manifests stop at their own compute and databases. Terraform and Pulumi cover Cloudflare, Vercel, GitHub and AWS well, cover Resend, Clerk and Apple only through tiny community providers, and cannot create a Google OAuth client at all. Agents can now keep lasting, scoped access. CLI browser or device logins store refreshable tokens in the OS keychain (AWS's 12-hour cap is the exception). Narrow runtime keys can be minted by API and piped on stdin into `gh secret set`, `vercel env add` or a server env file written over `ssh`, so the values never pass through chat. What still needs a human is a short, stable list: account sign-up, terms, payment methods, KYC, Google's consent screen and web client, Apple enrolment and keys, Stripe's Connect profile and live keys, and paid domain purchases. The best products handle these steps in one of four ways. They avoid them during development, defer them to a claim link, hand them to an OAuth consent screen, or pre-compute every value so the human only pastes and clicks. For a founder whose apps share a shape but not a provider list, the answer is neither cloning an umbrella nor building on one. It is a thin orchestrator of your own: a per-app stack manifest, provider adapters that share one contract, and a ledger of human gates. It borrows the umbrellas' object model and calls them as adapters only where they are the shortest path.

## One sign-in reaches 60-plus providers, but every umbrella stops at its own walls

**Stripe Projects** comes closest to "pick products once". It is a Stripe CLI plugin, announced as a developer preview on **26 March 2026** with ten providers ([stripe.dev](https://stripe.dev/blog/production-ready-dev-stack-from-terminal)). Its docs now list **60+ providers** across hosting, databases, auth, email, analytics, AI and domains, including Vercel, Cloudflare, Resend, Supabase, Neon, Render, Railway, Fly.io, Clerk, Auth0, WorkOS, Upstash and Twilio ([Stripe docs](https://docs.stripe.com/stripe-projects)).

The mechanism is identity federation. Stripe attests to the signed-in user's identity. If no account exists, the provider creates one and returns an API token. If an account exists, the provider runs a standard OAuth flow to grant the CLI access ([Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects)). The payment method is stored once on the Stripe account. On a paid plan, Stripe mints a **Shared Payment Token** for that provider. Spend limits apply **per provider**, not as a shared budget, so three providers under a 100 GBP global limit can together spend 300 GBP ([Stripe docs](https://docs.stripe.com/stripe-projects)).

Credentials go into an encrypted local vault and the Stripe Secret Store, then into `.env` files with `600` permissions. A committed `.projects/state.json` lets each teammate link their own provider accounts. Stripe calls this "a local credential cache, not a shared secrets distribution system" ([Stripe docs](https://docs.stripe.com/stripe-projects)).

Two limits matter for a production stack. First, the docs say you must add the credentials to your production host yourself: "Stripe Projects doesn't automate this step" ([Stripe docs](https://docs.stripe.com/stripe-projects)). Second, during the developer preview, paid-tier payment handoff worked only in the **US, EU, UK and Canada** ([stripe.dev](https://stripe.dev/blog/production-ready-dev-stack-from-terminal)). A founder billing from elsewhere, Australia for example, should check the current paid-tier country page first. Its status is also unsettled: sources variously say "developer preview", "open beta" and "public preview", and the current docs carry no label.

Stripe Projects is built with agents in mind, and its handling of the human step is the template others follow. It has `--json`, `--no-interactive` and `--accept-tos` flags. Its written agent rule is: "If the CLI opens a browser for authentication, stop and clearly tell the user to complete sign-in." To keep browser pop-ups out of an agent session, Stripe recommends this order: sign in, run `stripe projects link` for each provider, run `stripe projects billing add`, and only then start the agent ([Stripe docs](https://docs.stripe.com/stripe-projects)).

Developers can use the CLI freely, but providers join only through a Stripe intake process. Platforms that want to *be* the orchestrator in Stripe's place need the **Provisioning API**. It is allowlisted private preview (`Stripe-Version: 2026-09-30.preview`) and exposes the object model clearly:

1. A `provider_connection_request`. Its `pending_auth` status returns a `redirect_url` for a browser step.
2. A `resource`.
3. A `reveal_access_configuration` call that returns values such as `DATABASE_URL`.

The preview has no webhooks and no caller idempotency, and `livemode` defaults to true, which means real charges ([Stripe platform integration](https://docs.stripe.com/projects/platform-integration)). The provider-side protocol that Cloudflare and Neon implement is still unpublished. In April, Cloudflare said a "more official specification" would come "soon" ([Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects)).

**Vercel Marketplace** is the most fully documented umbrella, because its whole provider contract is public. The provider implements a **Partner API**, and Vercel calls it with OIDC JWTs signed by Vercel. The tokens carry `user_email` "for all Marketplace integrations by default" ([Vercel Partner API](https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner)). The first time a user picks a provider's product, they accept that provider's terms once in a Vercel modal. Vercel then calls `PUT /v1/installations/{id}`, and the provider upserts a user and account from the token claims, so no separate signup is needed ([Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)).

`POST .../resources` must return the secrets synchronously, with optional per-environment overrides, and Vercel turns them into project env vars for the environments the user connects ([Vercel: Provision Resource](https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner/provision-resource)). Billing runs through Vercel, except for imported "linked" resources. Rotation started on the provider side updates env vars but **does not redeploy** ([Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)).

The CLI is explicitly built for agents. `vercel integration add <slug>` installs the integration, provisions the resource, connects it and pulls env vars. In non-interactive mode it emits structured `outputActionRequired` payloads with a `verification_uri` instead of failing ([Vercel CLI](https://vercel.com/docs/cli/integration)). Even so, `vercel integration accept-terms` "requires an interactive terminal and human confirmation" ([Vercel CLI](https://vercel.com/docs/cli/integration)). The catch for this reader is that these env vars reach only Vercel projects. An API running on EC2 gets nothing, and the provider accounts are shadow accounts that the human reaches through Vercel SSO.

A third pattern skips the account step entirely: **provision first, claim later**. Each example below creates real resources without a human account and hands over a claim link with a short deadline.

| Product | How it provisions without a human account | Claim window | Notable limits |
|---|---|---|---|
| Cloudflare `wrangler deploy --temporary` / REST API | Anonymous temporary account; REST callers solve a proof-of-work and must display and collect ToS acceptance | **60 min** | workers.dev only, one 100 MB D1; claiming "does not grant the platform permanent access" ([Cloudflare docs](https://developers.cloudflare.com/workers/platform/claim-deployments/)) |
| Claimable Neon (auth.md) | Anonymous project via `POST /v1/agent/identity` and a JWT-bearer token | 15-min code, **72 h** project | 100 MB; claiming revokes the project's credentials, so the agent must re-fetch `DATABASE_URL` ([Neon docs](https://neon.com/docs/reference/claimable-postgres)) |
| Supabase for Platforms | Projects created in the *platform's* org via the Management API, then an OAuth project-claim | Not stated | Full feature set only for "select AI Builders"; the platform keeps OAuth access after the transfer ([Supabase docs](https://supabase.com/docs/guides/integrations/supabase-for-platforms)) |
| Neon platform transfer | Project in the platform's org plus a one-time transfer request | 24 h default | Private preview; can't transfer into Vercel-managed orgs ([Neon docs](https://neon.com/docs/workflows/claimable-database-integration)) |
| Vercel Claim Deployments | Agent deploys and provisions on its own team, then requests a transfer | **24 h** code | Resource transfer supported for Neon, Supabase and Prisma ([Vercel docs](https://vercel.com/docs/deployments/claim-deployments)) |

Accountless flows avoid the payment step only by staying within free quotas. Anything paid still needs an authenticated orchestrator that holds a stored payment method. And because claim URLs work as bearer credentials, they need to be handled like secrets.

Under all of this sits one real effort at an open standard and one promised one. **auth.md** is an MIT-licensed protocol that WorkOS launched on **21 May 2026**. It composes existing OAuth pieces: RFC 9728 discovery, RFC 7523 JWT-bearer grants, the IETF ID-JAG draft, and an RFC 8628-style claim ceremony. It lists about 19 adopters, and Neon runs a live implementation ([WorkOS blog](https://workos.com/blog/agent-registration-with-auth-md); [workos.com/auth-md](https://workos.com/auth-md)). Adoption is thinner than the logo wall suggests. Resend's own auth.md describes only a key "the user issues" from its dashboard ([resend.com/auth.md](https://resend.com/auth.md)). The endpoint names also differ between WorkOS's blog and its repo ([GitHub: workos/auth.md](https://github.com/workos/auth.md)).

The practical lesson is that **you cannot become an orchestrator without partner deals**. Stripe's Provisioning API is allowlisted, and a provider has to implement Vercel's Partner API before Vercel can call it. What you *can* copy is the object model and the way each product presents the human step.

## Manifests and IaC converge infrastructure, then stop at DNS, email, payments and OAuth

PaaS manifests declare compute, managed databases, caches and env vars on their *own* platform. Some also generate secrets. None of them creates records at an outside DNS host, an email-sending domain, a Stripe object or an OAuth client.

**Render Blueprints** are the most mature. `generateValue: true` creates a random 256-bit secret. `sync: false` prompts for a value, but "only during the initial Blueprint creation" ([Render Blueprint spec](https://render.com/docs/blueprint-spec)). Syncs overwrite conflicting edits made in the dashboard and recreate resources deleted by hand. Removing a definition from the file does *not* delete the resource, except for Postgres read replicas ([Render IaC](https://render.com/docs/infrastructure-as-code)).

**Railway** shows how quickly this layer churns. Its `railway.toml`/`railway.json` Config as Code is deprecated, and those files stop being read on **1 December 2026** ([Railway Config as Code](https://docs.railway.com/reference/config-as-code)). The replacement is a project-level `.railway/railway.ts` with a real `plan`/`apply` loop. It rejects stale plans, gates destructive changes behind `--confirm-destructive`, and keeps secret values on Railway through `preserve()` references ([Railway IaC](https://docs.railway.com/infrastructure-as-code)).

**Heroku's** `app.json` is processed "only... when creating a new app, not when re-deploying one" ([Heroku schema](https://devcenter.heroku.com/articles/app-json-schema)). **Fly's** `fly launch --db` is a scaffolder, not a converging manifest ([flyctl launch](https://docs.fly.io/flyctl/launch)). For a stack built on a self-managed EC2 box, Cloudflare and Vercel, no manifest covers more than the hosting slice.

General-purpose IaC goes further. The provider landscape on 7 November 2026 splits cleanly into mature, young and missing:

| Service | Best Terraform/OpenTofu provider | Maturity | What it means for a setup skill |
|---|---|---|---|
| Cloudflare | `cloudflare/cloudflare` 5.28.1 | Vendor, ~391M downloads | DNS records, zones, Tunnel resources, Turnstile, email routing are all declarative |
| Vercel | `vercel/vercel` 5.26.0 | Vendor | Projects, domains, env vars (with write-only `value_wo`) |
| GitHub | `integrations/github` 6.13.0 | Vendor | Actions and environment secrets |
| AWS | `hashicorp/aws` 6.72.0 | Official | EC2, Route 53, SES |
| Stripe | `stripe/stripe` **0.3.0** | Vendor, auto-generated, created Jan 2026 | Webhooks, products, prices; **no Connect account-settings resource** |
| Resend | `jhoward321/resend` 0.2.0 | Community, **1 star** | Too thin to depend on |
| Neon | `kislerdm/neon` 0.18.0 | Community; Neon says it does not maintain or support it | Use with care |
| Clerk, Apple | Community repos with 3–5 stars | Community | Effectively manual |
| Google OAuth client | None possible | n/a | Console-only |

Sources: [Terraform Registry API](https://registry.terraform.io/v1/providers/stripe/stripe), [Stripe provider repo](https://github.com/stripe/terraform-provider-stripe), [Neon Terraform reference](https://neon.com/docs/reference/terraform), [Resend community repo](https://github.com/jhoward321/terraform-provider-resend).

The Google row is the most important. The IAP OAuth Admin API, the only programmatic route to an OAuth client, was deprecated on **22 January 2025**, and "you can no longer create or manage custom OAuth clients" through it ([Google IAP migration](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)). The gcloud reference gives **19 March 2026** as the permanent shutdown date ([gcloud iap oauth-clients](https://cloud.google.com/sdk/gcloud/reference/iap/oauth-clients/describe)). The newer `gcloud iam oauth-clients` serves only Workforce Identity Federation, not "Sign in with Google" ([gcloud iam oauth-clients create](https://docs.cloud.google.com/sdk/gcloud/reference/iam/oauth-clients/create)).

**SST v3** puts a single TypeScript file in front of the same Pulumi- and Terraform-bridged providers, so its coverage is the same as the table ([SST providers](https://sst.dev/docs/providers)). **CDKTF** was archived on **10 December 2025** ([hashicorp/terraform-cdk](https://github.com/hashicorp/terraform-cdk)).

IaC's hidden cost is that secrets end up in state. Terraform 1.11 and OpenTofu 1.11 added write-only arguments that "are not stored in Terraform artifacts like the plan or state file" ([HashiCorp](https://www.hashicorp.com/blog/terraform-1-11-ephemeral-values-managed-resources-write-only-arguments)). Coverage still depends on each provider adopting them:

- **Vercel** has `value_wo`.
- **GitHub's** `actions_secret.value` is marked sensitive, but "this does not hide it from state files" unless you pass a value pre-encrypted with the repo key ([GitHub provider](https://github.com/integrations/terraform-provider-github/blob/main/docs/resources/actions_secret.md)).
- **Stripe's** webhook signing `secret` is "Only returned at creation", so it lives in state ([Stripe provider](https://github.com/stripe/terraform-provider-stripe/blob/main/docs/resources/webhook_endpoint.md)).

OpenTofu's client-side state encryption helps, but it "does not and cannot protect the sensitive values in the state file from the person running the `tofu` command" ([OpenTofu](https://opentofu.org/docs/language/state/encryption/)). When that person is an agent, this matters.

In return, IaC gives you convergence, which hand-run scripts lack:

- A no-change re-run does nothing.
- `plan -refresh-only` or `pulumi refresh --preview-only` detects drift.
- `import` blocks with `-generate-config-out`, or `pulumi import`, adopt resources made by hand ([Terraform](https://developer.hashicorp.com/terraform/language/import/generating-configuration); [Pulumi](https://www.pulumi.com/docs/iac/guides/migration/import/)).

Practitioner evidence on whether a solo founder needs this is anecdotal and split. One camp says a single VPS is better served by "an Ansible playbook plus a shell script" ([Pickuma](https://pickuma.com/for-dev/infrastructure-as-code-solo-founders/)). The other says the cost of skipping IaC rises once there are real users or a second environment ([Aetherisys](https://aetherisys-consulting.netlify.app/blog/infrastructure-as-code-from-day-one)). Neither is rigorous. The churn record is better evidence: CDKTF archived, Railway's forced migration, the Fly provider unreleased since June 2023, and Google's OAuth API removed. Each layer you depend on is a layer that can change under you.

## Agents keep access through keychain logins and pipe narrow keys past the chat

By November 2026, lasting agent access is mostly solved at the CLI layer. Nearly every provider now runs a browser or device OAuth login that stores a refreshable credential, so one human approval keeps an agent working until the grant is revoked or its refresh token lapses:

| Provider | Login | Where the credential lives | Lifetime and caveats |
|---|---|---|---|
| GitHub | `gh auth login --web` | System credential store by default; plain text if none | `--expiring` opts into auto-refreshed tokens ([gh manual](https://cli.github.com/manual/gh_auth_login)) |
| Vercel | `vercel login` (OAuth device flow since 12 Sep 2025) | Not stated in fetched docs | Email and `--github` login methods removed in 2026 ([Vercel changelog](https://vercel.com/changelog/new-vercel-cli-login-flow)) |
| Stripe | `stripe login --non-interactive`, then `--complete=<poll-url>` | OS secure store, self-refreshing | From v1.50.0 an admin must first enable "MCP and CLI access" ([Stripe CLI login](https://docs.stripe.com/cli/login)) |
| Cloudflare | `wrangler login --use-keyring --scopes …` | **Plaintext TOML by default**; encrypted with `--use-keyring` | Auto-refresh; `CLOUDFLARE_API_TOKEN` overrides ([Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/general/)) |
| Resend | `resend login --web` | OS keychain since **2.7.0** (July 2026) | Callback must reach `127.0.0.1` on the same machine ([resend-cli PR #320](https://github.com/resend/resend-cli/pull/320)) |
| Supabase / Neon | `supabase login` / `neon login --keyring` | Native store / opt-in keyring | Env-var tokens for CI ([Supabase](https://supabase.com/docs/reference/cli/supabase-login); [Neon](https://neon.com/docs/cli/login)) |
| AWS | `aws login` (CLI 2.32.0+) | `~/.aws/login/cache` | **Maximum 12 hours**, then a human again ([AWS](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)) |
| Apple | No login; `.p8` key plus self-signed JWT | Wherever you keep the `.p8` | JWT lasts 20 minutes, or up to six months for scoped GET-only tokens ([ASC tokens](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)) |

Stripe's `--non-interactive` mode is the cleanest agent handoff found. It prints `browser_url`, `verification_code` and a `next_step` command as JSON, so the agent relays a link, the human clicks Approve, and no secret ever crosses the conversation ([Stripe CLI login](https://docs.stripe.com/cli/login)).

One login deserves a warning. `cloudflared tunnel login` downloads a `cert.pem` that is **account-wide**: it can create and delete every tunnel on the account, it is valid for at least ten years, and its token works until revoked. A per-tunnel credentials file, by contrast, can only run that one tunnel ([Cloudflare tunnel permissions](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/tunnel-permissions/)).

Remote MCP servers are the other access path. They use OAuth 2.1 with PKCE and resource indicators. The **2026-07-28** spec revision deprecates Dynamic Client Registration in favour of Client ID Metadata Documents ([MCP changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). Stripe, Vercel, Supabase, Neon, Cloudflare, GitHub and AWS all run official servers.

These grants are usually **user-equivalent**: Vercel says connecting "grants the same access as your Vercel user account" ([Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)). Real scoping comes from server-side knobs, not from client-side tool approval. Examples are Supabase's `project_ref` and `read_only` parameters, Neon's `projectId` and `readonly`, and Stripe's per-environment consent ([Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp); [Neon MCP](https://github.com/neondatabase/mcp-server-neon)).

Two details matter for tooling:

- **Stripe deadline.** From December 2026, Stripe MCP stops accepting full-access secret keys and restricted keys without the Agent tag. The migration deadline is **30 November 2026** ([Stripe MCP](https://docs.stripe.com/mcp)).
- **Claude Code revocation.** `claude mcp remove` deletes local tokens but does **not** revoke them at the authorization server. `claude -p` and Agent SDK runs cannot complete OAuth at all ([Claude Code MCP](https://code.claude.com/docs/en/mcp)).

Lasting control-plane access is only half the design. The other half is **minting narrow runtime credentials**, and most providers now allow it:

- **Resend.** `POST /api-keys` issues a key with `sending_access` only, optionally limited to one domain ([Resend API](https://resend.com/docs/api-reference/api-keys/create-api-key)).
- **Cloudflare.** Tokens can be created by API, scoped to one zone, bound to the server's IP range and given an `expires_on` date ([Cloudflare token API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)).
- **GitHub.** App installation tokens expire after an hour and can be narrowed per repository ([GitHub App tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)).
- **AWS.** GitHub Actions can assume a role through OIDC with no stored keys at all. Repos created after **15 July 2026** use a new subject format that includes IDs, which trust policies must match ([GitHub OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)).
- **Stripe is the exception.** Restricted and Agent-tagged keys are created on the Dashboard's API keys page, a secret key needs an email or SMS verification code, and live keys are shown once ([Stripe keys](https://docs.stripe.com/keys)). I found no public API for creating them on your own account.

Delivery without chat works because every main destination accepts stdin.

**GitHub.** `gh secret set NAME` reads the value from stdin and encrypts it locally before upload. A new `--app agents` target makes a secret available to agent sessions ([gh secret set](https://cli.github.com/manual/gh_secret_set)).

**Vercel.** Since **August 2026**, Vercel classifies env vars as **Config** (readable after saving) or **Secret** (write-only after saving). `vercel env add NAME production < file` takes the value from stdin, and the old `--visibility` flag is deprecated ([Vercel env types](https://vercel.com/docs/environment-variables/sensitive-environment-variables); [vercel env CLI](https://vercel.com/docs/cli/env)). Vercel's own docs warn that `echo value | vercel env add` saves the value in shell history, yet their examples pass `--value "sk_live_..."` on the command line, which exposes it in argv ([vercel env CLI](https://vercel.com/docs/cli/env)). Build logs redact Secret values only when they are 32 or more characters long ([Vercel env types](https://vercel.com/docs/environment-variables/sensitive-environment-variables)).

**A server's env file.** No engine has a first-class resource for it. My inference is that the safe options are to pipe into `ssh host 'umask 077; cat > .env'`, or to have the server pull from a secret store at boot or deploy time. Afterwards, confirm by metadata only: `gh secret list`, `vercel env ls`, or a remote count of matching lines. Never print the value.

The security guidance converges on one point: **the storage location matters less than least privilege and short lifetimes**. A secondary report of Silverfort research found Claude Code's keychain item readable by any process running as the same user ([Let's Data Science](https://letsdatascience.com/news/claude-code-keychain-design-exposes-oauth-credentials-268ba827)). 1Password warns that same-user processes can read another process's environment ([1Password](https://www.1password.dev/cli/secrets-environment-variables/)).

Simon Willison's "lethal trifecta" names the configuration to avoid: an agent that combines private data, untrusted content and an outbound channel ([Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)). Providers have responded with server-side gates. Stripe's Agent-tagged keys fall automatically under approval rules for payouts, refunds and configuration changes. Refunds and money movement require a Dashboard approval link that expires after 24 hours ([Stripe MCP](https://docs.stripe.com/mcp)).

## About a dozen human gates survive, and the best products defer, delegate or pre-compute them

The gates that resist automation are few, and most are legal, financial or identity acts, not technical ones.

**Google is the hardest single gate for an app with Google sign-in.** No supported API remains for creating an external consent screen or a standard Web OAuth client. The console path is now Google Auth Platform, then Clients, then Create client, and the app must be registered for Google Auth before any client exists ([Google Cloud Help](https://support.google.com/cloud/answer/15549257)).

Testing status caps an app at 100 test users, and their authorisations and refresh tokens expire seven days after consent ([Google Cloud Help](https://support.google.com/cloud/answer/15549945)). An excerpt of the same article suggests apps requesting only the basic `openid`/email/profile scopes are exempt. Clerk's guide says the opposite, so this is unresolved ([Clerk](https://clerk.com/docs/authentication/social-connections/google)).

Publishing with a name or logo triggers brand verification. It requires:

- a public home page,
- a privacy policy on the same domain,
- authorised domains verified in Search Console by a project Owner or Editor.

Automated checks take "a few minutes", and manual review takes 2–3 business days ([Google brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). Hosted auth helps only partly. Clerk's development instances use shared Google credentials, but production "must provide custom credentials", which sends you back to the console ([Clerk](https://clerk.com/docs/authentication/social-connections/google)).

**Apple is a legal-identity gate.** Enrolment needs:

- an Apple Account with 2FA,
- your legal name,
- for organisations, a D-U-N-S number and binding authority,
- a public website on the organisation's domain,
- acceptance of the licence agreement and the **99 USD a year** fee.

None of this can be done by API ([Apple enrolment](https://developer.apple.com/programs/enroll/)). Once enrolled, the App Store Connect API can register bundle IDs and switch capabilities on and off ([ASC Bundle ID Capabilities](https://developer.apple.com/documentation/appstoreconnectapi/bundle-id-capabilities)). The team key that unlocks the API "is available for download a single time" ([App Store Connect Help](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api)). Sign in with Apple's web Services ID and return URLs are documented only as portal steps ([Apple](https://developer.apple.com/help/account/configure-app-capabilities/configure-sign-in-with-apple-for-the-web)).

**Stripe automates more than anyone but deliberately keeps four steps human:**

1. The account application (KYC).
2. Live restricted keys, created in the Dashboard.
3. The Connect platform profile, a questionnaire plus a liability acknowledgement that must be completed before live connected accounts can be created ([Stripe Express accounts](https://docs.stripe.com/connect/express-accounts)).
4. Connect OAuth redirect URIs, which must be registered in the Dashboard and match exactly ([Stripe OAuth reference](https://stripe.com/docs/connect/oauth-reference)).

There is a useful sign here. Stripe's Express OAuth page is marked deprecated, says OAuth is not available for new Connect platforms, and recommends the Accounts API instead ([Stripe Express OAuth](https://docs.stripe.com/connect/oauth-express-accounts)). Stripe Atlas states the house pattern most clearly: through MCP, the agent prepares the company-formation application, and the human "reviews documents, pays, signs and submits" ([Stripe MCP](https://docs.stripe.com/mcp)). Webhook endpoints, products and prices remain fully automatable.

**Domains have become purchasable by API, but only after the human sets up the account once.**

- **Cloudflare.** The Registrar API (beta, launched **15 April 2026**) needs a payment method, a default registrant contact, and the Domain Registration Agreement accepted in the dashboard. Registrations are **non-refundable**, and transfers, renewals and premium domains are not yet supported ([Cloudflare Registrar API](https://developers.cloudflare.com/registrar/registrar-api/); [Domain Name Wire](https://domainnamewire.com/2026/04/15/cloudflare-launches-domain-registration-api/)).
- **Vercel.** Domains can be bought through `POST /v1/registrar/domains/{domain}/buy` ([Vercel](https://vercel.com/docs/rest-api/domains-registrar/buy-a-domain)).
- **GoDaddy.** In April 2026, GoDaddy reportedly lowered its DNS-API eligibility from 10 domains to one ([GoDaddy](https://www.godaddy.com/resources/news/godaddy-dns-api-now-works-with-a-single-domain)).
- **Domain Connect.** It gives a one-click consent screen at DNS providers including Cloudflare, GoDaddy and Vercel ([domainconnect.org](https://www.domainconnect.org/dns-providers/)).

**Accounts, terms and payment methods are human by policy.** GitHub's terms say a human must create the account and that bot-registered accounts are not permitted ([GitHub ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)). The notable exception is **AWS Organizations `CreateAccount`**. Once a human-created management account with a payment method exists, member accounts are created entirely by API. Company details are cloned, `OrganizationAccountAccessRole` is preconfigured, and no new payment method is collected ([AWS CreateAccount](https://docs.aws.amazon.com/organizations/latest/APIReference/API_CreateAccount.html)).

Terms acceptance is more nuanced than "never automate". Stripe Projects offers `--accept-tos`. Cloudflare's temporary-account API takes `acceptTermsOfService: "yes"` but requires the *platform* to display the terms and collect acceptance ([Cloudflare](https://developers.cloudflare.com/workers/platform/claim-deployments/)). The flag carries a human's decision; it does not replace one.

**Email is mostly a time gate, not a human gate.** Resend's `POST /domains` returns the exact DKIM, SPF and DMARC records. `POST /domains/{id}/verify` starts verification, which often completes within 15 minutes and fails if the records are not detected within 72 hours ([Resend](https://resend.com/docs/api-reference/domains/verify-domain.md)). Gmail's bulk-sender rules (SPF and DKIM passing, a DMARC record at `p=none` or stricter, one-click unsubscribe for marketing mail) come from vendor summaries, not Google's own page ([Red Sift](https://redsift.com/blog/gmails-enforcement-ramps-up-what-bulk-senders-need-to-know)).

Across these products, the handling of each human step falls into a clear order, best first:

1. **Avoid the gate in development**: Clerk's shared Google credentials, Stripe sandboxes.
2. **Defer it into one claim link** that bundles sign-up, terms, KYC and billing. Stripe's claimable sandboxes route a single prefilled link through each pending step and renew it through a `refresh_url` ([Stripe claimable sandboxes](https://docs.stripe.com/sandboxes/claimable-sandboxes)).
3. **Delegate to provider-hosted OAuth or device consent** instead of copying tokens.
4. **Pre-compute and deep-link**: every value the human must type is shown beside a link to the exact console page.
5. **Secure paste-back** for secrets shown only once.
6. **Verify and poll** so the checklist ticks itself.
7. **Keep resumable state**, so a half-finished setup picks up where it stopped.

The machine-readable versions are converging on one shape: a reason, a URL, a code and an expiry. Examples are Vercel's `outputActionRequired` with a `verification_uri`, Stripe's `browser_url`/`verification_code`/`next_step`, and Neon's and auth.md's RFC 8628-style `user_code`/`verification_uri_complete` ([Vercel CLI](https://vercel.com/docs/cli/integration); [Stripe CLI login](https://docs.stripe.com/cli/login); [Neon](https://neon.com/docs/reference/claimable-postgres)). No published study compares drop-off between claim links and checklists, so this ranking is my reasoning from the designs, not measured outcomes.

## Build a manifest, adapters and a gate ledger rather than cloning an umbrella

The three options resolve cleanly.

**Copying an umbrella is not possible.** The orchestrator role depends on providers implementing your protocol, and Stripe's Provisioning API is allowlisted.

**Building on one leaves most of this stack uncovered.** Stripe Projects' catalogue covers Vercel, Cloudflare and Resend. It does not cover AWS EC2, GitHub Actions secrets, Google OAuth, Stripe's own Connect settings or a server env file. It explicitly leaves production hosts to you, its paid handoff was region-limited during the preview, and it is still in preview. Vercel Marketplace injects only into Vercel projects, so the NestJS API on EC2 would get nothing from it. Full IaC covers the four mature providers well. But the parts that actually cost the founder time sit entirely outside it: the human gates, the once-shown secrets, and the cross-provider wiring (Resend records into Cloudflare DNS; the API URL into a Stripe webhook; the signing secret into GitHub and the server).

So the skill should take **its own approach, assembled from borrowed parts**. It has four components.

### A per-app stack manifest picks providers per capability, not per template

The manifest is a small committed file. It names, for each capability (hosting, database, cache, email, payments, auth, DNS and registrar), the chosen provider and its options. Each capability promises the app a stable set of env var names, such as `DATABASE_URL`, `RESEND_API_KEY` and `STRIPE_WEBHOOK_SECRET`. That is what lets app two use Neon and Clerk while app one uses Docker Postgres on EC2 and Google sign-in, without the application code caring.

Beside it, a committed state file records provider resource IDs and never secret values. This copies Stripe Projects' committed `state.json` with an ignored vault ([Stripe docs](https://docs.stripe.com/stripe-projects)) and gives a script the "mini-state" that makes re-runs safe.

### Provider adapters share one contract copied from the umbrellas' object model

Each adapter implements the same six phases, mirroring Stripe's connection, resource and access-configuration chain and Vercel's install, provision and secrets contract:

1. **`connect`**: a once-per-machine human login stored in the keychain.
2. **`provision`**: get-or-create by a lookup key, such as a DNS name and type, a webhook URL, a Resend domain name or a price `lookup_key`.
3. **`mint`**: create a narrow runtime credential.
4. **`sync`**: pipe it to the declared destinations: GitHub, Vercel or the server.
5. **`verify`**: a metadata-only probe.
6. **`gates`**: the human steps the adapter cannot do, declared as data.

Destructive changes get Railway-style handling: a dry-run plan first, and an explicit confirmation flag ([Railway IaC](https://docs.railway.com/infrastructure-as-code)).

Inside an adapter, call whichever surface is shortest:

- the CLI with JSON output for most providers;
- `vercel integration add` when the app is Vercel-hosted and the chosen database or cache is a Marketplace product;
- `stripe projects add` when a new app picks a catalogue provider at which the founder has no account yet, since that is exactly the signup it removes.

The umbrellas become adapter back-ends, not the spine.

For the current stack, the adapters map as follows. Everything in the table is either sourced above or marked as inference.

| Capability | Adapter surface | Lasting agent access | Narrow runtime credential | Human gate |
|---|---|---|---|---|
| DNS, Tunnel | Cloudflare API | One API token in the keychain, or `wrangler login --use-keyring --scopes` | Zone-scoped token with IP condition and expiry; per-tunnel credential, not account-wide `cert.pem` | New domain: purchase confirmation in chat (non-refundable), or nameserver delegation at GoDaddy |
| Web hosting | Vercel CLI | `vercel login` device flow | Env vars written as type Secret from stdin | None after login |
| API host | AWS + SSH | `aws login` (12 h) | GitHub-OIDC deploy role, no stored keys; optional per-app member account via `CreateAccount` | Management account and card, once ever |
| Email | Resend CLI/API | `resend login --web` OAuth | `sending_access` key limited to the app's domain | None; DNS records go to the Cloudflare adapter, then poll |
| Payments | Stripe CLI/API | `stripe login --non-interactive` | Restricted key (Agent-tagged if an agent uses it), **created by a human** | New account, KYC, Connect profile, redirect URIs, live key |
| Google sign-in | None | n/a | Client ID and secret by secure paste-back | Auth Platform setup, client creation, publish and brand verification |
| CI secrets | `gh` | `gh auth login --web` | Values from stdin | None |

### A gate ledger turns every human step into one pre-computed, resumable item

Each declared gate gets a type (avoid, defer, delegate, pre-compute, confirm-money, or time), a deep link, every value pre-filled, the names of the secrets the human will paste back, a verification probe and a status. Adapter outputs that ask for a human, such as Vercel's `outputActionRequired`, Stripe's `next_step` or a Neon claim URL, are normalised into this one shape and relayed word for word, with expiry times shown.

The four clicks from the earlier session sort cleanly into this taxonomy.

The Resend OAuth approval and the Stripe account choice were **delegated-consent and account gates**. They belong in a **pre-flight bundle** run once per machine or per new account, before the agent starts, as Stripe recommends.

Google OAuth client creation and the Stripe Connect redirect are **console-only configuration gates** that recur for every app. The skill should pre-compute the JS origins and redirect URIs and deploy the home page and privacy policy on the verified domain *before* asking. It should then take the once-shown client secret back through a hidden-input handoff, never chat.

For new apps, it is worth testing whether Stripe's Accounts API path for connected accounts removes the redirect-URI step. Stripe steers new platforms there, but I did not verify this for every Connect account type.

The going-live steps (Google publish and brand verification, Stripe KYC and live keys, Apple keys) form a second **go-live bundle**. Until then, development runs on sandboxes and shared credentials wherever the chosen provider offers them.

### Guardrails and dates the skill should encode

The skill should hold to these rules:

- The control-plane login can be broad but revocable. Runtime keys are always minted narrow.
- Secrets move only through pipes and stdin, never `--body`, `--value` or `echo`.
- A secret never goes under a `NEXT_PUBLIC_` prefix.
- Production write credentials stay out of agent sessions that also browse or read email.
- Revocation happens at the issuer. `claude mcp remove` alone does not revoke.
- Terms flags such as `--accept-tos` are passed only after the human has seen and accepted the named agreement in chat.
- Every purchase is confirmed in chat with domain, term and price.

Three dates matter now. Stripe MCP needs Agent-tagged keys or OAuth by **30 November 2026**. Railway's old config files stop working on **1 December 2026**, which matters only if an app picks Railway. Cloudflare's Registrar API is still beta.

The design should be revisited if three things change. The first is Stripe publishing the provider protocol or opening the Provisioning API. The second is a new app moving its compute onto a platform with a converging manifest, such as Render or Railway. The third is the apps reaching real users and a second environment; then the Cloudflare, Vercel, GitHub and AWS adapters should be swapped for a flat OpenTofu configuration with encrypted state.

## Conclusion

The edge of automation is now set by law and money, not by APIs. Everything technical in this stack can be scripted: DNS, tunnels, env vars, CI secrets, email domains, webhooks, even domain purchases and AWS member accounts. What remains human is consent, identity, KYC, payment and Google's deliberate removal of its OAuth-client API. That list barely changes from one app to the next. So the lasting value of a reusable skill is not provisioning breadth, which the umbrellas will keep winning. It is making those dozen gates cheap: front-loaded, pre-filled, resumable, and closed by a probe rather than by the human's word.

The umbrellas are also converging on a shape a small tool can reuse right now. They agree on an object model (connection, then resource, then credential) and on a human-handoff payload (reason, URL, code, expiry). A skill whose adapters speak both today can absorb Stripe Projects, Vercel Marketplace or a published Stripe and Cloudflare protocol later as just another adapter. That is the case for building your own thin orchestrator instead of betting on any one platform's walls.
