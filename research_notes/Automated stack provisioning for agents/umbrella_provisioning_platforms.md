# Umbrella provisioning platforms: how one platform opens accounts and provisions services at other providers for a developer or agent

Research date: 7 November 2026. "Fetched" means the primary page was read in full on that date. "Snippet" means the fact came only from a search-result summary and was not checked against the full page. Dates are given wherever the source shows one.

## 1. Stripe Projects: name, dates, status, CLI, providers, account creation/linking, billing, credentials, extensibility

### Takeaway
Stripe Projects is real. It is a Stripe CLI plugin (`stripe plugin install projects`) announced as a developer preview on 26 March 2026. It became the first implementation of an unnamed provisioning protocol co-designed with providers, which Cloudflare promoted on 30 April 2026. The developer signs in to Stripe once. Stripe acts as the identity provider: a provider either auto-creates an account for that identity or links an existing one through OAuth. Paid tiers are paid with a Stripe Shared Payment Token under per-provider spend limits. Credentials are fetched into an encrypted local vault backed by the Stripe Secret Store, then written to `.env` files. Developers can use it freely. Providers join only through Stripe intake. Third-party platforms that want to act as the orchestrator in Stripe's place use a separate Provisioning API, which is in allowlisted private preview (API version `2026-09-30.preview`).

