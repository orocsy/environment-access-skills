# Declarative "whole stack from one file" provisioning: PaaS manifests vs IaC engines, and how far they reach into DNS, email, payments and auth

Research date: 7 November 2026. Registry version/date data was pulled live from the Terraform Registry API (`https://registry.terraform.io/v1/providers/<namespace>/<name>`), the Pulumi Registry API (`https://api.pulumi.com/api/registry/packages?name=<x>`) and the GitHub API on that date. Anything marked "Inference" has no direct source.

## Q1. PaaS manifests (Render Blueprints, Railway, Heroku app.json/Button, Fly.io, Coolify, Kamal): what they provision, how secrets are prompted or generated, what stays manual

### Takeaway
PaaS manifests declare compute, managed databases/caches and env vars on *their own* platform, and some generate secrets. None of them creates DNS records at an outside registrar or DNS host, email-sending domains, Stripe objects, or OAuth clients. Render Blueprints and Railway's new IaC (`.railway/railway.ts`) are the only ones with real "sync/plan/apply" semantics. Heroku app.json is applied only when an app is created. Railway's old `railway.toml`/`railway.json` is deprecated, and files stop being read on 2026-12-01.

### Cited Findings

**Render Blueprints (`render.yaml`)**
- Resource types: web services, static sites, private services (`pserv`), background workers, cron jobs, Key Value instances, workflows, Postgres databases (up to five read replicas plus an HA standby), environment groups, custom domains on web services and static sites, and projects/environments (with `networking.isolation`, `permissions.protection`) — [Render Blueprint spec](https://render.com/docs/blueprint-spec)
- Secrets: `generateValue: true` creates "a randomized, base64-encoded, 256-bit value". `sync: false` prompts for a value, and "Render prompts you for these values only during the initial Blueprint creation". `fromDatabase`/`fromService` references "update to match the current value of the referenced property on each Blueprint sync" — [Render Blueprint spec](https://render.com/docs/blueprint-spec)
- Limits: "Render does not support variable interpolation in Blueprint files". `sync: false` is not allowed on env-group variables. Service `type`, database `name`, `region`, `postgresMajorVersion`, `databaseName` and `user` can't be changed after creation. Disks can grow but not shrink — [Render Blueprint spec](https://render.com/docs/blueprint-spec)
- Env vars are additive: "Render preserves existing environment variables, even if you omit them from the Blueprint file" — [Render Blueprint spec](https://render.com/docs/blueprint-spec)
- Sync: by default, "Render automatically updates affected resources every time you push Blueprint changes to your linked branch". Auto Sync can be turned off in favour of Manual Sync — [Render IaC docs](https://render.com/docs/infrastructure-as-code)
- Drift and deletion: dashboard changes that conflict with the Blueprint are overwritten ("the next Blueprint sync overwrites them"). "With one exception, removing a definition from a Blueprint file does not delete the corresponding resource" (the exception is Postgres read replicas). A managed resource deleted by hand is recreated: "Render recreates it the next time you sync your Blueprint!" — [Render IaC docs](https://render.com/docs/infrastructure-as-code)
- Adoption: "You can add an existing Render resource to your Blueprint". You must restate all current settings, because omitted options fall back to defaults — [Render IaC docs](https://render.com/docs/infrastructure-as-code)
- Render also publishes a partner-tier Terraform provider, `render-oss/render` v1.9.1 (22 July 2026) — [Terraform Registry API](https://registry.terraform.io/v1/providers/render-oss/render), [repo](https://github.com/render-oss/terraform-provider-render)

**Railway**
- Old Config as Code (`railway.toml`/`railway.json`) is deprecated: "Config as Code is deprecated". Existing files keep working for legacy services until 2026-12-01. It only covered build and deploy settings for a single deployment (builder, start/pre-deploy commands, replicas, restart policy, cron, healthchecks, per-environment and `pr` overrides). Code overrides the dashboard per deployment, but "The settings in the dashboard will not be updated with the settings defined in code" — [Railway Config as Code](https://docs.railway.com/reference/config-as-code)
- New Railway Infrastructure as Code is one project-level file in `.railway/`: `railway.ts` is GA, and `railway.py`/`railway.go` are beta. It declares services, databases, volumes, buckets, custom domains, environment variables, replicas and canvas groups — [Railway IaC](https://docs.railway.com/infrastructure-as-code)
- Plan/apply: `railway config plan` is read-only. `apply` re-plans and asks for confirmation (`--yes` skips it). Destructive changes are flagged and need `--confirm-destructive` in non-interactive runs. A stale plan is rejected if the environment changed after planning. `--detailed-exit-code` returns 2 when changes are pending — [Railway IaC](https://docs.railway.com/infrastructure-as-code)
- Secrets: imported variables are written as `preserve()` references, so the values stay on Railway and out of source. "Variable values are redacted in plan output by default". `--include-variables` inlines non-sealed values with a warning. Sealed variables always stay as `preserve()` — [Railway IaC](https://docs.railway.com/infrastructure-as-code)
- Deletion and import: in single-file mode, removing a resource from the file deletes it on the next apply. Volumes are handled conservatively. `railway config pull` writes the live project to the file, and a follow-up plan should show no changes. `railway config migrate` converts old Config as Code files — [Railway IaC](https://docs.railway.com/infrastructure-as-code)
- CI: the `railwayapp/config` GitHub Action plans on PRs that touch `.railway/**` and applies the saved plan on merge ("Merging is the approval"). It needs `RAILWAY_TOKEN` — [Railway IaC](https://docs.railway.com/infrastructure-as-code)
- Templates (marketplace or private): services from a GitHub repo or Docker image, variables, public networking (HTTP/TCP proxy) and volumes. Template functions `${{ secret(length, alphabet) }}` (default 32 chars) and `${{ randomInt(min,max) }}` are evaluated at deploy time — [Railway template guide](https://docs.railway.com/guides/create)
- A Railway bot on the community forum says new services can no longer opt into Config as Code as of 2026-08-28. This is lower-authority and not confirmed in the official docs — [Railway Station forum](https://station.railway.com/questions/railway-toml-has-no-effect-what-replac-b623aa81)
- Community Terraform provider: `terraform-community-providers/railway` v0.6.3 (19 Oct 2026, community tier) — [Terraform Registry API](https://registry.terraform.io/v1/providers/terraform-community-providers/railway)

**Heroku app.json and Heroku Button**
- app.json declares `env` (with `description`, `value`, `required`, and `generator: "secret"` — "Currently the only supported generator is `secret`"), `addons` (`plan`, `as`, `options`), `formation`, `buildpacks` (Cedar only; Fir-generation apps use `project.toml`), `scripts.postdeploy`/`pr-predestroy`, and `environments` (only `test` for Heroku CI and `review` for Review Apps) — [Heroku app.json schema](https://devcenter.heroku.com/articles/app-json-schema)
- It is one-shot: "The `app.json` will only be processed and analyzed when creating a new app, not when re-deploying one". `postdeploy` runs "_once_, after the app is created and not on subsequent deploys" — [Heroku app.json schema](https://devcenter.heroku.com/articles/app-json-schema)
- Platform status: third-party coverage reports that on 6 Feb 2026 Heroku announced a "sustaining engineering" model (stability over new features, and no enterprise contracts for new customers), with no shutdown announced. Several of these sources are competitors, and I did not fetch Heroku's own post — [DeployHQ](https://www.deployhq.com/blog/heroku-sustaining-engineering-alternatives), [Aptible](https://www.aptible.com/heroku-alternatives/heroku-sustaining-engineering)

**Fly.io (`fly launch`, `fly.toml`)**
- `fly launch` creates an app "from source code or a Docker image" and writes `fly.toml`. `--db` provisions Postgres: "mpg (managed postgres), upg/legacy (unmanaged postgres), or true". `--no-db`, `--no-redis` and `--no-object-storage` skip automatic provisioning. It can also add a GitHub deploy workflow (`--no-github-workflow` skips it) — [flyctl launch reference](https://docs.fly.io/flyctl/launch)
- Secrets at launch: `--secret NAME=VALUE` (repeatable), `--file-secret`, and `--env` for plain values. Other relevant flags are `--from` (a GitHub repo as template), `--copy-config`, `--no-deploy`, `--yes` and `--generate-name` — [flyctl launch reference](https://docs.fly.io/flyctl/launch)
- The Fly Terraform provider `fly-apps/fly` last released v0.0.23 on 22 June 2023, so it is effectively unmaintained — [Terraform Registry API](https://registry.terraform.io/v1/providers/fly-apps/fly)

**Coolify (self-hosted PaaS)**
- The stack definition is a docker-compose file, either Git-based or pasted ("Docker Compose Empty"). Magic variables generate values: `SERVICE_URL_<ID>`/`SERVICE_FQDN_<ID>` (derived from the wildcard domain), `SERVICE_USER_<ID>`, `SERVICE_PASSWORD_<ID>` (32 chars, with `_64_` variants), `SERVICE_BASE64_<ID>` (alphanumeric despite the name), `SERVICE_REALBASE64_`, and `SERVICE_HEX_<size>_` — [Coolify compose docs](https://coolify.io/docs/knowledge-base/docker/compose)
- "Generated values persist between deployments and appear under Environment Variables". Reusing the same variable name shares one value between services, e.g. a database and its client — [Coolify compose docs](https://coolify.io/docs/knowledge-base/docker/compose)
- Community Terraform providers exist (e.g. `SierraJC/terraform-provider-coolify`, 60 stars, pushed 28 Oct 2026; `coolify-terraform/terraform-provider-coolify`, 35 stars). None is official — [GitHub](https://github.com/SierraJC/terraform-provider-coolify), [GitHub](https://github.com/coolify-terraform/terraform-provider-coolify)

**Kamal**
- Secrets come from `.kamal/secrets` using `kamal secrets fetch`/`extract`/`print` with adapters for 1Password, LastPass, Bitwarden, Bitwarden Secrets Manager, AWS Secrets Manager, Doppler, GCP Secret Manager and Passbolt. "The helpers will handle signing in, asking for passwords, and efficiently fetching the secrets" — [Kamal secrets docs](https://kamal-deploy.org/docs/commands/secrets/)

### Inferences
- For Nina's stack (Cloudflare DNS and Tunnel, Vercel, Resend, Stripe, Google OAuth, AWS EC2, GitHub secrets), no PaaS manifest covers more than the hosting/database slice. A per-app setup skill would still need an IaC engine or scripted CLIs for DNS, email domain verification, Stripe webhooks and OAuth.
- Re-run safety differs by manifest:
  - Render Blueprint and Railway IaC are convergent and safe to re-run.
  - Heroku app.json and Railway templates are create-time copies, so re-running means "create another app".
  - `fly launch` is a scaffolder. Re-runs are not documented as idempotent; the expected pattern is `fly deploy` against an existing `fly.toml`.
- Kamal (from general knowledge, not verified this session) deploys containers to servers that already exist and runs "accessories" such as a database container. It does not create servers or DNS, so it pairs with Terraform/Pulumi, a script, or a hand-made EC2 box.

### Gaps
- Fly: I did not verify how `fly launch` behaves when re-run against an existing app, or exactly which Fly extensions (Upstash, Tigris, Sentry) set secrets automatically.
- Coolify: no documented API or CLI for repeatable whole-instance setup was found in the compose page. Whether Coolify's API covers servers, projects and DNS was not verified.
- Kamal: the secrets page does not say how values reach containers (env files on hosts) or what accessories manage. Not verified this session.
- Railway IaC: I found no GA date, and nothing on generated secrets (the template `secret()` function vs IaC).
- Heroku: the primary Heroku blog post about sustaining engineering was not fetched.

## Q2. IaC engines (Terraform/OpenTofu, Pulumi + ESC, SST v3, CDK/CDKTF, Encore): which maintained providers exist for Cloudflare, Vercel, Stripe, Resend, Google Cloud (incl. OAuth clients), AWS, GitHub, Supabase, Neon, Clerk, Auth0, Apple

### Takeaway
Cloudflare, Vercel, AWS, Google, GitHub and Auth0 all have mature, vendor-maintained Terraform providers, and Pulumi bridges every one of them. Supabase is vendor-maintained but community-tier. Stripe has had an *official* provider since January 2026, but it is still 0.x (v0.3.0, Aug 2026) and has no Connect account-settings resource. Resend, Clerk and Apple have only small community providers. Neon has a community provider that Neon sponsors but does not support. Google consumer OAuth clients and consent screens can't be created by any API: the IAP OAuth Admin API, the only programmatic route, was deprecated on 22 Jan 2025, and new clients have to be made in the Cloud console. CDKTF was sunset and archived on 10 Dec 2025.

### Cited Findings

**Provider matrix (Terraform Registry data as of 7 Nov 2026)**

| Service | Terraform/OpenTofu provider | Maintainer / tier | Latest (date) | Pulumi package |
|---|---|---|---|---|
| Cloudflare | `cloudflare/cloudflare` | Cloudflare / partner | 5.28.1 (20 Oct 2026), ~391M downloads | `pulumi/cloudflare` 6.23.3 (bridged, 5 Nov 2026) |
| Vercel | `vercel/vercel` | Vercel / partner | 5.26.0 (6 Nov 2026) | `pulumiverse/vercel` 5.25.0 (community Pulumiverse, 5 Nov 2026). An older `pulumi/vercel` 4.6.0 is from Mar 2026 |
| Stripe | `stripe/stripe` | Stripe / partner (repo created 21 Jan 2026) | 0.3.0 (13 Aug 2026) | `stripe` 0.3.0, published by Pulumi from the OpenTofu source (15 Aug 2026) |
| Resend | none official. `jhoward321/resend` | community (1 star, created Mar 2026) | 0.2.0 (15 Jul 2026), ~12k downloads | none found |
| Google Cloud | `hashicorp/google` | HashiCorp/Google / official | 8.10.0 (3 Nov 2026) | `pulumi/gcp` 10.2.0 (20 Oct 2026) |
| AWS | `hashicorp/aws` | HashiCorp / official | 6.72.0 (4 Nov 2026) | `pulumi/aws` 7.54.0 (6 Nov 2026) |
| GitHub | `integrations/github` | GitHub / partner | 6.13.0 (8 Jul 2026) | `pulumi/github` 6.15.1 (2 Nov 2026) |
| Supabase | `supabase/supabase` | Supabase / community tier | 1.11.1 (6 Nov 2026) | Any-Terraform-Provider listing `supabase` 1.11.0 |
| Neon | `kislerdm/neon` | community (Neon-sponsored, not Neon-supported) | 0.18.0 (11 Sep 2026) | Any-Terraform-Provider listing `kislerdm/neon` 0.18.0 |
| Clerk | none official. Community: `buildwithdeck/terraform-provider-clerk` (5 stars, created Feb 2026), `bertie-technology/terraform-provider-clerk` (3 stars) | community | — | none found |
| Auth0 | `auth0/auth0` | Auth0/Okta / partner | 1.60.0 (30 Oct 2026) | `pulumi/auth0` 3.56.0 (6 Nov 2026) |
| Apple | none official. Community: `AhmedOsman00/terraform-provider-apple` (App Store Connect and Developer Portal: bundle IDs, capabilities, certificates, devices, profiles, Merchant/Pass Type IDs, IAPs; 4 stars), `TrueTickets/terraform-provider-appleappstoreconnect` (3 stars) | community | — | none found |
| Render | `render-oss/render` | Render / partner | 1.9.1 (22 Jul 2026) | — |
| Railway | `terraform-community-providers/railway` | community | 0.6.3 (19 Oct 2026) | — |
| Fly.io | `fly-apps/fly` | Fly / partner, stale | 0.0.23 (22 Jun 2023) | — |

Sources for the table:
- Terraform Registry API: [stripe/stripe](https://registry.terraform.io/v1/providers/stripe/stripe), [cloudflare/cloudflare](https://registry.terraform.io/v1/providers/cloudflare/cloudflare), [vercel/vercel](https://registry.terraform.io/v1/providers/vercel/vercel), [integrations/github](https://registry.terraform.io/v1/providers/integrations/github), [supabase/supabase](https://registry.terraform.io/v1/providers/supabase/supabase), [kislerdm/neon](https://registry.terraform.io/v1/providers/kislerdm/neon), [auth0/auth0](https://registry.terraform.io/v1/providers/auth0/auth0), [hashicorp/google](https://registry.terraform.io/v1/providers/hashicorp/google), [hashicorp/aws](https://registry.terraform.io/v1/providers/hashicorp/aws), [jhoward321/resend](https://registry.terraform.io/v1/providers/jhoward321/resend)
- Pulumi Registry API: [vercel](https://api.pulumi.com/api/registry/packages?name=vercel), [stripe](https://api.pulumi.com/api/registry/packages?name=stripe), [cloudflare](https://api.pulumi.com/api/registry/packages?name=cloudflare)
- GitHub repos: [stripe](https://github.com/stripe/terraform-provider-stripe), [resend](https://github.com/jhoward321/terraform-provider-resend), [clerk (buildwithdeck)](https://github.com/buildwithdeck/terraform-provider-clerk), [clerk (bertie-technology)](https://github.com/bertie-technology/terraform-provider-clerk), [apple (AhmedOsman00)](https://github.com/AhmedOsman00/terraform-provider-apple), [apple (TrueTickets)](https://github.com/TrueTickets/terraform-provider-appleappstoreconnect)
- Searches of the Terraform Registry for `resend/resend`, `clerk/clerk` and `clerkinc/clerk` returned "provider not found"

**Cloudflare, Vercel, GitHub resource coverage (verified from provider repos)**
- Cloudflare v5 has `dns_record`, `zone`, `zone_setting`, `zone_dnssec`, `zero_trust_tunnel_cloudflared`, `zero_trust_tunnel_cloudflared_config`, `zero_trust_tunnel_cloudflared_route`, `email_routing_*`, `email_sending_subdomain`, `turnstile_widget`, `r2_bucket`, `workers_script` and more — [cloudflare provider docs/resources](https://github.com/cloudflare/terraform-provider-cloudflare/tree/main/docs/resources)
- Vercel has `project`, `project_domain`, `project_environment_variable(s)`, `shared_environment_variable`, `dns_record`, `custom_environment`, `deployment`, `edge_config`, `firewall_config`, `log_drain`, `webhook`, `oauth_app`/`oauth_app_client_secret`, `team_member` and more — [vercel provider docs/resources](https://github.com/vercel/terraform-provider-vercel/tree/main/docs/resources)
- GitHub has `actions_secret`, `actions_environment_secret`, `actions_environment_variable`, `actions_organization_secret`, `repository_environment`, `repository_environment_deployment_policy`, plus Dependabot and Codespaces secrets — [github provider docs/resources](https://github.com/integrations/terraform-provider-github/tree/main/docs/resources)

**Stripe (official provider)**
- Stripe documents it as "Manage Stripe resources with infrastructure as code", with `source = "stripe/stripe"` and the key from `STRIPE_API_KEY` — [Stripe Terraform docs](https://docs.stripe.com/terraform), [install](https://docs.stripe.com/terraform/install)
- Resources documented on the Stripe site: billing meters, coupons, customers, entitlements features, products, prices, promotion codes, shipping rates, tax rates, `stripe_webhook_endpoint`, and `stripe_v2_core_event_destination` (webhooks and Amazon EventBridge, with routing from connected accounts) — [Stripe Terraform resources](https://docs.stripe.com/terraform/resources)
- The repo `docs/resources` also lists `billing_portal_configuration`, `payment_method_configuration`, `payment_method_domain`, `apple_pay_domain`, `tax_registration`, `payment_link`, `person`, `subscription` and others. There is **no account/Connect-settings resource** in the list — [stripe provider repo](https://github.com/stripe/terraform-provider-stripe)
- The README says: "This repository is automatically generated from Stripe's internal tooling". Releases went v0.3.0-beta.2 (17 Jul 2026) → v0.3.0 (13 Aug 2026) — [stripe provider repo](https://github.com/stripe/terraform-provider-stripe)
- Webhook signing secret: `secret` (String, Sensitive) is "Only returned at creation", so it lives in state — [webhook_endpoint doc](https://github.com/stripe/terraform-provider-stripe/blob/main/docs/resources/webhook_endpoint.md)
- Older community Stripe providers exist (lukasaron, andrewbaxter, franckverrot) — [pkg.go.dev lukasaron](https://pkg.go.dev/github.com/lukasaron/terraform-provider-stripe), [andrewbaxter](https://github.com/andrewbaxter/terraform-provider-stripe)

**Resend**
- The only providers are community ones. `jhoward321/resend` (on the registry) has `api_key`, `domain` and `webhook` resources. `chronark/terraform-provider-resend` (7 stars) was last pushed in Jan 2024 — [jhoward321 repo](https://github.com/jhoward321/terraform-provider-resend), [chronark repo](https://github.com/chronark/terraform-provider-resend)

**Supabase and Neon**
- Supabase resources: `project`, `settings`, `apikey`, `branch`, `edge_function`, `edge_function_secrets`, `third_party_auth` — [supabase provider repo](https://github.com/supabase/terraform-provider-supabase)
- Neon's own guide says the `kislerdm/neon` provider is not maintained or officially supported by Neon. Neon's reference page calls it community-maintained, covering projects, branches, endpoints, roles, databases and API keys, and warns that API changes "may not immediately appear in community-maintained providers" — [Neon OpenTofu guide](https://neon.com/guides/opentofu-neon), [Neon Terraform reference](https://neon.com/docs/reference/terraform), [kislerdm repo](https://github.com/kislerdm/terraform-provider-neon)

**Google Cloud OAuth clients, brands and consent screens**
- "As of January 22, 2025, the IAP OAuth 2.0 Admin API, which is used to create an IAP OAuth 2.0 client, is deprecated."
  - Affected: `v1.projects.brands` and `v1.projects.brands.identityawareproxyclients`, and the gcloud commands `gcloud iap oauth-brands` and `gcloud iap oauth-clients`.
  - "You can no longer create or manage custom OAuth clients using the IAP OAuth Admin API." Existing clients keep working.
  - The replacement is a Google-managed OAuth client for IAP, limited to same-org users. Custom branding or external users require a client made in the Cloud console, with its secret stored in Secret Manager.
  - Source: [Google: Migrate from the IAP OAuth Admin API](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)
- Timeline: deprecated 22 Jan 2025. The Terraform/Pulumi `iap.Client` resource "stopped working as intended" and new projects lost access on 19 Jan 2026. Permanent shutdown was 19 March 2026. `google_iap_brand` can only create "Organization Internal" brands, and destroying it only removes it from state. The migration page itself gives no shutdown date; the dates come from the deprecations page and Pulumi's notice — [Google IAP deprecations](https://docs.cloud.google.com/iap/docs/deprecations), [Pulumi gcp.iap.Client](https://www.pulumi.com/registry/packages/gcp/api-docs/iap/client/)
- The "newer" `gcloud iam oauth-clients create` (iam/v1 `oauthClients`, Pulumi `gcp.iam.OauthClient`) is for **Workforce Identity Federation** users accessing Google Cloud. It is not for "Sign in with Google" in a consumer app — [gcloud iam oauth-clients create](https://docs.cloud.google.com/sdk/gcloud/reference/iam/oauth-clients/create), [Pulumi gcp.iam.OauthClient](https://www.pulumi.com/registry/packages/gcp/api-docs/iam/oauthclient/)
- A Sep 2026 commentary post argues Google OAuth client creation is console-only while service accounts are scriptable (opinion/secondary; seen only as a search snippet) — [API Evangelist, 8 Sep 2026](https://apievangelist.com/2026/09/08/google-oauth-console-only-service-accounts-scriptable/)

**SST v3, CDKTF, Encore**
- SST v3 "is built on Pulumi and Terraform" and "supports 150+ providers", including Cloudflare, Stripe, Vercel and Auth0. `sst add <provider>` installs one and adds it to `sst.config.ts`. Versions are pinned and don't auto-update — [SST providers](https://sst.dev/docs/providers)
- CDKTF was sunset and archived on 10 Dec 2025 ("did not find product-market fit at scale"), and prebuilt provider bindings stopped then. HashiCorp recommends `cdktf synth --hcl` to export to HCL — [hashicorp/terraform-cdk README](https://github.com/hashicorp/terraform-cdk)
- Encore is infrastructure-from-code: resources declared in TS/Go map to cloud equivalents (e.g. SQL → RDS on AWS, Cloud SQL on GCP). Encore Cloud's automated provisioning supports AWS and GCP only. `encore secret set --type prod|dev,preview,local` sets secrets, and deploys fail if any secret is undefined. In your own cloud, secrets are replicated into that cloud's secret manager — [Encore secrets](https://encore.dev/docs/ts/primitives/secrets), [Encore infra automation](https://encore.dev/use-cases/devops-automation)
- Pulumi can use any Terraform/OpenTofu provider via `pulumi package add terraform-provider <ns>/<name>` (Pulumi ≥ 3.147.0), which generates a local SDK. Supabase is an example of an "Any Terraform Provider" registry listing — [Pulumi Any Terraform Provider](https://www.pulumi.com/docs/iac/concepts/providers/any-terraform-provider/), [registry](https://www.pulumi.com/registry/packages/terraform-provider/)

### Inferences
- **Coverage for this user's services, best to worst:**
  - Cloudflare (zones, DNS, tunnels), Vercel (projects, env vars, domains), GitHub (repo and environment secrets) and AWS (EC2, Route 53, SES via `hashicorp/aws`) are safe to manage declaratively.
  - Stripe: fine for webhook endpoints, products and prices, but young (0.x, auto-generated).
  - Resend: too thin to rely on. A script against the Resend API, or a light wrapper, is likely more robust.
  - Google OAuth client and consent screen: must stay manual (a console step, with the secret handed off securely).
- The Stripe webhook `secret` lands in state at creation. If Stripe is managed by IaC, the state backend must be treated as a secret store, or the signing secret must be captured once and moved elsewhere.
- AWS CDK only targets CloudFormation. Third-party coverage depends on CloudFormation Registry extensions. This was not researched this session, so treat CDK as AWS-only for planning.
- SST is a reasonable "one TypeScript file" front end if AWS or Cloudflare is the home. It inherits Pulumi's bridged providers, so its coverage equals the matrix above.

### Gaps
- The Pulumi Registry API lists the `stripe` package with source "opentofu" and publisher "pulumi". I did not confirm whether this is an Any-Terraform-Provider listing or a dedicated bridged package.
- I did not find a Clerk Platform/Backend API for instance-level configuration (OAuth providers, domains), so I can't say how close a community Clerk provider can get.
- Apple: none of the community providers was confirmed to create "Sign in with Apple" Service IDs or keys, or to handle App Store Connect API key issuance. Assume manual.
- Google: I did not verify whether `google_project` creation works without an Organization (personal Gmail accounts) using a user credential versus a service account.
- Whether the Resend API supports creating restricted-scope API keys per domain was not checked against Resend's API reference.

## Q3. How engines store state and secret outputs, and how they push secrets into targets (GitHub Actions secrets, Vercel env vars, a server's .env)

### Takeaway
Terraform state stores sensitive attributes in plaintext unless the provider uses write-only (`*_wo`) arguments (Terraform 1.11+, OpenTofu 1.11+) or the state is encrypted (OpenTofu client-side encryption, or the backend's encryption at rest). Pulumi and SST encrypt secret values inside state with a per-stack key or passphrase. Vercel env vars support `value_wo`. GitHub secrets are still written to state unless you pass a pre-encrypted value. Pulumi ESC can push secrets out on a schedule via a Pulumi program. Railway IaC keeps values on Railway via `preserve()`.

### Cited Findings
- Terraform 1.10 (Nov 2024) added ephemeral resources, and 1.11 (Feb 2025) added write-only arguments, which "are not stored in Terraform artifacts like the plan or state file". Updates are triggered by bumping a stored `*_wo_version`. Examples: `aws_db_instance.password_wo`, `aws_secretsmanager_secret_version.secret_string_wo`. HashiCorp notes full coverage "requires every Terraform provider" to adopt it — [HashiCorp: Terraform 1.11 blog](https://www.hashicorp.com/blog/terraform-1-11-ephemeral-values-managed-resources-write-only-arguments)
- OpenTofu shipped ephemeral resources and write-only attributes in v1.11.0 (9 Dec 2025), per third-party coverage — [Scalr learning center](https://scalr.com/learning-center/secrets-in-terraform-state)
- OpenTofu state encryption covers "state and plan files at rest, both for local storage and when using a backend".
  - Key providers: PBKDF2 (passphrase ≥16 chars), AWS KMS, GCP KMS, OpenBao, Azure Vault, OVHcloud KMS, and external.
  - A `fallback` block supports key rollover.
  - It "does not and cannot protect the sensitive values in the state file from the person running the `tofu` command".
  - Source: [OpenTofu state encryption](https://opentofu.org/docs/language/state/encryption/)
- Vercel provider: since v4.8.0, env vars must set `sensitive` explicitly. "Write-Only argument `value_wo` is available to use in place of `value`" (Terraform ≥ 1.11) — [vercel project_environment_variable doc](https://github.com/vercel/terraform-provider-vercel/blob/main/docs/resources/project_environment_variable.md)
- GitHub provider `actions_secret`:
  - `value` is marked sensitive, but "**this does not hide it from state files**".
  - The docs advise passing `value_encrypted`, which is pre-encrypted with the repo public key.
  - `plaintext_value` and `encrypted_value` are now deprecated.
  - A placeholder-plus-`ignore_changes` pattern is documented for values set outside Terraform.
  - Imported secrets don't populate value fields in state.
  - Source: [github actions_secret doc](https://github.com/integrations/terraform-provider-github/blob/main/docs/resources/actions_secret.md)
- Stripe `stripe_webhook_endpoint.secret` is Sensitive and "Only returned at creation" — [stripe webhook_endpoint doc](https://github.com/stripe/terraform-provider-stripe/blob/main/docs/resources/webhook_endpoint.md)
- SST state is generated locally and backed up to a `sst-state-<hash>` bucket on the home provider (AWS or Cloudflare). "The passphrase is used to encrypt any secrets and sensitive information", and it is stored in SSM at `/sst/passphrase/<app>/<stage>`. Removing an app does not remove state or bootstrap resources — [SST state docs](https://sst.dev/docs/state)
- Pulumi ESC sync: ESC is the source of truth, and a Pulumi IaC stack reads a `sync` block and writes the values to the target. The sync runs on a schedule (hourly by default) or by webhook on change. Examples include AWS Secrets Manager, GitHub secrets, Azure Key Vault, GCP Secret Manager and HashiCorp Vault. It requires Pulumi Deployments for the target stack — [Pulumi ESC sync guide](https://www.pulumi.com/docs/esc/guides/sync-secrets-to-external-platforms/), [Pulumi blog: ESC sync with IaC](https://www.pulumi.com/blog/esc-sync-with-iac/)
- Pulumi ESC's built-in rotators (aws-iam, azure-app-secret, mysql, postgres, snowflake-user, password, passphrase, external) are rotators, not push targets — [Pulumi ESC rotators](https://www.pulumi.com/docs/esc/integrations/rotated-secrets/)
- Railway IaC keeps variable values on Railway via `preserve()` and redacts them in plan output by default — [Railway IaC](https://docs.railway.com/infrastructure-as-code)
- Kamal pulls secrets at deploy time from password managers and cloud secret stores through `.kamal/secrets` adapters — [Kamal secrets](https://kamal-deploy.org/docs/commands/secrets/)
- Encore replicates secrets into the target cloud's secret manager when deploying to your own AWS or GCP — [Encore secrets](https://encore.dev/docs/ts/primitives/secrets)
- The IAP migration guide recommends Secret Manager for OAuth client secrets created in the console, because "the client secret is displayed only at that time" — [Google IAP migration](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)

### Inferences
- **Pushing into a server's `.env`:** no engine has a first-class ".env on a VM" resource. The common patterns (general knowledge, not verified this session) are:
  - cloud-init/user-data templated by Terraform (which puts the secret into state and EC2 user-data),
  - the Pulumi `command` provider (`pulumi/command` 1.3.0, native, seen in the registry API) running remote SSH commands,
  - or having the server pull from a secret store at boot or deploy time (SSM/Secrets Manager, Kamal adapters).
  The pull model avoids secrets in state.
- A safe pattern for a skill: generate high-entropy secrets with ephemeral resources, write them via `*_wo` to Vercel/AWS, use `value_encrypted` for GitHub, and keep state encrypted (OpenTofu encryption, or an S3/R2 backend with KMS and tight IAM). Anything shown only once (Stripe webhook secret, Resend API key, Google OAuth secret) needs a one-time capture step into the chosen secret store.

### Gaps
- I did not verify whether the Cloudflare tunnel resource's tunnel token/secret, or the Resend community provider's `api_key` token, is stored in state or offered as write-only.
- Pulumi's default secrets provider (the Pulumi Cloud per-stack key, or a passphrase/KMS for self-managed backends) was not re-fetched this session.
- No source was fetched for Vercel or GitHub as ESC sync targets beyond the GitHub example's mention.

## Q4. Plan/apply, drift detection, idempotent re-runs, and importing hand-made resources

### Takeaway
Terraform/OpenTofu and Pulumi converge declared state toward the real world:
- **Re-run safety:** a re-run with no changes is a no-op.
- **Drift detection:** `terraform plan -refresh-only` / `pulumi refresh --preview-only`, scheduled in HCP Terraform, Pulumi Deployments or plain CI.
- **Adopting hand-made resources:** `import` blocks with `-generate-config-out` (Terraform 1.5+), or `pulumi import`, which generates code and marks resources protected.

Among PaaS options, Railway IaC has a true plan/apply loop with a stale-plan guard and destructive-change gating. Render Blueprints overwrite conflicting dashboard edits but never delete removed resources. SST `refresh` only fixes state.

### Cited Findings
- Terraform `import { to = ..., id = ... }` plus `terraform plan -generate-config-out="generated_resources.tf"` writes config for imported resources (experimental since v1.5). Generation can produce invalid configs, e.g. conflicting arguments, which need manual fixing — [Terraform: generating configuration](https://developer.hashicorp.com/terraform/language/import/generating-configuration)
- `pulumi import <type> <name> <id>` adds the resource to state and prints code, and imported resources are protected by default. Bulk import is `pulumi preview --import-file` then `pulumi import --file`. "Don't run `pulumi up` before importing", or Pulumi would try to create duplicates. Write-only values such as passwords are not recovered, and normalisation can cause extra diffs — [Pulumi import guide](https://www.pulumi.com/docs/iac/guides/migration/import/)
- Pulumi drift detection: Pulumi Cloud runs a scheduled preview-only refresh and shows results in a Drift tab. Optional auto-remediation runs `pulumi up --refresh`. Non-Deployments users can run `pulumi refresh --preview-only` in their own CI — [Pulumi drift docs](https://www.pulumi.com/docs/deployments/concepts/drift/), [Pulumi blog: drift detection](https://www.pulumi.com/blog/drift-detection/)
- Caution (Pulumi blog, partly dated): a first refresh can sync previously "untracked" fields and trigger extra updates or replacements, so run and inspect a manual refresh first — [Pulumi blog: patterns drift detection](https://www.pulumi.com/blog/patterns-drift-detection/)
- HCP Terraform health assessments, Scalr, env0 and Spacelift are cited as platform-native drift detection. This comes from a vendor comparison — [Scalr drift guide](https://scalr.com/learning-center/terraform-drift-detection-how-to-prevent-and-remediate)
- Terraform/OpenTofu can't detect drift in resources they don't manage — [Terramate guide](https://terramate.io/rethinking-iac/the-ultimate-guide-for-terraform-and-opentofu-drift-detection-and-remediation)
- SST: manual console changes can make a deploy a no-op, because config matches state rather than reality. `sst refresh` reconciles state with the provider, but "does not make changes to the resources in the cloud provider". A later deploy can then recreate deleted resources — [SST state](https://sst.dev/docs/state)
- Railway IaC: plan compares the file with the live environment, rejects stale plans, gates destructive changes with `--confirm-destructive`, and offers `railway config pull` for adopting an existing project (the follow-up plan should be empty) — [Railway IaC](https://docs.railway.com/infrastructure-as-code)
- Render Blueprint: conflicting dashboard changes are overwritten on the next sync, manually deleted managed resources are recreated, removed definitions are not deleted (except read replicas), and existing resources can be adopted by restating all their settings — [Render IaC](https://render.com/docs/infrastructure-as-code)
- Heroku app.json is only processed at app creation, so it has no re-run or drift model — [Heroku app.json schema](https://devcenter.heroku.com/articles/app-json-schema)
- GitHub secrets imported into Terraform have no value in state, so `ignore_changes` is the documented workaround — [github actions_secret doc](https://github.com/integrations/terraform-provider-github/blob/main/docs/resources/actions_secret.md)
- `google_iap_brand` destroy only removes the resource from state, not from Google Cloud — [Pulumi gcp.iap.Client / brand notice](https://www.pulumi.com/registry/packages/gcp/api-docs/iap/client/)

### Inferences
- For an agent-run skill, "run it again" is safest with: Terraform/OpenTofu or Pulumi with a remote, locked and encrypted state; `plan` reviewed (or `--detailed-exit-code` style gating) before `apply`; and `prevent_destroy` / Pulumi `protect` on DNS zones, databases and Stripe objects. Railway's `--confirm-destructive` and stale-plan guard are a good model to copy in a custom script.
- Script/CLI orchestration can match this only if each step is written as "get-or-create" with a lookup key: DNS record name+type, Stripe webhook URL or `lookup_key` on prices, Resend domain name, GitHub secret name. It also needs a local manifest of IDs, which acts as a mini-state.
- Some resources can't be deleted or are immutable, e.g. Stripe prices are archived rather than deleted (general Stripe API knowledge, not verified this session). IaC "destroy" for these may just deactivate, so plans can show surprising replaces.

### Gaps
- I did not verify `for_each` support in Terraform import blocks (added in 1.7 per general knowledge), the HCP Terraform health-assessment pricing tier, or OpenTofu's equivalent of `-generate-config-out`.
- I did not verify how the Stripe provider handles delete for prices or products (archive vs error).

## Q5. Practitioner lessons on full-stack IaC for small SaaS (cost, complexity, lock-in) and when a script/CLI is recommended instead

### Takeaway
Practitioner evidence is anecdotal and mostly blog-grade. The rough consensus:
- **Pro-IaC:** worth it once there are real users or data, or a second environment; keep it flat (one config, one remote state, no modules).
- **Script-first:** for a single VPS, or when the team doesn't know the tooling, scripts or Ansible plus a shell script are simpler, and some teams moved off Terraform to reduce maintenance.
- **Lock-in signals from 2025–26:** CDKTF was archived; Railway force-migrated from `railway.toml` to a new DSL within months; Heroku moved to sustaining engineering. Each is evidence that tool and platform churn is a real cost.

### Cited Findings
- Opinion: for a solo founder running everything on one VPS, "an Ansible playbook plus a shell script" is often simpler than Terraform with a cloud abstraction. If you do use Terraform, a single-app setup needs only a main file, durable state and `apply`, with no modules or workspaces — [Pickuma: IaC for solo founders](https://pickuma.com/for-dev/infrastructure-as-code-solo-founders/)
- Anecdote: one team replaced Terraform with Bash because maintenance cost exceeded the value, and reports savings "but not without pain" (single data point, Medium) — [AWS in Plain English](https://aws.plainenglish.io/why-we-replaced-terraform-with-bash-and-it-saved-us-thousands-but-not-without-pain-b95c070dd852)
- Counter-opinion: a solo developer has no DevOps team to rescue them, so "overkill" is a myth and IaC gives reproducibility and history — [Stackademic: Terraform for solo devs](https://blog.stackademic.com/terraform-for-solo-devs-infrastructure-as-code-without-the-pain-8e6a781f0395)
- Opinion (consultancy): a small, stable service needs only one flat Terraform config with a remote backend. Once there are real users, real data or a second environment, the cost of skipping IaC grows, so adopt it before launch — [Aetherisys: IaC from day one](https://aetherisys-consulting.netlify.app/blog/infrastructure-as-code-from-day-one)
- Practitioner post: one developer uses Terraform so that many side projects can be picked up and played with again — [dev.to: Terraform for side projects](https://dev.to/thundergolfer/using-terraform-to-make-my-many-side-projects-pick-up-and-play-aca)
- Opinion (Reddit, via a proxy mirror, low authority): keep ClickOps until the team is a few dozen people, because a replacement engineer won't know your Terraform setup. But past two environments, ClickOps gets you "in trouble" — [Reddit comment (mirror)](https://redlib.hbubli.cc/r/programming/comments/1cay7xw/im_a_programmer_and_im_stupid/l0x5dq7/?context=3)
- Cost: the Terraform CLI is free, and HCP Terraform is only needed for team collaboration features (third-party pricing page) — [Toolradar Terraform calculator](https://toolradar.com/tools/terraform/calculator)
- Churn and lock-in evidence:
  - CDKTF was archived on 10 Dec 2025 with no further fixes — [hashicorp/terraform-cdk](https://github.com/hashicorp/terraform-cdk)
  - Railway Config as Code is deprecated, with files ignored after 2026-12-01 — [Railway Config as Code](https://docs.railway.com/reference/config-as-code)
  - Heroku is in sustaining-engineering mode as of Feb 2026, per third-party coverage — [DeployHQ](https://www.deployhq.com/blog/heroku-sustaining-engineering-alternatives)
  - Google removed the only OAuth-client API (IAP) in 2025–26 — [Google IAP migration](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)
  - The Fly Terraform provider has had no release since June 2023 — [Terraform Registry API](https://registry.terraform.io/v1/providers/fly-apps/fly)

### Inferences
- **Suggested engine mix for a reusable per-app setup skill** (inference from Q1–Q4, matched to Nina's services):
  1. **Terraform/OpenTofu (HCL, flat, one state per app/env)** or **Pulumi/SST (TypeScript)** for the well-covered, long-lived, drift-prone pieces: Cloudflare zone, DNS and tunnel; Vercel project, domains and env vars; GitHub repo/environment secrets; AWS EC2, Route 53 and SES. Optionally Stripe webhook endpoints and products/prices via the official 0.x provider, with `prevent_destroy`.
  2. **Idempotent scripted CLI/API steps** (get-or-create with a local ID manifest) where providers are community-only or immature. Resend is the main case: create the domain via API, then hand the returned DNS records to the IaC layer or a Cloudflare API call. Clerk and Neon also fit here if preferred. This avoids depending on 1-star providers.
  3. **Manual, checklisted human steps with a secure secret handoff** for things no API supports: Google OAuth consent screen and web client (console-only since the IAP API shutdown); Apple Sign in with Apple keys/Service IDs (unverified API coverage); Stripe Connect platform settings (no provider resource); first-time account signups and billing.
- A plausible split: a PaaS manifest (Render Blueprint, or Railway IaC if on Railway) owns hosting and database, and IaC/scripts own the edges (DNS, email, payments, auth). This avoids writing compute in Terraform when the platform already has a convergent manifest. For a self-managed EC2 box, Kamal (deploy) plus Terraform (EC2/DNS) is the analogous pairing.
- OpenTofu vs Terraform: both now support write-only attributes (TF 1.11, Tofu 1.11). OpenTofu adds native client-side state encryption, which matters if an agent-run skill keeps state in a bucket and handles one-time secrets such as the Stripe webhook signing secret.

### Gaps
- I found no rigorous, quantified study (time or cost) of full-stack IaC versus scripts for small SaaS. All practitioner sources are individual blogs or comments, several of them promotional.
- I could not reach Hacker News threads directly via search, so community sentiment there is not captured.
- No first-hand reports were found from teams managing Stripe or Resend via Terraform in production, beyond provider existence and docs.
