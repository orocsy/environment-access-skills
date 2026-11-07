# Human gates in small-SaaS stack provisioning: what resists automation and how good products present it (state as of 7 Nov 2026)

Method note: these are primary-source notes wherever possible (provider docs fetched in full). A few items came only from search-result excerpts or third-party pages. They are marked "(excerpt)" or "(secondary)" and should be re-checked before anyone relies on them. "Inference" means my reasoning, not something a source says.

## 1. Google: OAuth consent screen/brand, web OAuth client for "Sign in with Google", publishing, verification, basic scopes, and whether Firebase or hosted auth removes the work

### Takeaway
There is no supported public API in Nov 2026 for creating an external OAuth brand/consent screen or a standard "Web application" OAuth client for Sign in with Google. The only API that came close, the IAP OAuth Admin API (brands and clients), was deprecated on 22 Jan 2025 and, per the gcloud reference, shut down on 19 Mar 2026. Even then it only made internal-org clients. Setting up Google Auth Platform, creating the client and publishing to production all stay console-only human steps. Hosted auth providers such as Clerk remove the work in development only, through shared credentials. Production still needs your own Google client and a published, branded consent screen.

### Cited Findings
- **IAP OAuth Admin API deprecated.** As of 22 Jan 2025, Google deprecated the IAP OAuth 2.0 Admin API (`IdentityAwareProxyOAuthService`). This covers the OAuth Client and Brands APIs, plus `gcloud iap oauth-brands` (create/describe/list) and `gcloud iap oauth-clients` (create/delete/describe/list/reset-secret) on all tracks. The migration page names no replacement API for creating brands or clients. It says custom OAuth clients "can no longer" be created or managed through that API, and it points to the Google Cloud console for creating them. Existing clients keep working. — [Google Cloud: Migrate from IAP OAuth Admin API](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)
- **Shutdown dates.** The gcloud reference pages for `gcloud iap oauth-clients` give two dates: support discontinued on 19 Jan 2026, and the APIs "permanently shut down" on 19 Mar 2026. New projects cannot use them. The migration page gives only the 22 Jan 2025 deprecation date and no shutdown date. — [gcloud iap oauth-clients describe](https://cloud.google.com/sdk/gcloud/reference/iap/oauth-clients/describe) (excerpt); compare with [migration page](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)
- **Terraform/Pulumi.** The `gcp.iap.Client` resource "will no longer function" after the deprecation. Declarative tools could only ever create internal-org clients. External clients had to be created by hand in the console. — [Pulumi registry: gcp.iap.Client](https://www.pulumi.com/registry/packages/gcp/api-docs/iap/client/) (secondary, mirrors the Terraform provider docs)
- **`gcloud iam oauth-clients` is a different product.** `gcloud iam oauth-clients create` and `projects.locations.oauthClients` exist, but they are only for Workforce Identity Federation. For standard OAuth 2.0 client IDs, Google points to the console's Credentials page. — [IAM: Manage OAuth application](https://docs.cloud.google.com/iam/docs/workforce-manage-oauth-app); [gcloud iam oauth-clients create](https://docs.cloud.google.com/sdk/gcloud/reference/iam/oauth-clients/create)
- **New console flow.** The console path is Google Auth Platform > Clients > Create client. The project must register the app for Google Auth (the Auth Platform setup) before it can create any OAuth client. — [Google Cloud Help: Manage OAuth Clients](https://support.google.com/cloud/answer/15549257) (excerpt)
- **Separate clients for AI agents.** Google says that if an app supports both user-interactive features and AI agent workflows, each needs its own OAuth client ID. This setting can't be changed after the client is created. — [Google Cloud Help: Manage OAuth Clients](https://support.google.com/cloud/answer/15549257) (excerpt)
- **When brand verification is required.** It applies when the app is External and Published and shows a logo or display name on the consent screen. It is not needed for Testing-status projects, Internal (Workspace) apps, personal use by a few known users, and similar cases. Published branding is a prerequisite for data-access (sensitive/restricted scope) verification. — [Google Identity: Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- **Brand verification requirements.**
  - The home page must be publicly accessible, not only to logged-in users, and clearly relevant to the app. Play Store listings and Facebook pages don't count.
  - The privacy policy must be on the same domain as the home page, be linked from the consent screen, and disclose how Google user data is used.
  - Authorised domains are verified at the top private domain (`sub.example.com` requires `example.com`). They must cover the home page, privacy policy, terms of service, and the web client's redirect URIs and JS origins.
  - Domain ownership is verified in Google Search Console by an account that is Owner or Editor on the project.
  - Automated brand verification usually takes "a few minutes". Manual review takes 2–3 business days. A compliant result is valid for 7 days, after which the status shows "Need to re-verify".
  - — [Google Identity: Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- **Testing limits.** Testing-status projects are limited to 100 test users. Test-user authorisations expire 7 days after consent, and so do any refresh tokens issued. Clicking "Publish app" moves the project to In production. — [Google Cloud Help: Manage App Audience](https://support.google.com/cloud/answer/15549945) (excerpt)
- **Basic-scope exception.** The same article reportedly says that apps requesting only the basic sign-in scopes (openid, userinfo.email, userinfo.profile) are exempt from the test-user list, the warning and the 7-day expiry. The exemption does not apply if any other scope is requested. — [Google Cloud Help: Manage App Audience](https://support.google.com/cloud/answer/15549945) (excerpt; the search tool paraphrased this and I did not read the wording directly). This conflicts with Clerk's guide, which says Testing is limited to 100 test users with no exception, and that production apps must set the status to "In production": [Clerk: Google social connection](https://clerk.com/docs/authentication/social-connections/google)
- **Clerk dev vs production.** Development instances use Clerk's "preconfigured shared OAuth credentials and redirect URIs", so no Google Cloud work is needed. Production instances "must provide custom credentials". The steps are:
  1. Turn on custom credentials in Clerk and copy its redirect URI.
  2. Create a Google Cloud project and a Web-application OAuth client with JS origins and that redirect URI.
  3. Paste the client ID and secret back into Clerk.
  4. Publish the Google app, which involves review of app name, logo and scopes.
  - — [Clerk: Google social connection](https://clerk.com/docs/authentication/social-connections/google)
- **Firebase / Identity Platform.** Firebase creates a client labelled "Web client (auto created by Google Service)". Developers still add Authorised JavaScript origins and the `/__/auth/handler` redirect URI to it in the Cloud console. — [FlutterFlow: Firebase Google sign-in](https://docs.flutterflow.io/firebase/authentication/google-sign-in) (secondary). Identity Platform's Google guide sends users through a "Configure screen" link to Google Auth Platform to set up the OAuth consent screen, and it lets you allow external client IDs. — [Identity Platform: Sign in users with Google](https://cloud.google.com/identity-platform/docs/web/google)

### Inferences
- **Google gate entries for the catalogue:**
  1. **Configure Google Auth Platform** (app name, support email, audience External, developer contact). No API. The human fills one console wizard. A setup tool can pre-compute every value and show copy buttons next to a deep link to the Auth Platform page.
  2. **Create the Web OAuth client.** No API for standard clients. The tool pre-computes the redirect URIs and JS origins (a list to paste). The human pastes them, then pastes the client ID and secret back into a hidden-input or secure-handoff prompt. The secret is shown once, so the paste-back must happen immediately.
  3. **Verify the authorised domain in Search Console.** The DNS TXT record can be automated if the tool controls DNS. Clicking "verify" in Search Console still needs a human, unless the Site Verification API is used (not checked; see Gaps).
  4. **Publish to production, plus brand verification if a logo or name is shown.** No API was found. The human clicks Publish/Verify Branding. The tool's job is to make sure the home page and privacy policy are already live on the authorised domain first, so the automated check passes in minutes.
- **Minimal path for basic scopes only.** If the basic-scope exception really applies, a "no logo" Sign in with Google app could stay in Testing or publish without brand verification. Without verified branding, though, the consent screen won't show the app name or logo. Inference: most production apps will still want branding verified.
- **What hosted auth removes.** Clerk, and likely Auth0/WorkOS dev keys, remove the Google gate only for development. A setup tool can run the whole dev loop on shared credentials and defer the Google console gates to "going live". Firebase removes client creation but not consent-screen configuration, publishing or branding.

### Gaps
- I couldn't confirm the exact Google wording of the basic-scope exception (the excerpt conflicts with Clerk's guide). Re-read support.google.com/cloud/answer/15549945 directly.
- I didn't verify whether the Google Site Verification API can complete Search Console domain verification for OAuth authorised domains programmatically.
- I found no official statement of any replacement API (for example, an Auth Platform/"OAuth config" API) in 2026. Absence in these sources is not proof that none exists.
- I didn't research Auth0, Supabase Auth or WorkOS Google-connection docs. From general knowledge, Supabase Auth requires your own Google client and Auth0/WorkOS offer dev/demo credentials, but this is unverified here.
- I didn't fetch the IAP gcloud reference page in full, so the 19 Jan / 19 Mar 2026 dates come from a search excerpt.

## 2. Apple: Developer Program enrolment, Sign in with Apple service IDs and keys, App Store Connect API capabilities, push keys

### Takeaway
Apple enrolment is a legal-identity gate: a real Apple Account with 2FA, legal name, a D-U-N-S number and legal binding authority for organisations, a licence agreement and payment. No API exists for it. Once enrolled, the App Store Connect API can register bundle IDs and enable capabilities. However, the keys that unlock it, and the Sign in with Apple web Services ID flow, are documented only as web-portal steps, and private keys download once.

### Cited Findings
- **Individual enrolment.** Requires an Apple Account with two-factor authentication and the legal age of majority. You must use your legal name, since aliases or company names delay approval. Apple verifies name, email, phone and address, and P.O. boxes are not accepted. Your name appears as the App Store seller. — [Apple: Enrollment](https://developer.apple.com/programs/enroll/)
- **Organisation enrolment.**
  - You need legal binding authority (owner/founder, executive, senior project lead, or an employee granted authority).
  - The organisation must be a legal entity. DBAs, trade names and branches are not accepted.
  - A D-U-N-S number is required (except for government entities).
  - The work email must be on the organisation's domain.
  - A public, functional website on that domain is required. Registrar parking pages and social-media pages are rejected.
  - — [Apple: Enrollment](https://developer.apple.com/programs/enroll/)
- **Licence and fee.** After verification, the enrollee must agree to the Apple Developer Program License Agreement and pay. The fee is 99 USD a year, in local currency, with fee waivers for eligible nonprofits, educational institutions and government bodies. Enrolment is also possible in the Apple Developer app. — [Apple: Enrollment](https://developer.apple.com/programs/enroll/)
- **Sign in with Apple for the web.** In Certificates, Identifiers & Profiles you:
  1. Create a Services ID.
  2. Enable Sign in with Apple and associate it with a primary App ID that has Sign in with Apple enabled.
  3. Enter domains and return URLs as a comma-separated list.
  - Individuals can register up to 10 website URLs and organisations up to 100. No file upload to your server is needed for domain registration. Creating the private key is covered by a separate article. — [Apple: Configure Sign in with Apple for the web](https://developer.apple.com/help/account/configure-app-capabilities/configure-sign-in-with-apple-for-the-web)
- **App Store Connect API: bundle IDs and capabilities.** The API can register a new bundle ID and rename one. The `bundleIdCapabilities` resource enables (`POST /v1/bundleIdCapabilities`) or disables (`DELETE`) capabilities for a bundle ID. — [ASC API: Bundle IDs](https://developer.apple.com/documentation/appstoreconnectapi/bundle-ids); [ASC API: Bundle ID Capabilities](https://developer.apple.com/documentation/appstoreconnectapi/bundle-id-capabilities)
- **App Store Connect API: keys.**
  - The Account Holder must first request API access under Users and Access > Integrations and agree to terms.
  - Team keys are generated there by an Account Holder or Admin. A key's name and access level can't be edited later.
  - The private key "is available for download a single time".
  - Individual keys come from Edit Profile, one active key per user. Admins can remove the "Generate Individual API Keys" permission.
  - — [App Store Connect Help: App Store Connect API](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api) (excerpt)

### Inferences
- **Apple gate entries for the catalogue:**
  1. **Enrol, including obtaining a D-U-N-S number.** Legally a human act: identity, binding authority, licence acceptance and payment. No API exists. The tool can pre-check the prerequisites in a checklist: public website live on the org domain, work email on that domain, legal entity name exactly matching the D-U-N-S record. It can then deep-link to the enrolment page or the Apple Developer app.
  2. **Request App Store Connect API access, then generate a team key.** This is an Account Holder action plus terms acceptance. Use a one-time secure handoff of the .p8 file plus key ID and issuer ID.
  3. **Create the Sign in with Apple Services ID, return URLs and private key; create the APNs key.** I found no API for these (see Gaps). The tool pre-computes the identifier, domains and return URLs, then deep-links to Identifiers and Keys. The human uploads the .p8 file once through a secure handoff.
- Everything after the keys exist can be automated through the App Store Connect API (bundle IDs, capabilities, and presumably profiles and certificates): bundle ID registration and capability toggling, including, presumably, `SIGN_IN_WITH_APPLE` and `PUSH_NOTIFICATIONS`.

### Gaps
- I couldn't read the `CapabilityType` enum page (it rendered empty). Whether `SIGN_IN_WITH_APPLE` and `PUSH_NOTIFICATIONS` are valid values, and whether Sign in with Apple's "primary App ID" grouping can be set through the API, is unverified.
- I didn't fetch the "Create a Sign in with Apple private key" or APNs key articles. The claims that these keys are portal-only and download once are general knowledge, not verified here.
- I found no source on D-U-N-S lead times or Apple's verification phone call; the enrol page doesn't mention a call.
- Services IDs don't appear among the App Store Connect API resources I saw. I haven't confirmed whether they can be created through the API.

## 3. Stripe: activation/KYC, Connect platform profile and OAuth settings, restricted keys, webhooks, test vs live, Stripe Apps, and agent tooling

### Takeaway
Stripe has the richest agent surface of any provider here: a hosted MCP server, "agent"-tagged restricted keys with approval rules, claimable sandboxes, Stripe Projects, and webhooks and event destinations by API. It still deliberately keeps humans on account activation (the account application), Connect's platform profile and OAuth redirect settings, key creation in the Dashboard, and high-risk actions such as refunds and outbound money, which need a click-to-approve URL. Stripe Atlas states the pattern outright: the agent prepares, and the human reviews, pays, signs and submits.

### Cited Findings
- **Keys are made in the Dashboard.**
  - The API keys Dashboard page is where you "create, reveal, expire and rotate keys".
  - Creating a secret key requires a verification code sent by email or SMS.
  - Live secret keys and restricted keys you create are shown once. In sandboxes you can always see all keys.
  - Key prefixes are `pk_/rk_/sk_` with `_test_` or `_live_`. Each mode has separate keys and objects.
  - Rotation in the Dashboard gives up to 7 days of overlap.
  - Managed API keys, which certain hosting platforms issue and rotate for you, also exist.
  - — [Stripe: API keys](https://docs.stripe.com/keys)
- **Agent keys.** A restricted key can be tagged as belonging to an autonomous agent ("Authorising agent access to your account") when it's created. Agent-tagged keys automatically fall under approval rules: a designated reviewer must approve sensitive actions such as payouts, refunds and account configuration changes. — [Stripe: API keys](https://docs.stripe.com/keys)
- **Stripe MCP.**
  - The hosted server is `https://mcp.stripe.com`. Interactive clients use OAuth, where the consent page grants access per account or sandbox with per-environment permissions. Autonomous clients use agent API keys.
  - "Migrate by 30 November 2026": from December, Stripe MCP stops accepting full-access secret keys and restricted keys without the Agent tag.
  - Admins can enable or disable MCP access for the team, separately for live and sandbox.
  - Connected-account calls need a platform agent key plus a `Stripe-Account` header, because OAuth isn't supported for connected accounts.
  - Some actions carry a "Human confirmation" badge (refunds, Treasury send/convert/transfer). The agent gives the user a URL. The user reviews and clicks Approve. The agent receives an approval token and retries. Approvals expire after 24 hours.
  - — [Stripe: MCP](https://docs.stripe.com/mcp)
- **Stripe Atlas through MCP.** The `atlas_company_formation` tool prepares or resumes an Atlas application. The user then reviews documents, pays, signs and submits in the Dashboard. — [Stripe: MCP](https://docs.stripe.com/mcp)
- **Webhooks and event destinations by API.** Create, list and retrieve webhook endpoints, and create or update v2 event destinations, are all supported API methods, including through MCP. — [Stripe: MCP (supported methods)](https://docs.stripe.com/mcp). Signing secrets are separate from API keys and are found per endpoint in the Dashboard. — [Stripe: API keys](https://docs.stripe.com/keys)
- **Claimable sandboxes.**
  - These are anonymous sandboxes created through `POST /v2/core/claimable_sandboxes`. The response includes test publishable and secret keys plus an optional MCP key, a 60-day sandbox expiry, and a 7-day onboarding link that is renewed through a `refresh_url`.
  - Prefill fields include email, name and country, and 57 countries are supported, including AU.
  - Lifecycle events: `v2.core.claimable_sandbox.claimed`, then `updated` (`pending_onboarding` → `pending_install` → `installed`), then status `live`.
  - The feature requires a public Stripe App with `sandbox_install_compatible`. It isn't available on Connect platforms, and Stripe review is required.
  - The docs say: "private preview and not accepting new users."
  - For your own integration, `stripe sandboxes create` in the CLI gives you a claimable sandbox.
  - — [Stripe: Claimable sandboxes](https://docs.stripe.com/sandboxes/claimable-sandboxes); [Stripe CLI: sandbox](https://docs.stripe.com/cli/sandbox) (excerpt: claim via `claim_url` or `stripe sandbox claim`)
- **Going live after a claim.** A user who claims into a new account "must onboard the Stripe account by submitting the account application before going live", then install the platform's app in live mode. — [Stripe: Claimable sandboxes](https://docs.stripe.com/sandboxes/claimable-sandboxes)
- **Connect OAuth redirect URIs.** These are registered in the platform's OAuth settings in the Dashboard. The `redirect_uri` must match exactly, and live mode requires HTTPS. — [Stripe: Connect OAuth reference](https://stripe.com/docs/connect/oauth-reference) (excerpt). The Express OAuth page is marked deprecated, says OAuth isn't available for new Connect platforms, and recommends the Accounts API. — [Stripe: OAuth with Express accounts](https://docs.stripe.com/connect/oauth-express-accounts) (excerpt). Stripe Apps use a separate OAuth flow with `allowed_redirect_uris` in the app manifest. — [Stripe Apps: OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth) (excerpt)
- **Connect platform profile.** The platform profile must be completed in the Dashboard before live connected accounts can be created. The Stripe error message points to `dashboard.stripe.com/connect/accounts/overview` to answer a questionnaire, and a separate acknowledgement of loss and requirements responsibilities is made on the platform-profile settings page. — [Stripe: Express accounts](https://docs.stripe.com/connect/express-accounts) (excerpt); [Sharetribe help: troubleshoot Stripe errors](https://www.sharetribe.com/help/en/articles/9453619-troubleshoot-stripe-errors) (secondary)
- **Stripe Projects.** A Stripe CLI plugin: `stripe projects init` / `add` provisions third-party services and writes their API keys into the project, and init writes an agent skill file. Stripe's June 2026 update grew the catalogue to 49 providers. Agents default to the development environment, and Stripe added per-provider spend limits and a cost view per project. — [Stripe blog: Projects adds agents, providers, controls](https://stripe.com/blog/stripe-projects-adds-new-agents-providers-developer-controls); [Exa: Stripe Projects docs](https://exa.ai/docs/reference/stripe-projects) (secondary)

### Inferences
- **Stripe gate entries for the catalogue:**
  1. **Create the Stripe account and submit the account application (KYC, bank account, representative identity).** Legal/KYC; the API covers only connected accounts, not your own. Best UX is a claim/onboarding link: Stripe's own onboarding URL, or a claimable sandbox's onboarding URL for platforms with access.
  2. **Create the live restricted or agent key.** Dashboard only, step-up verification, shown once. The human creates it with pre-listed permissions (the tool supplies the exact resource/permission matrix), then pastes it into a secure handoff. In test mode, an agent can work with sandbox keys, from the CLI login or a claimable sandbox, without this gate.
  3. **Complete the Connect platform profile and register OAuth redirect URIs (if Connect is used).** Dashboard questionnaire and liability acknowledgement. Deep-link to `dashboard.stripe.com/connect/accounts/overview` and supply the redirect URI list to paste.
  4. **Approve high-risk actions (refunds, money movement).** This is an approval-link pattern native to Stripe MCP.
- Webhook endpoints and products/prices can be fully automated by API. Only the human copying the signing secret is unnecessary if the endpoint is created by API (from general knowledge the create response includes the secret; not verified here).
- Agent-key migration deadline: any setup tool using Stripe MCP with legacy keys must switch to agent-tagged keys or OAuth before 30 Nov 2026.

### Gaps
- I found no evidence of a public API for creating restricted or agent keys on your own account. The docs describe only Dashboard creation, Stripe Apps RAK-on-install, managed keys and claimable-sandbox keys. Absence isn't proof.
- I didn't verify whether Connect OAuth settings (client ID, redirect URIs) can be set by API. I found only Dashboard instructions.
- I didn't fetch the Stripe Agent Toolkit (`@stripe/agent-toolkit`) docs. Its 2026 status relative to MCP and agent plugins is unverified.

## 4. Domains and DNS: purchase/transfer by API, nameserver changes at third-party registrars, Domain Connect

### Takeaway
Domain purchase is now API-possible at Cloudflare (Registrar API beta, launched 15 Apr 2026) and Vercel (`/v1/registrar/domains/{domain}/buy`). Both need a human to set things up first: payment method, default registrant contact, and, at Cloudflare, acceptance of the Domain Registration Agreement in the dashboard. Cloudflare's API can't do transfers, renewals or premium domains yet. For domains at third-party registrars, Domain Connect gives a one-click consent flow at the DNS provider (Cloudflare, GoDaddy, IONOS, Vercel and others). Registrar APIs such as GoDaddy and Namecheap have eligibility thresholds, so nameserver changes there usually need the human.

### Cited Findings
- **Cloudflare Registrar API beta: operations.**
  - Search uses cached data, "not the source of truth".
  - Check gives real-time availability and pricing for up to 20 domains per request.
  - Register returns 201 when done within about 10 seconds, or 202 with polling.
  - — [Cloudflare: Registrar API](https://developers.cloudflare.com/registrar/registrar-api/)
- **Cloudflare beta: not supported.** Renewals, transfers and contact updates are not available. Some TLDs are dashboard-only (`extension_not_supported_via_api`). Premium domains are not supported yet. — [Cloudflare: Registrar API](https://developers.cloudflare.com/registrar/registrar-api/); [API reference](https://developers.cloudflare.com/api/resources/registrar/index.md) (excerpt)
- **Cloudflare beta: prerequisites and billing.**
  - You need an API token with Registrar write permission.
  - You need a billing profile with a default payment method, which is charged automatically. Registrations are non-refundable once complete.
  - The account needs a default registrant contact.
  - The Domain Registration Agreement must be accepted on the registrations page in the dashboard.
  - Auto-renew defaults to off.
  - The docs page was last updated 16 Sep 2026.
  - — [Cloudflare: Registrar API](https://developers.cloudflare.com/registrar/registrar-api/)
- **Cloudflare launch.** The API launched on 15 Apr 2026, aimed at registering domains "within their current workflows", including by agents. — [Domain Name Wire, 15 Apr 2026](https://domainnamewire.com/2026/04/15/cloudflare-launches-domain-registration-api/)
- **Vercel Registrar API.**
  - Single purchase: `POST /v1/registrar/domains/{domain}/buy`. Bulk purchase: `POST /v1/registrar/domains/buy`.
  - The body carries auto-renew, years, the expected price, and mandatory contact information.
  - Some TLDs need extra contact fields, available from a contact-info schema endpoint. Missing fields fail with errors such as `additional_contact_info_required`.
  - Bearer auth; `teamId` goes in the query string.
  - — [Vercel: Buy a domain](https://vercel.com/docs/rest-api/domains-registrar/buy-a-domain); [Vercel: Buy multiple domains](https://vercel.com/docs/rest-api/domains-registrar/buy-multiple-domains) (excerpts)
- **GoDaddy.** In April 2026, GoDaddy lowered the DNS/Domain Management API threshold from 10 domains to 1. The Availability API keeps a higher threshold, reportedly 50+ active domains. — [GoDaddy: DNS API now works with a single domain](https://www.godaddy.com/resources/news/godaddy-dns-api-now-works-with-a-single-domain) (excerpt); [GoDaddy help (fr-ca): domain APIs](https://www.godaddy.com/fr-ca/help/how-do-i-access-domain-related-apis-42424) (excerpt). An older support email quoted on a forum also lists Discount Domain Club Pro or $20+/month purchases as qualifiers. — [Let's Encrypt community](https://community.letsencrypt.org/t/godaddy-api-access-policy-update/246372) (secondary)
- **Namecheap.** API activation reportedly needs one of: 20+ domains, a $50+ account balance, or $50+ spent in the last 2 years, plus IP allow-listing. — [forum thread quoting Namecheap FAQ](https://lemmy.klein.ruhr/post/4256) (secondary; not verified on namecheap.com)
- **Domain Connect.**
  - An open protocol, being standardised in the IETF DCONN working group.
  - A service provider defines its DNS records once as a template. The DNS provider shows the user the exact changes and applies them on approval.
  - Synchronous and asynchronous flows are both supported.
  - The site claims 300+ DNS providers. — [domainconnect.org](https://www.domainconnect.org/)
  - Its DNS-providers page names only 11: IONOS, Cloudflare, Domain Chief, FENO AS, Glauca Digital, GoDaddy, NameSilo, Plesk, Simply.com, Vercel and WordPress.com. Namecheap and Squarespace are not listed. — [domainconnect.org: DNS providers](https://www.domainconnect.org/dns-providers/)
  - The "300+" figure versus 11 named providers is unexplained (possibly reseller brands).

### Inferences
- **Domain gate entries for the catalogue:**
  1. **Registrar account set-up: payment method, registrant contact, registration agreement.** A one-time human step per registrar account. After it, the agent can search, check and buy by API. The UX is a checklist item with a deep link, followed by an explicit purchase confirmation showing domain, years and price, because purchases are non-refundable.
  2. **Approve the purchase itself.** Charges a card, so it needs per-action confirmation in chat even when the API allows it.
  3. **Transfer a domain in (EPP code, unlock at the old registrar).** No Cloudflare API yet. The human unlocks the domain and fetches the code at the losing registrar.
  4. **Change nameservers at a third-party registrar.** Only possible by API where the registrar's API is available to the user (GoDaddy now at 1 domain; Namecheap thresholds). Otherwise the human logs in. Best UX: show the two nameserver values with copy buttons and a registrar-specific deep link, then poll DNS until the delegation appears.
  5. **Add DNS records without moving nameservers.** Use Domain Connect where the DNS provider supports it, which gives a one-click consent screen at the provider. Otherwise give a record table to paste, then poll.

### Gaps
- I didn't verify whether domains registered through Cloudflare's API are automatically on Cloudflare DNS (the page is silent).
- I didn't verify whether Vercel's registrar API requires a prior dashboard acceptance of terms or a payment method.
- I didn't fetch the Domain Connect spec details: async OAuth-style flow versus sync redirect, and template onboarding with each DNS provider.
- I didn't check whether the Domain Connect providers list is complete or what the 300+ figure counts.

## 5. Accounts, terms and billing: creating accounts at AWS, Vercel, Cloudflare, Resend, Supabase and GitHub; ToS acceptance; payment methods; AWS Organizations; plan upgrades

### Takeaway
Account creation and terms acceptance are human gates by policy, and often technically too: CAPTCHA, phone verification, card holds. GitHub's terms explicitly say a human must create the account and that bot-registered accounts aren't permitted. Machine accounts are allowed, but a human owner is responsible for them. The one large exception is AWS Organizations `CreateAccount`. Once a human-created management account with a payment method exists, member accounts can be created entirely by API, with company details cloned and no payment method collected.

### Cited Findings
- **GitHub.** GitHub's terms say a human must create your account, and that you may have only one free personal account. Accounts registered by "bots" or other automated methods are not permitted. Machine accounts, used only for automated tasks, are allowed, and the account owner is ultimately responsible for the machine's actions (terms effective 27 Apr 2026). — [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (excerpt); [site-policy diff](https://github.com/github/site-policy/pull/43/files/4cd9ae5b555ae2f11a7fb3a0d86f6ad7d0e72fa9) (secondary)
- **AWS Organizations `CreateAccount`.**
  - Callable only from the management account, with the `organizations:CreateAccount` permission. It runs asynchronously (`DescribeCreateAccountStatus`).
  - It preconfigures `OrganizationAccountAccessRole` and clones company name and address from the management account.
  - Information needed to operate standalone, such as a payment method, is "not automatically collected". To remove the account from the organisation later, someone must add it, and phone verification is needed too (`ACCOUNT_CANNOT_LEAVE_WITHOUT_PHONE_VERIFICATION`).
  - The management account must itself have a payment instrument and contact info (`MASTER_ACCOUNT_PAYMENT_INSTRUMENT_REQUIRED`, `MASTER_ACCOUNT_MISSING_CONTACT_INFO`).
  - Each account email must be unique. AWS sends a "Welcome to AWS" email.
  - AWS advises against using it for many temporary accounts. Closing accounts has a 30-day quota. Some operations require waiting at least four days after creation (`WAIT_PERIOD_ACTIVE`).
  - — [AWS Organizations: CreateAccount API](https://docs.aws.amazon.com/organizations/latest/APIReference/API_CreateAccount.html)
- **Standalone AWS sign-up.** The steps are: root email and account name, an email verification code, a root password, contact details, a card (required even for Free Tier, with a temporary hold of about $1), phone call or SMS verification, then a support plan. A CAPTCHA may appear. AWS recommends MFA on the root user and doing daily work as an admin user. — [AWS hands-on: Create your AWS account](https://docs.aws.amazon.com/hands-on/latest/setup-environment/module-one.html) (excerpt); [DataCamp tutorial](https://www.datacamp.com/tutorial/create-aws-account) (secondary)
- **Terms inside setup flows.** Cloudflare requires the Domain Registration Agreement to be accepted in the dashboard before API registration. — [Cloudflare: Registrar API](https://developers.cloudflare.com/registrar/registrar-api/). Apple requires the Developer Program License Agreement after verification, and the Account Holder must agree to terms before App Store Connect API access. — [Apple: Enrollment](https://developer.apple.com/programs/enroll/); [App Store Connect Help](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api) (excerpt). Claimed Stripe sandboxes require the user to submit the account application. — [Stripe: Claimable sandboxes](https://docs.stripe.com/sandboxes/claimable-sandboxes)
- **Agent-provisioning marketplaces.** Stripe Projects provisions accounts at partner providers (49 by June 2026) from the CLI, with per-provider spend limits. — [Stripe blog](https://stripe.com/blog/stripe-projects-adds-new-agents-providers-developer-controls). Vercel lets an agent deploy on its own account and hand the project over with a claim URL. — [Vercel: Claim deployments](https://vercel.com/docs/deployments/claim-deployments) (excerpt)

### Inferences
- **Account gate entries for the catalogue:**
  1. **Create a human account at each provider** (AWS root, Vercel, Cloudflare, Resend, Supabase, GitHub). Policy forbids bot sign-up (explicitly at GitHub), and CAPTCHA, phone or card checks enforce it. The human signs up once, ideally with "Sign in with GitHub/Google" to cut steps. The tool then gets delegated access through OAuth "Connect" buttons or CLI device login (`vercel login`, `stripe login`, `wrangler login`, `gh auth login`) instead of asking the human to copy tokens.
  2. **Accept ToS, registration agreements and licence agreements.** These are legally binding on a person or company, so an agent clicking "I agree" can't create valid consent on the principal's behalf. That is inference from the requirement for binding authority (Apple) and human-created accounts (GitHub); I found no single provider statement on agents clicking "I agree". The human clicks; the tool shows which agreement it is and why.
  3. **Add a payment method or upgrade a plan.** Financial credentials, so the human enters the card on the provider's own page. The tool deep-links to the billing page and verifies afterwards (for example by checking that a plan-gated API call now succeeds).
  4. **AWS.** Exactly one human-created management account with a payment method and MFA. After that, member accounts per environment (prod, staging) come from `CreateAccount`, with no human gate except the root-email inbox for the welcome email.
- Agent-owned-then-claimed resources (Vercel claim deployments, Stripe claimable sandboxes, Clerk keyless apps) move the account-creation gate to the end: the human signs up only when claiming, after seeing a working result.

### Gaps
- I didn't fetch the Vercel, Cloudflare, Resend or Supabase terms for clauses on automated sign-up. Only GitHub's position is sourced.
- I found no authoritative statement (provider or legal) that an agent's click on "I agree" is invalid or prohibited. The reasoning above is inference.
- AWS's own terms on automated sign-up weren't checked. The AWS sign-up steps come mostly from tutorials, and the official AWS page was an excerpt.
- I didn't verify the current AWS Free Tier model (the July 2025 credits-based free plan and its upgrade gate) for Nov 2026.

## 6. Email: sending-domain verification, DMARC, deliverability warm-up

### Takeaway
Sending-domain verification is almost fully automatable when the tool controls DNS. Resend's API creates the domain, returns the exact DKIM/SPF/DMARC records and starts asynchronous verification. The remaining gates are time-based, not human: DNS propagation (up to 72 hours) and reputation building. Gmail's bulk-sender rules (about 5,000 or more messages a day to Gmail) require SPF and DKIM passing, a DMARC record (p=none is enough), one-click unsubscribe for marketing mail, and low complaint rates.

### Cited Findings
- **Resend domain API.**
  - `POST /domains` creates a domain. The domain object lists the DNS records needed (name, type MX/TXT/CNAME, value, TTL), and DKIM/SPF must match exactly.
  - `POST /domains/{domain_id}/verify` starts asynchronous verification.
  - Statuses: `not_started`, `pending`, `verified`, and `failed` (when records aren't detected within 72 hours).
  - Verification often completes within 15 minutes.
  - — [Resend: Verify domain](https://resend.com/docs/api-reference/domains/verify-domain.md); [Resend: Manage domains](https://resend.com/docs/dashboard/domains/manage-domains); [Resend: Add a domain](https://resend.com/docs/add-a-domain.md) (excerpts)
  - A separate claim flow (a TXT record, then verify, then poll the claim) handles domains already on another Resend account. — [Resend: Verify domain claim](https://resend.com/docs/api-reference/domains/verify-domain-claim.md) (excerpt)
- **Gmail bulk-sender rules (enforced from 1 Feb 2024).**
  - SPF and DKIM must both pass, plus a DMARC record (p=none is sufficient), with the From domain aligned to SPF or DKIM.
  - Marketing mail needs RFC 8058 one-click unsubscribe, honoured within 2 days.
  - The spam-rate ceiling is around 0.3%, with under 0.1% recommended.
  - Microsoft applied similar rules to Outlook.com in May 2025.
  - Sources conflict on whether transactional mail counts toward the 5,000 threshold and on the unsubscribe exemption.
  - — [Red Sift](https://redsift.com/blog/gmails-enforcement-ramps-up-what-bulk-senders-need-to-know); [Bird](https://bird.com/docs/knowledge-base/deliverability/gmail-yahoo-requirements); [Help Net Security, Oct 2023](https://www.helpnetsecurity.com/2023/10/04/gmail-bulk-senders-requirements/) (all secondary vendor or press sources)

### Inferences
- **Email gate entries for the catalogue:**
  1. **Verify the sending domain.** Automatable end-to-end when the tool has DNS API access (Cloudflare or Vercel DNS) or Domain Connect. Otherwise it becomes a "paste these records" table at the user's DNS provider, followed by polling.
  2. **Choose the DMARC policy and reporting address.** A business decision (who receives the rua reports, when to move from p=none to quarantine). The tool can default to `p=none` with a report mailbox and flag a later human decision.
  3. **Warm up deliverability.** Not a human gate but a time gate: it can't be compressed by automation. The tool should schedule ramp-up and monitoring (Google Postmaster Tools sign-up is itself a human Google-account step plus DNS verification; not verified here).
- **Production sending keys.** Keep local and production sending keys separate. A setup tool should mint the production key in the provider dashboard and pass it through secrets storage (for example GitHub secrets), never chat. This is general practice, not sourced here.

### Gaps
- I didn't fetch Google's primary sender guidelines (support.google.com/a/answer/81126). The Gmail figures come from vendor summaries.
- I found no authoritative source on warm-up schedules for new sending domains or IPs on shared-IP providers like Resend.
- I didn't verify whether Resend's API can create API keys and domains without a prior human-created account. From general knowledge an API key needs an existing account.

## 7. UX patterns: how good products minimise and present the remaining manual steps

### Takeaway
The strongest 2026 pattern is "agent provisions first, human claims later". Vercel claim deployments, Stripe claimable sandboxes and Clerk keyless mode all let an agent create a working resource anonymously or on its own account, then hand the human a signed, expiring claim URL that folds sign-up, terms, KYC and billing into one provider-hosted flow. For gates that can't be deferred, the best products use:
- provider-hosted OAuth "Connect/Install" consent with pre-selected context (Supabase, Stripe MCP),
- signed approval links for risky actions (Stripe MCP human confirmation, Stripe Atlas),
- declarative prompts for secrets (Render `sync: false`),
- resumable state machines driven by webhook or event status.

### Cited Findings
- **Vercel claim deployments.** An agent deploys to its own Vercel account through the CLI or REST (`POST /files` then `POST /deployments`). It generates a claim URL, and the user picks a team or personal account. This produces a code valid for 24 hours that lets the agent transfer the project. Some linked resources move too (Prisma was the supported provider). Vercel's guide says it is working on an OAuth provider for agents and third-party apps. — [Vercel: Claim deployments](https://vercel.com/docs/deployments/claim-deployments); [Vercel: AI agents guide](https://vercel.com/guides/ai-agents) (excerpts)
- **Stripe claimable sandboxes.**
  - The claim URL is a single next-step link that routes to whatever is pending: claim, then the account application, then app install.
  - It is prefilled (email, name, country), expires in 7 days and is renewed server-side through `refresh_url`.
  - The sandbox works immediately with test keys and an MCP key.
  - Lifecycle is reported by events, so the platform can show progress. A reminder email goes out 7 days before the 60-day deletion.
  - — [Stripe: Claimable sandboxes](https://docs.stripe.com/sandboxes/claimable-sandboxes)
- **Clerk keyless mode.** A Next.js app starts with no publishable or secret key. The SDK's accountless application carries `claimUrl` and `apiKeysUrl`. Claiming opens a new tab and shows a "successfully claimed" confirmation state. — [Clerk @clerk/nextjs 6.8.0 release](https://newreleases.io/project/github/clerk/javascript/release/@clerk%2Fnextjs@6.8.0); [@clerk/shared keyless types](https://cdn.jsdelivr.net/npm/@clerk/shared@4.8.0/dist/runtime/keyless/index.d.ts); [clerk-js 5.46.0](https://newreleases.io/project/github/clerk/javascript/release/@clerk%2Fclerk-js@5.46.0) (release notes, secondary). Two CLI changes: an open PR makes `clerk init` try to claim and link the keyless app automatically after `clerk auth login`, and when an authenticated agent runs init it creates a real app rather than a keyless one. — [clerk/cli PR 267](https://github.com/clerk/cli/pull/267); [clerk/cli PR 254](https://github.com/clerk/cli/pull/254). Dev instances also use shared Google OAuth credentials. — [Clerk: Google](https://clerk.com/docs/authentication/social-connections/google)
- **Supabase partner install flow.**
  1. "Install Integration" in the Dashboard redirects to the partner with `project_id` and `organization_slug`, so the partner can pre-select the project.
  2. A signed-JWT POST variant is recommended for production.
  3. The partner should design its setup "as a wizard" ending at the Supabase authorisation URL, so users don't drop off.
  4. The partner then uses the Management API to create organisations and projects.
  - — [Supabase: Partner integration guide](https://supabase.com/docs/guides/integrations/partner-integration-guide.md); [Supabase: Build an OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration.md)
  - A project-claim endpoint (`GET /v1/organizations/{slug}/project-claim/{token}`) appears only in a community script. — [Windmill hub](https://hub.windmill.dev/scripts/supabase/20845) (secondary, unverified)
- **Stripe MCP approval links.** Sensitive actions return a URL. The human reviews and approves in the Dashboard, the agent gets an approval token and retries, and the approval expires after 24 hours. Install deep links for Cursor and VS Code add the MCP server in one click. — [Stripe: MCP](https://docs.stripe.com/mcp)
- **Stripe Atlas through an agent.** The agent prepares or resumes the application. The human reviews, pays, signs and submits in the Dashboard. — [Stripe: MCP](https://docs.stripe.com/mcp)
- **Render Blueprints.** An env var marked `sync: false` makes the Dashboard prompt for its value. `generateValue: true` generates secrets automatically. — [Render: Blueprint spec](https://docs.render.com/blueprint-spec). One guide notes the first Apply can fail until the prompted values are filled, followed by a redeploy, which is a UX rough edge. — [Wasp: Deploy to Render](https://wasp.sh/docs/guides/deployment/cloud-providers/render) (secondary)
- **Stripe Projects.** Stripe Projects writes provider keys straight into the project and drops an agent skill file in. Spend limits and a cost view give the human control without per-step gates. — [Stripe blog](https://stripe.com/blog/stripe-projects-adds-new-agents-providers-developer-controls)

### Inferences

**Pattern ranking for a setup tool, best first:**
1. **Avoid the gate**: shared dev credentials or anonymous sandboxes (Clerk dev Google creds, Stripe sandboxes).
2. **Defer and batch it into one claim link** (Vercel, Stripe, Clerk).
3. **Delegate with OAuth or device-code consent** instead of copying tokens.
4. **Pre-compute and deep-link**: every value the human must type is shown with a copy button, plus a link to the exact console page.
5. **Secure paste-back** for secrets shown once (Google client secret, Stripe live RAK, Apple .p8 files) through a hidden-input or secure-handoff channel, never chat.
6. **Verify and poll** after each gate (DNS, domain status, `verified` flags, events) so the checklist ticks itself.
7. **Resumable checklist**: persist state per gate so a half-done setup resumes where it stopped, and make expiring links refreshable (Stripe's `refresh_url` model).

**Consolidated gate catalogue (synthesis from the sections above):**

| # | Gate | Why a human | API/CLI? (limits) | Minimal human action | Best UX pattern |
|---|---|---|---|---|---|
| 1 | Provider account sign-up (GitHub, Vercel, Cloudflare, Supabase, Resend, AWS root) | ToS forbids bot sign-up (GitHub); CAPTCHA, phone, card | None for your own account; AWS member accounts by API | Sign up once, ideally through GitHub/Google SSO | Defer to a claim link; otherwise a checklist with deep link, then CLI/OAuth login |
| 2 | ToS / registration / licence agreements | Legal consent by principal (inference) | None; Cloudflare DRA must be accepted in dashboard | Click accept | Show the agreement name and reason; deep link; never auto-click |
| 3 | Payment method / plan upgrade | Financial credential | None | Enter card on provider page | Deep link to billing; verify by probe |
| 4 | AWS management account | Card, phone, root MFA | `CreateAccount` for members only | Create root, add MFA, add card once | Checklist; afterwards fully automated |
| 5 | Google Auth Platform + Web OAuth client | No supported API (IAP API shut down 2026) | None for external/standard clients | Fill wizard; paste URIs; copy ID and secret | Pre-filled value sheet + deep link + secure paste-back |
| 6 | Google publish + brand verification | Policy review | None found | Click Publish / Verify Branding | Pre-check home page and privacy policy live on verified domain first |
| 7 | Search Console domain ownership | Owner identity | DNS TXT automatable; Site Verification API unverified | Click Verify (maybe) | Auto-create TXT, deep link, poll |
| 8 | Apple Developer enrolment (+ D-U-N-S) | Legal entity, binding authority, licence, fee | None | Enrol and pay | Prerequisite checklist (website, domain email, D-U-N-S name match) |
| 9 | Apple keys (ASC API team key, Sign in with Apple key, APNs key) and Services ID | Account Holder/Admin; one-time .p8 | ASC API covers bundle IDs and capabilities only after a key exists | Generate key, download once | Deep link + secure file handoff |
| 10 | Stripe account application (KYC) | Legal/KYC | None for own account | Submit application | Stripe-hosted onboarding or claim link |
| 11 | Stripe live restricted/agent key | Dashboard-only, step-up auth, shown once | Sandbox keys via CLI/claimable sandbox | Create key with listed permissions | Permission matrix + secure paste-back |
| 12 | Stripe Connect platform profile + OAuth redirect URIs | Liability questionnaire | None found | Answer questionnaire; paste URIs | Deep link to Connect overview with pre-filled answer notes |
| 13 | Risky Stripe actions (refunds, money) | Money movement | MCP returns approval URL | Click Approve within 24 h | Approval link |
| 14 | Domain purchase | Charges card, non-refundable | Cloudflare (beta) / Vercel APIs after setup | Confirm domain, years, price | Explicit confirm in chat, then API |
| 15 | Domain transfer-in / nameserver change at third-party registrar | Registrar login; API thresholds | Cloudflare: no transfers yet; GoDaddy API at 1+ domain; Namecheap thresholds | Unlock, EPP code, set NS | Copyable NS values + registrar deep link + poll |
| 16 | DNS records at user's DNS host | Access to DNS account | Domain Connect where supported | Approve template | Domain Connect one-click; else record table + poll |
| 17 | Email domain DMARC policy choice | Business decision | Records by API | Pick policy and report inbox | Default `p=none` + later prompt |

**Agent-provider deadlines a tool must track:**
- Stripe MCP stops accepting non-agent keys after 30 Nov 2026.
- Google IAP OAuth Admin API shut down on 19 Mar 2026 (per gcloud reference).
- Cloudflare Registrar API is still beta, with transfers and renewals pending.

### Gaps
- I didn't research Railway's template or variable-prompt UX or Render's Deploy button specifics (only the Blueprint spec).
- I couldn't retrieve the Vercel Deploy Button parameter list (`env`, `envDescription`, `integration-ids`/`stores`, `redirect-url`); the fetched page lacked the snippets.
- Clerk's claim flow is sourced only from release notes, SDK types and CLI PRs. No official docs page was found.
- I found no official Supabase project-claim documentation.
- I found no published research or blog posts with metrics (for example drop-off rates) on claim-link versus checklist onboarding. The ranking above is inference.