### Cited Findings
**Identity, dates, status**
- Stripe docs describe it as a tool that "provisions and manages third-party services (such as hosting, databases, auth, AI, and observability) from the terminal. Run one command to create your accounts, sync credentials to your `.env` and handle billing through Stripe." It needs Stripe CLI v1.43.3+ for `stripe docs`. The agent bootstrap requires CLI ≥ 1.40.0. — [Stripe docs: Stripe Projects CLI](https://docs.stripe.com/stripe-projects) (fetched)
- Launch post on stripe.dev, dated 26 March 2026, author Rami Banna. It repeatedly calls the product a "developer preview". — [stripe.dev launch post](https://stripe.dev/blog/production-ready-dev-stack-from-terminal) (fetched)
- PlanetScale's partner post (March 2026) also says developer preview. — [PlanetScale blog](https://planetscale.com/blog/planetscale-stripe-projects-partnership) (snippet)
- Cloudflare's 30 April 2026 coverage and InfoQ (18 May 2026) say Stripe Projects is in "open beta". — [Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects); [InfoQ](https://www.infoq.com/news/2026/05/cloudflare-stripe-agent-commerce/)
- **Conflict:** sources variously say "developer preview", "open beta" and "public preview" (the last from a search snippet of docs.stripe.com/projects). The current docs page fetched on 7 Nov 2026 gives no explicit status label.
- Stripe's Sessions 2026 recap lists Stripe Projects among the announcements. — [Stripe blog: Everything we announced at Sessions 2026](https://stripe.com/blog/everything-we-announced-at-sessions-2026) (snippet)
- Pricing: "Stripe Projects is free to use. Developers pay providers directly at their standard rates." — [projects.dev/developers](https://projects.dev/developers/) (fetched)

**CLI install and commands (verbatim from current docs)**
- Install: `stripe plugin install projects`. With npm: `npm install -g @stripe/cli@latest`. Homebrew: `brew install stripe/stripe-cli/stripe`. The agent skill installs with `npx skills add https://docs.stripe.com --skill stripe-projects -g -y`. projects.dev gives the alternative `npx skills add https://github.com/stripe/ai --skill stripe-projects -y -g`. — [Stripe docs](https://docs.stripe.com/stripe-projects); [projects.dev/developers](https://projects.dev/developers/)
- Project lifecycle commands:
  - `stripe projects init [name]` (also `init --yes` and `init --from <URL>`)
  - `status`, `list`, `pull <projectID>`
  - `build my-app [--template stripe/nextjs-saas/amber-fox]`, using a public template registry at github.com/stripe/projects-template-registry
  - `share` (a non-expiring URL that encodes the stack but no credentials) and `import <URL>`
  - `llm-context`
  
  — [Stripe docs](https://docs.stripe.com/stripe-projects)
- Service commands:
  - `catalog [provider|category]` and `search <keyword>`
  - `add <provider>/<service>`, e.g. `vercel/project`, `supabase/project`, `neon/postgres --name dev-db`, `cloudflare/registrar:domain`
  - `link <provider>`: associate or create a provider account without provisioning anything
  - `remove`, `rotate`, `upgrade`, `open <provider>`, `services list`
  
  — [Stripe docs](https://docs.stripe.com/stripe-projects); [Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects)
- Environment commands:
  - `env` (lists names only, never values) and `env --pull`
  - `env list|show|create <name> --output .env.dev|use|update|delete|add|remove`
  - `variables set <name> --env-key KEY --value V`, plus `variables list|delete`
  
  — [Stripe docs](https://docs.stripe.com/stripe-projects)
- Billing commands: `billing show|add|update [--limit <amt> --provider <p>]` and `spend [--duration 3m|--since|--until]`. — [Stripe docs](https://docs.stripe.com/stripe-projects)
- Global flags for agents and CI: `--json`, `--no-interactive`, `--auto-confirm`, `--quiet`, `--accept-tos` ("Accept provider ToS without prompting"), `--stream`, `--debug`. Documented error codes include `PROVIDER_NOT_LINKED`, whose fix is `stripe projects link <provider>`. — [Stripe docs](https://docs.stripe.com/stripe-projects)

**Providers**
- The launch list on 26 March 2026 had 10 providers: Vercel, Railway, Supabase, Neon, PlanetScale, Turso, Chroma, PostHog, Clerk, Runloop. — [stripe.dev](https://stripe.dev/blog/production-ready-dev-stack-from-terminal)
- A Stripe X post said "16 new providers for a total of 49". — [Stripe on X](https://x.com/stripe/status/2065124904450789630) (snippet, undated in result)
- The current docs say "60+ providers". The table lists about 67, including: AgentMail, AgentPhone, Algolia, Amplitude, Auth0, Base 44, Blaxel, Browserbase, Chroma, Clerk, ClickHouse, Cloudflare, Cloudinary, Composio, Customer.io, Datadog, Daytona, Depot, E2B, Elevenlabs, Exa, Firecrawl, Fly.io, GitLab, Here.now, HeyGen, Inngest, Kernel, Klaviyo, Laravel Cloud, Metronome, Mixpanel, Neon, Netlify, OpenRouter, Parallel, PlanetScale, PostHog, Prisma, Privy, Railway, Render, Resend, RevenueCat, Runloop, Spaceship, Squarespace, Supabase, Supermemory, Turso, Twilio, Upstash, Vercel, Wix, WordPress.com, WorkOS. The docs say: "These providers co-designed the integration protocol with Stripe. The protocol standardises provisioning, plan selection, upgrades and credential handoff." — [Stripe docs](https://docs.stripe.com/stripe-projects)

**Account model and provider account creation/linking**
- Object model: a project groups one app's **provider accounts**, **services** (the provider's products) and **resources** (instances plus their credentials and env vars). `add` "associates an existing provider account with your Stripe account or creates one, before adding the service." A provider association "remains authorised until you explicitly remove the association" and is scoped to that Stripe account. — [Stripe docs](https://docs.stripe.com/stripe-projects)
- Cloudflare's description of the mechanism: Stripe acts as the identity provider, "attesting to the user's identity." If no Cloudflare account exists for that user, Cloudflare provisions one automatically and returns credentials (including an API token) to the CLI. If one exists, the user goes through "a standard OAuth flow" to grant the Stripe Projects CLI access. The attestation format (token type and claims) is not published. — [Cloudflare blog, 30 Apr 2026](https://blog.cloudflare.com/agents-stripe-projects) (fetched)
- InfoQ reports linking happens when the Stripe email matches an existing Cloudflare account. — [InfoQ](https://www.infoq.com/news/2026/05/cloudflare-stripe-agent-commerce/)
- Render: the account created through Stripe Projects belongs to the developer, not to Stripe. The protocol has three objects: account, service and resource. — [Render blog](https://render.com/blog/stripe-an-orchestration-layer-not-a-platform) (snippet)
- To avoid browser pop-ups mid-agent-session, the docs say to sign in to Stripe first, run `stripe projects link`, run `stripe projects billing add`, and only then start the agent. The agent rule is: "If the CLI opens a browser for authentication, stop and clearly tell the user to complete sign-in." — [Stripe docs](https://docs.stripe.com/stripe-projects)

**Billing**
- The payment method is stored once on the Stripe account. On a paid plan, "Stripe tokenises your payment credentials into a Shared Payment Token and grants the provider a payment credential for that upgrade. The provider charges using that token." — [Stripe docs](https://docs.stripe.com/stripe-projects)
- Spend limits are enforced **per provider**. A global limit is the default cap for each provider, not a shared budget. With three providers and a 100 GBP global limit, combined spend can reach 300 GBP. Per-provider limits override the global one. — [Stripe docs](https://docs.stripe.com/stripe-projects)
- Default cap: "$100.00 USD/month" per provider, raisable. This figure comes from Cloudflare's post, not from Stripe docs. — [Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects)
- During the developer preview, payment handoff works only in the US, EU, UK and Canada, and only for supported providers and plans. — [stripe.dev](https://stripe.dev/blog/production-ready-dev-stack-from-terminal); the current docs link a "paid-tier countries" page ([Stripe docs](https://docs.stripe.com/stripe-projects))

**Credentials and `.env` sync**
- Credentials are "fetched from each provider on your behalf". They are stored encrypted in `.projects/vault/vault.json` and in the Stripe Secret Store, then written to `.env` (or a per-environment file such as `.env.dev` / `.env.production`) with `600` permissions. `init` adds these files to `.gitignore`. — [Stripe docs](https://docs.stripe.com/stripe-projects)
- State files: `.projects/state.json` is committed. `state.local.json` is also committed, because teammates need it to `link` their own accounts. `.projects/vault/` and `.projects/cache/` are ignored. Each teammate runs `env --pull` to get their own copy. "This is a local credential cache, not a shared secrets distribution system." — [Stripe docs](https://docs.stripe.com/stripe-projects)
- `env --pull` runs automatically after provision, rotate, upgrade or environment-membership changes. `remove` deprovisions the resource but does not delete credentials already written locally. — [Stripe docs](https://docs.stripe.com/stripe-projects)
- **Production hosts are not automated:** "To use the same credentials in production, add them to your host's environment variable settings. Stripe Projects doesn't automate this step." — [Stripe docs](https://docs.stripe.com/stripe-projects)
- `init` writes coding-agent skills into the project, at `.skills/stripe-projects-cli/`. — [Stripe docs](https://docs.stripe.com/stripe-projects)

**Can non-partners use or extend it?**
- **Developers:** anyone with a Stripe account can use the CLI. Anyone can author build templates (docs link "Create a build template"). — [Stripe docs](https://docs.stripe.com/stripe-projects)
- **Providers:** joining is gated. Email provider-request@stripe.com with business and engineering contacts, category, whether you can build immediately, and GitHub handles. Allow at least 2 business days. Stripe is "prioritising SaaS and infrastructure providers that are widely used". It wants partners who can help "as we develop the product and integration spec" (so the spec is still evolving). Priority categories: hosting, database, auth, storage, analytics, messaging, cache, observability, AI, vector DB, payments, search, CI/CD, feature flags, sandboxes. — [Stripe docs: Provider intake](https://docs.stripe.com/projects/provider-intake) (fetched)
- **Platforms acting as orchestrator (Stripe's role):** the **Provisioning API** is "allowlisted during private preview" (provisioning-preview@stripe.com). Requests use header `Stripe-Version: 2026-09-30.preview` and the platform's key plus `Stripe-Context: {connected account}`. — [Stripe docs: Integrate the Provisioning API](https://docs.stripe.com/projects/platform-integration) (fetched)
  - Each tenant gets a Stripe connected account created via Accounts v2 (`POST /v2/core/accounts` with `configuration.developer.capabilities.projects.requested=true`), followed by hosted onboarding (`POST /v2/core/account_links`) or embedded onboarding.
  - Endpoints:
    - `GET /v2/provisioning/eligibility`
    - `GET /v2/provisioning/catalog/providers` and `/catalog/services?provider_name=`
    - `POST /v2/provisioning/payment_method_requests` with `usage_limits`; returns a `checkout_session_url` for the human
    - `POST /v2/provisioning/projects`
    - `POST /v2/provisioning/provider_connection_requests`, with statuses `requested`, `pending_auth` (returns a `redirect_url` for a browser step), `needs_information`, `complete` and `error`
    - `POST /v2/provisioning/resources` and `/resources/link`, with statuses `pending`, `needs_information`, `complete`, `errored` and `removed`
    - `POST /v2/provisioning/resources/{id}/reveal_access_configuration`, which returns e.g. `{"configuration":{"DATABASE_URL":"..."},"expires_at":...}`
    - `/rotate_credentials`, `/remove`, `/unlink`, and `provider_connections/{id}/unlink`
  - Preview limitations: no webhooks, no caller idempotency, credentials retrieved one resource at a time, `livemode` defaults to `true` (real charges) if omitted, and Stripe handles the provider OAuth callback (no platform callback URL).
  
  — [Stripe docs: platform integration](https://docs.stripe.com/projects/platform-integration)
- The Provisioning API "doesn't make your platform the merchant of record for Provider services". A provider "might require verified KYC information, such as a verified email address". — [Stripe docs: platform integration](https://docs.stripe.com/projects/platform-integration)

### Inferences
- Stripe Projects has three distinct roles. (1) The **orchestrator** holds the signed-in user, the identity and the payment method: Stripe via the CLI, or a platform via the Provisioning API. (2) **Providers** implement the co-designed protocol: a catalog/discovery API, account create-or-OAuth-link, resource provision, plan upgrade with a payment token, and credential return. (3) The **client** is the CLI or an agent. To copy the pattern, a builder must either become a Stripe Provisioning API platform (private preview) or reimplement both orchestrator and provider sides with each provider individually.
- The provider-side wire protocol, meaning what Cloudflare and Neon actually implement for Stripe, is not public. Only the orchestrator-facing Provisioning API is documented, and only for allowlisted platforms. The provider-facing contract can be inferred only from the orchestrator API's object shapes: `provider_connection_request` → `resource` → `access_configuration`.
- Credentials end at local `.env` files. Pushing secrets to the production host is left to the developer or agent, unlike Vercel Marketplace, which injects env vars into the hosting project.

### Gaps
- No published name, version or specification for the provider protocol was found. Cloudflare said "a more official specification soon" (30 Apr 2026). Render said Stripe planned to open it "later in the summer" (snippet). As of 7 Nov 2026 I found no public spec.
- I found no exact GA date or official current status label.
- The identity attestation format Stripe sends to providers (JWT claims, signing keys) is not documented publicly.
- I could not confirm from Stripe's own docs the default per-provider cap of $100/month. It is cited only by Cloudflare.

## 2. Vercel Marketplace native integrations: account creation, partner API, SSO, billing, env injection, CLI for agents

### Takeaway
Vercel is the most fully documented umbrella model. The provider implements a **Partner API** on its own server, and Vercel calls it with Vercel-signed OIDC JWTs. On first use the user accepts the provider's terms once in a Vercel modal. Vercel then calls `PUT /v1/installations/{id}` and the provider upserts a user and account from the token claims, which include email. No separate provider signup is needed. Resources are created with `POST /v1/installations/{id}/resources`. That call must return the secrets synchronously, optionally with per-environment overrides, and Vercel turns them into project env vars for the environments the user connects. Billing goes through Vercel (plans fetched from the provider, invoices submitted to Vercel), except for imported "linked" resources. SSO to the provider dashboard uses a code exchange. Claiming and transferring ownership of resources is a first-class flow tied to Vercel "Claim Deployments". The CLI (`vercel integration add` / `vercel install`) is explicitly agent-optimised, but terms acceptance still needs a human.

### Cited Findings
**Account creation and identity**
- On first selection of a provider product, "an account is created for this user on the provider's side if the account does not exist", after the user sees an **Accept Terms modal**. The modal is shown only once per user and provider. Vercel then calls `PUT /v1/installations/{installationId}`, and the provider must "Upsert requesting user" and "Upsert installation". If the provider uses installation-level plans, it assigns a default plan ("free"). — [Vercel docs: Native Integration Flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows) (fetched, last_updated 2026-09-17)
- At this step Vercel sends an `access_token` so the provider can call the Vercel API for that installation. "Providers are expected to store this token for future use as it does not expire." — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)
- Authentication of Vercel→provider calls uses OIDC JWTs signed by Vercel, verifiable against JWKS at `https://marketplace.vercel.com/.well-known/jwks`, with `iss` `https://marketplace.vercel.com` and `aud` the integration ID. — [Vercel Partner API reference](https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner) (fetched, last_updated 2026-11-06)
  - User-auth claims: `account_id`, `sub` (`account:<hex>:user:<hex>`), `installation_id`, `user_id`, `user_role` (`ADMIN`/`USER`), `user_email` ("included for all Marketplace integrations by default"), `user_email_verified`, `user_name`, `user_avatar_url`.
  - System-auth tokens omit user fields.
  - New claims `parent_account_id` and `parent_installation_id` exist "for platform org-child installations (integration opt-in)".

**Partner API endpoints (provider implements; Vercel calls)**
- Installations:
  - `PUT /v1/installations/{id}` (Upsert, **required**)
  - `GET` and `PATCH` (optional)
  - `DELETE` (required)
- Resources:
  - `POST /v1/installations/{id}/resources` (Provision, required)
  - `GET /v1/installations/{id}/resources/{rid}` (required)
  - `PATCH` (optional)
  - `DELETE` (required)
  - `POST .../secrets/rotate` (optional)
  - `POST .../repl` (optional)
- Billing:
  - `GET /v1/products/{productSlug}/plans` (required)
  - `GET .../resources/{rid}/plans` and `GET /v1/installations/{id}/plans` (optional)
  - `POST /v1/installations/{id}/billing/provision` (Provision Purchase, optional)
- Transfers:
  - `POST /v1/installations/{id}/resource-transfer-requests`
  - `GET .../resource-transfer-requests/{providerClaimId}/verify`
  - `POST .../{providerClaimId}/accept`

— [Vercel Partner API reference](https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner)

**Provision Resource contract**
- The request body has `productId`, `name`, `metadata` (from the provider's registered metadata schema, rendered as a form by Vercel), `billingPlanId`, `externalId` (equals the Deploy Button `external-id` query param), `protocolSettings` (experimentation/Global Config, authentication `appUrls`) and `credentialTypes`. Headers are `X-Vercel-Auth` and `Idempotency-Key`. — [Vercel: Provision Resource](https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner/provision-resource) (fetched, last_updated 2026-11-06)
- The response must include `secrets: [{name, value, environmentOverrides: {development, preview, production}}]`. The `prefix` field is deprecated. It also includes `status`, `billingPlan` (with `paymentMethodRequired`, `preauthorizationAmount`, `initialCharge`, prepayment `minimumAmount`/`maximumAmount`) and `notification`, and optionally `customClaims` (roles and claimRules per environment). "This is the only resource endpoint whose response includes secrets." Provisioning can finish asynchronously, but "the secrets must be known ahead of time". The provider later sends a `resource.updated` event via `POST /v1/installations/{id}/events`. — [Vercel: Provision Resource](https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/partner/provision-resource); [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)
- Rotation started on the provider side: the provider calls `PUT /v1/installations/:id/product/:id/resource/:id/secrets`. Vercel updates the connected projects' env vars but **does not redeploy**. — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)

**Env var injection**
- Env vars from a resource apply to the environments selected on the resource connection. A Custom Environment uses its own connection if one exists, otherwise the Preview connection. Completed deployments keep old values until redeployed. — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)
- CLI: `--environment/-e` accepts `production`, `preview`, `development` or a Custom Environment slug/ID, and defaults to all three built-ins. `--prefix NEON2_` namespaces the vars (e.g. `NEON2_DATABASE_URL`). Name collisions are a hard error that suggests `--prefix` or `vercel env rm`. — [Vercel CLI: vercel integration](https://vercel.com/docs/cli/integration) (fetched, last_updated 2026-09-17)

**SSO and account linking**
- "Open in [Provider]" opens the provider's `loginRedirectUri` with `code` and `resource_id`. The provider exchanges the code with `POST /v1/integrations/sso/token` and logs the user in. — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)
- **Import existing resources:** Vercel redirects to the provider's Import Resource URL with `installation_id`, `product_id`, `state` (single-use, 12 h) and `return`. The provider authenticates the user, then calls `PUT /v1/installations/{id}/resources/{resourceId}` with `ownership: "linked"` and `secrets`, then redirects back. Linked resources "are not billed through Vercel". Secrets sync and SSO work the same way. Removing one from Vercel does not call the provider's Delete Resource endpoint. — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)

**Billing**
- The Vercel dashboard fetches plans with `GET /v1/installations/{id}/plans` and refetches on every form input change. The user picks a plan, and it is passed to provision. — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)
- Prepayment plans support auto-recharge thresholds (`vercel integration resource create-threshold <res> <minimum> <spend> <limit>`) and `vercel integration balance`. `vercel integration update --plan` / `--authorization-id` handle billing changes. — [Vercel CLI](https://vercel.com/docs/cli/integration)

**Ownership transfer and claim (agents as "claims generators")**
- An agent ("claims generator") with the provider integration installed on its own Vercel team provisions a resource and connects it to a project. It then calls `POST https://api.vercel.com/projects/<id>/transfer-request?teamId=…`. Vercel calls the provider's `CreateResourceTransfer`, and the provider returns a provider claim ID. Vercel returns a claim `code`. — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)
- The user visits `vercel.com/claim-deployment?code=<code>` and picks a target team. Vercel calls provider `GET .../verify`, which can return a new `billingPlan` for the target team, then `POST .../accept` with `{targetInstallationId, targetTeamId}`. The target team must have the integration installed, and the source-team user needs Owner/DELETE rights. — [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows)
- The transfer code is valid for 24 hours. Providers that currently support resource transfer with Claim Deployments: **Neon, Supabase, Prisma**. — [Vercel docs: Claim Deployments](https://vercel.com/docs/deployments/claim-deployments) (fetched, last_updated 2026-08-21)
- Accountless deploys: `vercel deploy --temporary` (not in CI and not in an already-linked dir) and Vercel Drop. Both always deploy to production, expire after a "server-set period", and print a claim URL. The claim needs login or signup, a team choice, then "Transfer" / "Accept and Transfer". Accountless Drop is static-only, with ≤100 MB per file and ≤1 GB total. — [Vercel docs: Deploying without logging in](https://vercel.com/docs/deployments/deploy-without-logging-in) (fetched; page metadata shows an implausible last_updated of 2018-10-20)

**CLI for agents**
- `vercel integration add <slug>[/<product>]`, also available as `vercel install` / `vercel i`, installs the integration if needed, provisions the resource, connects it to the linked project and runs `vercel env pull`. Flags: `--name`, `--metadata/-m KEY=VALUE`, `--plan/-p`, `-e`, `--prefix`, `--format json`, `--no-connect`, `--no-env-pull`, `--installation-id`, `--claim`/`--no-claim` (for sandbox resources). It detects non-interactive terminals and skips prompts. — [Vercel CLI](https://vercel.com/docs/cli/integration)
- Other subcommands: `accept-terms`, `list`, `installations`, `discover [query] [-c category]`, `categories`, `guide <slug> [--framework nextjs]`, `balance`, `open` (SSO link; `--format=json` returns the link), `update`, `remove --yes`, and `resource connect|disconnect|remove|create-threshold|claim`. — [Vercel CLI](https://vercel.com/docs/cli/integration)
- Machine-readable human-handoff payloads:
  - A non-interactive call missing `--yes` emits `outputAgentError` with `reason: "confirmation_required"` and a `next` array.
  - `resource claim` in non-interactive mode emits `outputActionRequired` with `reason: "integration_sandbox_claim_required"` and `verification_uri` set to the claim URL.
  - In interactive mode it polls up to 5 minutes for the ownership transfer.
  
  — [Vercel CLI](https://vercel.com/docs/cli/integration)
- `vercel integration accept-terms` "requires an interactive terminal and human confirmation. It does not replace integrations that require a browser flow or device attestation." — [Vercel CLI](https://vercel.com/docs/cli/integration)
- The agent-optimised CLI changelog (2 March 2026) added `discover` and `guide`, plus `--format=json`. "The CLI can pause for human decisions, such as terms of service acceptance." — [Vercel changelog](https://vercel.com/changelog/vercel-cli-for-marketplace-integrations-optimized-for-agents) (fetched)
- Adding a supported integration through the CLI now also installs the provider's agent skills from skills.sh. — [createwith.com summary of Vercel changelog](https://www.createwith.com/tool/vercel/updates/vercel-marketplace-integrations-now-install-provider-agent-skills-automatically) (snippet; the original is linked from the Vercel CLI page as "Marketplace integrations now install provider skills")

### Inferences
- The Vercel pattern is a **hub-calls-spoke webhook API**. The platform owns identity (an OIDC JWT carrying the email), terms acceptance UI, plan selection UI generated from provider-supplied schemas, billing and env var distribution. The provider implements about 8 required REST endpoints and must return credentials synchronously. This is the most copyable design for someone building their own umbrella, because every endpoint and payload is public.
- "Accounts at the provider" are really per-installation shadow accounts keyed on `installation_id`/`account_id`. The human reaches them only through Vercel SSO. Hacker News commenters cited this as a source of migration pain (see Q4).
- The transfer endpoints are how Vercel handles agent-built apps changing owner: the agent provisions on its own team, and the human claims both project and resources in one URL.

### Gaps
- I did not fetch the invoice and usage submission endpoints (Vercel→provider billing reconciliation) or the exact revenue-share terms. The partner reference links to them ("submit-invoice-response").
- I could not find the expiry of `vercel deploy --temporary` deployments. The docs say only "server-set".
- I could not find the date of the "Marketplace integrations now install provider skills" changelog.

## 3. Netlify, Cloudflare, Supabase, Neon and other agent-first signups

### Takeaway
Three patterns recur. (a) **Platform-owned provisioning with automatic env wiring**: Netlify Database, Cloudflare Wrangler auto-provisioning and Deploy buttons. (b) **Partner creates resources in its own org, then the user claims them**: Supabase for Platforms claim flow, Neon transfer requests, Vercel resource transfer. (c) **Accountless or agent-first creation with a time-boxed claim link**: Cloudflare temporary accounts (60 min), Neon Claimable Neon (72 h, built on auth.md), Prisma `create-db` (24 h default), AgentMail agent sign-up, Vercel `deploy --temporary`. Ownership always moves to the human through a browser claim page where they sign in or sign up and pick an org or team.

### Cited Findings
**Netlify**
- Old "Netlify DB" (beta) was a Neon Postgres auto-created when building (`netlify dev`, `netlify build` or a git push) via the Neon extension. If unclaimed, "your database instance is deleted after 7 days". The claim works by connecting a Neon account on the extension page → "Claim database". — [Netlify docs: Netlify DB](https://docs.netlify.com/storage/netlify-db) (snippet); [Neon blog: Netlify DB powered by Neon](https://neon.com/blog/netlify-db-powered-by-neon) (snippet)
- Netlify stopped new beta databases on 13 April 2026. Existing beta databases are still supported and can still be claimed to the user's own Neon account. — [Netlify changelog, 13 Apr 2026](https://www.netlify.com/changelog/2026-04-13-netlify-db-ga-coming-soon/) (snippet); [Netlify changelog tag: database](https://www.netlify.com/changelog/tag/database/) (snippet)
- **Netlify Database** became GA on 28 April 2026 as a "native Netlify primitive" that replaces the beta extension flow. It is provisioned automatically when you install `@netlify/database` and deploy, or set up by Netlify Agent Runners when the agent detects that the app needs a database. It is billed in Netlify credits (Credit-based plans only), with storage free until 1 July 2026. — [Netlify changelog, 28 Apr 2026](https://www.netlify.com/changelog/2026-04-28-netlify-database/) (fetched)
- Each deploy preview gets its own branch copied from production. "Agent runs get their own isolated branch automatically". Migrations apply on every production deploy and preview. — [Netlify docs: Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/) (fetched, last updated 16 Jun 2026)
- Netlify is listed as a Stripe Projects hosting provider. — [Stripe docs](https://docs.stripe.com/stripe-projects)

**Cloudflare**
- **Auto-provisioning on deploy** (open beta, 24 Oct 2025, Wrangler ≥ 4.45.0): declare `kv_namespaces`, `d1_databases` or `r2_buckets` bindings with no ID. `wrangler dev` creates them locally, and `wrangler deploy` creates them via the API, links them and writes the IDs back to config. Opt out with `--no-x-provision`. — [Cloudflare changelog](https://developers.cloudflare.com/changelog/2025-10-24-automatic-resource-provisioning/) (fetched)
- **Deploy to Cloudflare button** (changelog 8 Apr 2025): the URL is `https://deploy.workers.cloudflare.com/?url=<repo>`. It clones the public github.com/gitlab.com repo into the user's own Git account and builds with Workers Builds. It auto-provisions KV, D1, R2, Hyperdrive, Vectorize, Secrets Store, Durable Objects, Workers AI and Queues from the Wrangler config. Secrets are prompted from `.dev.vars.example`/`.env.example`, and descriptions come from `package.json` `cloudflare.bindings`. Workers only, public repos only. It deploys "on their own Cloudflare account" (so an account is required). — [Cloudflare docs: Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/) (fetched, last updated 12 Oct 2026); [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2025-04-08-deploy-to-cloudflare-button/)
- **Stripe Projects partnership** (30 Apr 2026): agents can create a Cloudflare account, start a paid subscription, register a domain (`stripe projects add cloudflare/registrar:domain`) and get an API token to deploy. The protocol has three components: Discovery, Authorization and Payment. Roles: "Orchestrator" (the platform with signed-in users) and provider. Any platform with signed-in users can be an orchestrator. Contact agenticpartnerships@cloudflare.com. Cloudflare itself acts as orchestrator for PlanetScale. — [Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects) (fetched; last modified 15 Jul 2026)
- **Temporary accounts** (19 Jun 2026): "Any agent can now run `wrangler deploy --temporary`" (Wrangler ≥ 4.102.0, unauthenticated use only). Cloudflare creates a temporary account and gives Wrangler an API token plus a claim URL. It is live 60 minutes unless claimed, then the account and resources are deleted. Claiming covers Workers and bindings such as databases. — [Cloudflare blog: Temporary accounts](https://blog.cloudflare.com/temporary-accounts/) (fetched); [Cloudflare docs: Claim deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/) (fetched, last updated 14 Jul 2026)
- **Temporary accounts REST API for platforms** (14 Jul 2026), all calls from the platform backend:
  - `POST https://api.cloudflare.com/client/v4/provisioning/previews/challenge` returns `challengeToken`, `seed`, `k`, `g`. The client solves a sequential SHA-256 proof-of-work, with `k*g` ≤ 64,000,000.
  - `POST .../provisioning/previews` takes `termsOfService`, `privacyPolicy`, `acceptTermsOfService: "yes"` (the platform must display the terms and collect acceptance), `challengeToken` and `solution.checkpoints`.
  - It returns `account.id`, `account.apiToken`, `account.tokenId`, `account.expiresAt`, `claim.token`, `claim.url` and `claim.expiresAt`.
  - The docs show no Authorization header on these calls.
  
  — [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-07-14-temporary-accounts-api/) (fetched); [Cloudflare docs](https://developers.cloudflare.com/workers/platform/claim-deployments/)
- Temporary account limits:
  - workers.dev only
  - Static Assets ≤ 1,000 files, ≤ 5 MiB each
  - one D1 database, 100 MB
  - Hyperdrive ≤ 2 configs and 10 connections
  - Queues ≤ 10
  - account creation is rate-limited, with abuse checks
  - not on the FedRAMP High endpoint
  - claiming "does not grant the platform permanent access", so later deploys need a normal Cloudflare OAuth client
  - `claim.url` is a bearer credential
  
  — [Cloudflare docs: Claim deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/)
- The Registrar API (beta) warns that domain registrations are non-refundable once complete. Designing purchase-confirmation flows is the integrator's job. — [Cloudflare blog: Registrar API beta](https://blog.cloudflare.com/registrar-api-beta/) (snippet)

**Supabase**
- OAuth integration for acting in a user's existing org: `GET https://api.supabase.com/v1/oauth/authorize` (optional `organization_slug` pre-selects the org; PKCE S256 recommended) and `POST /v1/oauth/token` for code exchange and refresh. Scopes are fixed on the OAuth app (the `scope` param is deprecated), and changing them forces re-authorisation. The partner then calls `POST /v1/projects`, or `/v1/organizations` first. Limitation: "Only some features are available until we roll out fine-grained access control." — [Supabase docs: Build a Supabase OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration) (fetched); [Supabase OAuth scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes) (snippet)
- The partner "Install Integration" button in the Supabase dashboard redirects to the partner with `project_id` and `organization_slug`. — [Supabase Partner Integration Guide](https://supabase.com/docs/guides/integrations/partner-integration-guide) (snippet)
- **Supabase for Platforms** (launched 5 Dec 2025): the platform creates projects in **its own** org (`organization_slug`) through the Management API or remote MCP server. — [Supabase docs: Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms) (fetched)
  - Endpoints: `POST /v1/projects`, `GET /v1/projects/available-regions`, `GET /v1/projects/{ref}/health` (wait for ACTIVE_HEALTHY), `GET/POST /v1/projects/{ref}/api-keys`, `PATCH .../billing/addons`, branches, migrations, `database/query`, restore points, security advisors and logs.
  - Caveats: database passwords cannot be changed via the API, and keys are migrating from `anon`/`service_role` to `publishable`/`secret`.
- Users named: Lovable, Bolt.new and Baidu MeDo ("millions of projects"). The full feature set (scale-to-zero Nano, restore points, migrations, claim flow) is "available only to select AI Builders" via the partnerships team. — [Supabase blog: Introducing Supabase for Platforms](https://supabase.com/blog/introducing-supabase-for-platforms) (fetched)
- **Claim flow:** `GET /v1/oauth/authorize/project-claim` with `project_ref`, `client_id`, `response_type`, `redirect_uri`, optional `state`/`response_mode`/PKCE. The token needs `organization_admin_write` and `project_admin_write`. The user creates or signs into a Supabase account, chooses or creates an org, reviews the OAuth scopes and transfer details, and confirms. The project moves to the user's org, and the platform "retains access through your OAuth integration". — [Supabase API ref: OAuth authorize project claim](https://supabase.com/docs/reference/api/v1-oauth-authorize-project-claim) (snippet); [Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms)

**Neon**
- **Claimable Neon** (agent-first, docs last updated 31 Oct 2026; implements auth.md). Base URL `https://claimable.neon.tech`. — [Neon docs: Claimable Neon](https://neon.com/docs/reference/claimable-postgres) (fetched; this URL and `/docs/reference/neon-launchpad` both served the "Claimable Neon" page); [neon.com/auth.md](https://neon.com/auth.md) (fetched)
  - Endpoints:
    - `POST /v1/agent/identity` with `capabilities` (`postgres`, `data_api`, `auth`), `source`, `region_id`, `project_name`. Returns `registration_id`, `identity_assertion`, project `id`/`branch_id`/`expires_at`, and per-capability `granted`/`scopes`.
    - `POST /v1/oauth2/token` with JWT-bearer grant `urn:ietf:params:oauth:grant-type:jwt-bearer`. Returns a 900 s access token with no refresh token.
    - `GET /v1/projects/{id}/credentials` returns `database_url` and service URLs.
    - `POST/GET /v1/projects/{id}/claim` returns `user_code`, `verification_uri_complete`, `expires_in` 900, `interval` 5.
    - `DELETE`
    - Discovery: `/.well-known/oauth-authorization-server/claimable` and `/.well-known/jwks.json`.
  - Limits: 72 h expiry unclaimed, 100 MB storage, 1 GB transfer, default `aws-us-east-2`. Functions, Object Storage and AI Gateway return `capability_requires_claim`.
  - Claim states: `pending` → `accepted` → `reconciled`. Claiming revokes the project key, tokens and database password, so the agent re-fetches a new `DATABASE_URL`.
  - CLI: `neon claim create [--env-pull --service data-api --service auth --region-id --project-name]`, plus `neon claim status|accept [--no-open]|list|delete --yes`. Writes `DATABASE_URL`, `NEON_DATA_API_URL`, `NEON_AUTH_BASE_URL`.
- Older naming: neon.new / "Instagres" / `npx neon-new` / `npx get-db` / env `PUBLIC_POSTGRES_CLAIM_URL` (older `PUBLIC_INSTAGRES_CLAIM_URL`), with claim URLs `https://neon.new/claim/<uuid>` (older `/database/<uuid>`), 72 h expiry, Postgres 17 on us-east-2. These appear in older search-indexed material and no longer appear on the current reference page. — [search snippet of neon.com/docs/reference/claimable-postgres and neon-launchpad](https://neon.com/docs/reference/neon-launchpad) (snippet; treat as superseded)
- **Platform claim integration** (private preview, last updated 25 Aug 2026):
  - The platform creates a project in its own org (`POST https://console.neon.tech/api/v2/projects`), then `POST /api/v2/projects/{id}/transfer_requests` (`ttl_seconds`, default 24 h, one-time use).
  - It shares `https://console.neon.tech/app/claim?p={project_id}&tr={transfer_request_id}&ru={redirect}`, or the user accepts via `PUT .../transfer_requests/{request_id}` with `org_id`.
  - It cannot transfer into Vercel-managed Neon orgs. The connection string survives transfer, but the password should be rotated.
  - Needs enablement by the Neon partnership team. Otherwise the API returns "project transfer requests are not enabled for this account".
  
  — [Neon docs: Claimable database integration guide](https://neon.com/docs/workflows/claimable-database-integration) (fetched); [Neon docs: Transfer projects](https://neon.com/docs/manage/orgs-project-transfer) (snippet: requires a personal admin key)

**Other agent-first signups**
- **Prisma Postgres `npx create-db`**: an accountless temporary database, 24 h by default (`--ttl` 30m, or 1h–24h). `--json` returns `claimUrl`, `connectionString` and `deletionDate`. Claiming stops auto-deletion. — [Prisma docs: npx create-db](https://www.prisma.io/docs/postgres/npx-create-db) (snippet); [Prisma blog](https://www.prisma.io/blog/give-your-agent-a-database) (snippet)
- **AgentMail**: the agent calls the sign-up endpoint without `human_email` and gets an API key plus an inbox. The inbox can receive but cannot send until a human is attached. The key cannot be recovered. A human claims by pasting the key at `console.agentmail.to/claim` (US-region `am_us_` keys only), or the agent uses attach-human, which emails the human an OTP. — [AgentMail docs: sign-up](https://docs.agentmail.to/api-reference/agent/sign-up.md) (snippet); [AgentMail: claiming agent inbox](https://agentmail.to/docs/knowledge-base/claiming-agent-inbox) (snippet); [AgentMail quickstart](https://agentmail.to/docs/quickstart.md) (snippet)
- Vercel temporary deploys and Vercel sandbox Marketplace resources: see Q2.
- **Bright Data** (agent makes the calls and the human relays an inbox OTP) and **Inkbox** (verification email to the human) also run agent self-signup flows. — [Bright Data blog: agentic registration](https://brightdata.com/blog/ai/agentic-registration) (snippet); [claudskills Inkbox skill](https://claudskills.com/skills/inkbox-agent-self-signup/SKILL.md) (snippet; low-authority source)

### Inferences
Mechanism matrix (my synthesis of the cited facts above):

| Product | Who holds identity | Provider account creation | Resource API | Credential delivery | Billing | Ownership handoff | Main limits |
|---|---|---|---|---|---|---|---|
| Stripe Projects | Stripe (IdP attestation) | Auto-create or OAuth link per provider | Unpublished provider protocol; Provisioning API (private preview) for orchestrators | Encrypted vault + Stripe Secret Store → `.env*` | Shared Payment Token, per-provider limits | Account is already the developer's own | Preview; paid only in US/EU/UK/CA; prod env not synced |
| Vercel Marketplace | Vercel OIDC JWT (email claims) | Provider upserts user on `PUT /installations` after a one-time Terms modal | Public Partner API | Secrets in provision response → project env vars per environment | Through Vercel (except "linked" imports) | Claim Deployments + resource-transfer endpoints (Neon, Supabase, Prisma) | Shadow accounts reached via SSO |
| Cloudflare temporary accounts | None (anonymous + proof-of-work) | Temporary account via `wrangler deploy --temporary` or REST | Normal CF API with temporary token | `account.apiToken` | Free, limited | `claim.url`, 60 min | workers.dev, small quotas |
| Cloudflare via Stripe | Stripe | Auto-create or OAuth | Stripe protocol | Token to Stripe CLI | Payment token, $100/mo default cap | Already the user's | Domains non-refundable |
| Supabase for Platforms | Platform | Projects in the platform's org | Management API | `GET /api-keys` | Platform pays compute | `project-claim` OAuth flow; platform keeps OAuth access | Full features for select partners only |
| Neon Claimable | None (auth.md anonymous) | Anonymous project | `claimable.neon.tech` + JWT-bearer | `/credentials` | Free | Device-code-style claim, 15-min code, 72 h project | 100 MB / 1 GB |
| Neon platform transfer | Platform | Projects in the platform's org | Neon API v2 | `connection_uri` | Platform | Claim URL with transfer request (24 h default) | Private preview |
| Netlify Database | Netlify | None at Neon visible to user (Netlify primitive) | Automatic on deploy | Injected by platform (env var names not verified) | Netlify credits | n/a (beta DBs: claim to Neon) | Credit plans only |
| Prisma create-db | None | Anonymous DB | CLI | stdout / JSON | Free | `claimUrl`, 24 h default | Temporary |
| AgentMail | None | Agent org | Sign-up API | API key | n/a | Paste key at `/claim`, or OTP attach | Can't send before claim; US only |

- The "create in my org, claim later" pattern (Supabase, Neon, Vercel) lets the platform keep paying and holding access until the claim. Supabase alone documents that the platform keeps API access after the transfer, via OAuth. Cloudflare explicitly does not keep access.

### Gaps
- Cloudflare for Platforms / Workers for Platforms (dispatch namespaces for a platform's own end-users) was not researched in this pass.
- I did not verify Netlify Database's env var names, CLI commands, or whether a Neon account is created for the user. The GA changelog and overview page do not state them.
- Netlify Extensions (Netlify SDK) provisioning hooks were not researched.
- The Supabase project-claim parameters come from a search snippet of the API reference, not a full fetch.
- Prisma and AgentMail details are from search snippets of their official docs, not full fetches.

## 4. What these products cannot do: which steps still need a human, and how each presents that step

### Takeaway
In every product a human must establish identity and accept terms at least once, and add a payment method before any paid tier. Most present this as a browser handoff URL: an OAuth or consent page, a claim URL, or a device-code-style verification URI with a user code. Several CLIs now emit machine-readable "action required" payloads so the agent can relay the link instead of failing. Domain purchases, KYC/verified email, and accepting an existing-account OAuth grant are the hard human gates. Pushing secrets into the production host is a gap in Stripe Projects specifically.

### Cited Findings
- **Stripe Projects**: Stripe sign-in, provider `link` (may open a browser) and `billing add`. The docs say to do these before the agent session, and agents must "stop and clearly tell the user to complete sign-in". A `--accept-tos` flag exists for provider terms. Production env vars are not automated. — [Stripe docs](https://docs.stripe.com/stripe-projects)
- **Cloudflare via Stripe**: the human must grant permission to the agent, accept Cloudflare's terms, complete the OAuth flow if a Cloudflare account already exists, and add a payment method if none is on file. — [Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects)
- InfoQ counts four human steps: initial Stripe authentication, accepting Cloudflare ToS, billing setup, and merge decisions. — [InfoQ](https://www.infoq.com/news/2026/05/cloudflare-stripe-agent-commerce/)
- **Stripe Provisioning API (platforms)**:
  - Stripe-hosted or embedded KYC onboarding for each connected account, via Account Links.
  - Payment collected on a short-lived `checkout_session_url`.
  - `pending_auth` returns a `redirect_url` for provider authentication ("Don't bypass or simulate authentication").
  - Providers "might require verified KYC information, such as a verified email address".
  - Stripe tells platforms to require fresh user approval before every write (project, connection, payment method, resource create/update/rotate/remove) and to record pricing, terms and usage limits.
  
  — [Stripe docs: platform integration](https://docs.stripe.com/projects/platform-integration)
- **Vercel**: a one-time Accept Terms modal per provider. `vercel integration accept-terms` "requires an interactive terminal and human confirmation" and "does not replace integrations that require a browser flow or device attestation". Sandbox claims emit `outputActionRequired` with `verification_uri`. Claiming a project needs a human with a Vercel account choosing a team. — [Vercel CLI](https://vercel.com/docs/cli/integration); [Vercel flows](https://vercel.com/docs/integrations/create-integration/marketplace-flows); [Vercel Claim Deployments](https://vercel.com/docs/deployments/claim-deployments)
- **Cloudflare temporary accounts**: the platform must display Cloudflare's ToS and privacy policy and collect acceptance (`acceptTermsOfService: "yes"`). The human must open the claim URL within 60 min, sign in or sign up, and complete dashboard prompts. "Opening the URL alone does not complete the claim." — [Cloudflare docs](https://developers.cloudflare.com/workers/platform/claim-deployments/)
- **Neon Claimable**: the human opens `verification_uri_complete`, signs in, picks an org and accepts the transfer within the 15-minute code window. — [Neon docs](https://neon.com/docs/reference/claimable-postgres)
- **Supabase**: the human creates or signs into an account, selects an org, reviews scopes and confirms the transfer. Scale-to-zero pricing and restore points require a partnerships form. — [Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms)
- **AgentMail**: sending is blocked until a human is attached by OTP or claim. — [AgentMail docs](https://docs.agentmail.to/api-reference/agent/sign-up.md) (snippet)
- **Resend**: its auth.md says the only credential is a Resend API key "the user issues" from the API keys page and supplies through a secure channel. So no agent self-registration is documented there, despite Resend being listed as an auth.md adopter. — [resend.com/auth.md](https://resend.com/auth.md) (snippet); [WorkOS auth.md adopters](https://workos.com/auth-md) (fetched)
- **Known failure modes** cited in commentary:
  - Wrong domain bought or deployed (Cloudflare's demo deployed to superseal.cc instead of superseal.club, per an HN commenter).
  - Runaway retries causing charges, and irreversible durable purchases. One commenter recommended hard per-run budgets, audit logs, idempotency keys and a kill switch.
  - Lock-in from cross-vendor auto-provisioned accounts (Fly.io→Sentry, Vercel→Neon/Upstash cited by HN commenters).
  - AWS, Azure and GCP still require human-driven account creation.
  
  — [InfoQ](https://www.infoq.com/news/2026/05/cloudflare-stripe-agent-commerce/)

### Inferences
- The human step has converged on two UX shapes. (1) **A pre-session consent bundle**: identity + ToS + payment method + per-provider spend limit, as in Stripe Projects and Vercel's one-time terms. (2) **A post-hoc claim link** that is a bearer credential with a short TTL: Cloudflare 60 min, Neon code 15 min / project 72 h, Prisma 24 h, Vercel transfer code 24 h. A tool built on these should treat claim URLs as secrets, surface expiry times, and relay the CLI's structured "action required" output verbatim.
- Accountless claim flows dodge the payment step only by restricting to free quotas. Any paid resource still needs an authenticated orchestrator with a stored payment method.

### Gaps
- No source documented automated KYC beyond email verification for provider accounts. Whether any provider in Stripe Projects requires more (e.g. Twilio, domain registrars) is unknown.

## 5. Emerging standards or protocols for agent-driven account provisioning ("agentic registration")

### Takeaway
Two real efforts exist; the rest is marketing. (1) **auth.md** is an MIT-licensed open protocol from WorkOS (blog 21 May 2026, github.com/workos/auth.md) built on OAuth: RFC 9728 discovery, RFC 7523 JWT-bearer, the IETF ID-JAG draft, and an RFC 8628-style claim. Neon's Claimable Neon is a concrete implementation, and WorkOS lists about 19 adopters, though at least one (Resend) only documents manual keys. (2) The **Stripe/Cloudflare provisioning protocol** behind Stripe Projects is described as "designed to be open" with any orchestrator allowed, but no specification was published as of these sources. Its only public surface is Stripe's private-preview Provisioning API. Vercel's Marketplace Partner API is public but proprietary to Vercel.

### Cited Findings
- auth.md is "An open protocol that lets agents register for services on behalf of users — discoverable through a Markdown file at your domain." It is MIT-licensed, the repo shows about 644 stars, and no spec version is stated. — [GitHub: workos/auth.md](https://github.com/workos/auth.md) (fetched)
  - Discovery: `/.well-known/oauth-authorization-server` (RFC 8414, with an `agent_auth` block), `/.well-known/oauth-protected-resource`, and an `AUTH.md` "skill manifest".
  - Endpoints: `POST /agent/identity`, `POST /agent/identity/claim`, `POST /agent/identity/claim/complete`, `POST /oauth2/token`, `POST /oauth2/revoke` (RFC 7009), `/agent/event/notify`, provider `/.well-known/jwks.json`.
  - Grants: `urn:ietf:params:oauth:grant-type:jwt-bearer` (RFC 7523) and `urn:workos:agent-auth:grant-type:claim`.
  - `identity_types_supported`: `anonymous`, `identity_assertion`, `service_auth`.
  - The claim is an "RFC 8628-style claim ceremony" (`user_code`, `verification_uri`, `authorization_pending`, `expired_token`).
- WorkOS launch blog (21 May 2026). — [WorkOS blog: Agent Registration with Auth.md](https://workos.com/blog/agent-registration-with-auth-md) (fetched)
  - Two flows. **Agent Verified**: a trusted agent provider signs an ID-JAG (draft-ietf-oauth-identity-assertion-authz-grant) for a specific user, and the service verifies it via the provider's JWKS and returns credentials synchronously. **User Claimed**: the user gives the agent a six-digit OTP. It has two modes: "Email required" (no pre-claim use) and "Anonymous start" (limited pre-claim scopes, upgraded on claim).
  - Uses OIDC backchannel logout for revocation.
  - **Conflict:** the blog names the endpoints `/agent-auth`, `/agent-auth/claim`, `/agent-auth/claim/complete`, whereas the GitHub repo and Neon's live implementation use `/agent/identity` paths. I could not determine which is current; Neon's live service uses `/v1/agent/identity`.
- The WorkOS product page lists flows "Agent verified" and "User claimed". Listed adopters: Cloudflare, Neon, Firecrawl, Resend, Parallel, monday.com, here.now, Polar, Cogny, agents-txt, Kernel, Rize, drpr.host, Alpic, Cloudinary, Sendmux, HelixDB, InsForge, ZeroClick. It is "composes existing OAuth standards (Protected Resource Metadata, ID-JAG identity assertions)". — [workos.com/auth-md](https://workos.com/auth-md) (fetched)
- WorkOS also has an AuthKit "Agent Registration" product doc. — [WorkOS docs: Agent Registration](https://workos.com/docs/authkit/agent-registration) (snippet only)
- Cloudflare's 19 Jun 2026 post says Cloudflare collaborated with WorkOS on auth.md, which "lets agents provision new accounts using existing OAuth standards", and that anyone can adopt it. — [Cloudflare blog: Temporary accounts](https://blog.cloudflare.com/temporary-accounts/)
- Neon's `neon.com/auth.md` is a working auth.md implementation: anonymous registration → identity assertion → JWT-bearer token → claim with `verification_uri_complete`. — [neon.com/auth.md](https://neon.com/auth.md); [Neon docs](https://neon.com/docs/reference/claimable-postgres)
- Third-party listing of auth.md in production: Resend, here.now, Ora.ai. — [Lumar agentic-readiness docs](https://agentic-readiness.lumar.io/docs/capabilities/auth-md) (snippet)
- Critiques:
  - Karl McGuinness argues that auth.md is effectively a custom protocol and that onboarding profile metadata is missing. — [Control Plane: standards reading of auth.md](https://notes.karlmcguinness.com/notes/agent-provider-is-the-idp-standards-reading-of-workos-auth-md/) (snippet)
  - Another analysis contrasts it with Dynamic Client Registration (RFC 7591): DCR yields a client ID and secret, while auth.md yields a user access token, and DCR could be a sub-step. — [authsome.ai explainer](https://authsome.ai/blog/what-is-authmd-workoss-open-agent-registration-protocol-explained) (snippet)
- Press coverage dates: MarkTechPost (25 May 2026) and Daring Fireball (15 Jun 2026; also a sponsored WorkOS feed item). — [MarkTechPost](https://www.marktechpost.com/2026/05/25/workos-releases-auth-md-an-open-agent-registration-protocol-built-on-oauth-standards/); [Daring Fireball](https://daringfireball.net/linked/2026/06/15/workos-authmd) (snippets)
- **Stripe/Cloudflare protocol**: "co-designed with Stripe". The post says Cloudflare and Stripe "plan to share a more official specification soon", it is not tied to Stripe ("any platform with signed-in users"), and there is no name. — [Cloudflare blog](https://blog.cloudflare.com/agents-stripe-projects)
  - Secondary coverage headlines it as an "open protocol". — [KuCoin news flash](https://www.kucoin.com/news/flash/stripe-and-cloudflare-launch-open-protocol-for-ai-agent-self-service-deployment) (snippet; low authority)
  - Stripe's provider intake says the "integration spec" is still being developed with partners. — [Stripe provider intake](https://docs.stripe.com/projects/provider-intake)
- **Shared Payment Tokens** (from Stripe's agentic commerce stack) are the payment primitive Stripe Projects uses to grant a provider a scoped payment credential. — [Stripe docs](https://docs.stripe.com/stripe-projects) (links to docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens)
- projects.dev's public site API follows open RFCs (RFC 9727 api-catalog, RFC 9457 problem details, RFC 9745/8594 deprecation and sunset, OpenAPI 3.1), but this is the catalog/discovery site API, not the provisioning protocol. — [projects.dev/developers](https://projects.dev/developers/)

### Inferences
- For a builder today, the safest interoperable choice for the **identity and registration layer** is auth.md-style OAuth composition. Its building blocks are IETF RFCs or drafts (9728, 8414, 7523, 7009, 8628-style claims, ID-JAG), and there is at least one production reference (Neon). The vocabulary is still moving (endpoint names differ between blog and repo), so pin to a specific implementation.
- For **provisioning, plans and payment**, there is no open standard yet. Copy the shapes from Vercel's public Partner API (install → plans → provision returns secrets → events → transfer verify/accept) or Stripe's Provisioning API object model (provider_connection_request → resource → reveal_access_configuration, with per-provider usage limits).
- "Agentic registration" is used as a term by WorkOS and Bright Data, but it is a vendor term, not a standards-body term.

### Gaps
- No IETF or other standards-body working item specifically for agent account provisioning was found, beyond the ID-JAG draft that auth.md references.
- I could not determine which agent providers (e.g. AI labs or coding-agent vendors) actually issue ID-JAG assertions for auth.md's Agent Verified flow. The WorkOS page does not say.
- I found no publication of the Stripe/Cloudflare provider spec as of 7 Nov 2026.
