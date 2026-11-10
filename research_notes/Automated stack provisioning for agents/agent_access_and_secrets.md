# Agent access to developer platforms and secret delivery (state as of 7 Nov 2026)

Scope: how an AI coding agent (Claude Code, Codex, Cursor and similar) on a developer's laptop can get lasting, scoped, revocable access to developer platforms after one human sign-in or approval, and how runtime secrets can reach GitHub Actions, Vercel and a server's env file without passing through chat. Every finding has a URL. Inferences and gaps are kept separate. Dates are the publication or "last updated" dates shown on the pages, where given.

---

## 1. CLI browser/device logins: how they work, where tokens are stored, how long they last

### Takeaway
By November 2026 most provider CLIs have moved to a browser or device OAuth login that saves a refreshable credential in the OS keychain, so an agent can keep working after one human approval. Stripe, GitHub and Supabase use the keychain by default, Resend has since 2.7.0 (July 2026), and Wrangler and Neon offer it as an opt-in. AWS `aws login` is the exception: it is capped at 12 hours. Several older paths are deprecated or changed: Vercel email/`--github` login, Stripe's old 90-day restricted CLI keys, and Neon `neon auth` (now an alias).

### Cited Findings

**GitHub (`gh auth login`)**
- With no flags, `gh auth login` runs a web-based browser flow. `--web` selects it explicitly, and `--clipboard` copies the one-time OAuth device code. — [gh auth login manual](https://cli.github.com/manual/gh_auth_login)
- The token goes in the system credential store by default. If no store is found, gh falls back to a plain-text file. `--insecure-storage` forces plain text, and `gh auth status` shows the location. — [gh auth login manual](https://cli.github.com/manual/gh_auth_login)
- `--with-token` reads a classic PAT from stdin. The manual warns that fine-grained PATs passed this way can behave confusingly because of their resource scoping, and recommends setting `GH_TOKEN` for them instead. — [gh auth login manual](https://cli.github.com/manual/gh_auth_login)
- The minimum scopes for a classic token are `repo`, `read:org` and `gist`. `--scopes` requests additional ones. — [gh auth login manual](https://cli.github.com/manual/gh_auth_login)
- New flag: `--expiring` prefers expiring credentials that gh refreshes automatically, where the host supports them. The `expiring_credentials` config turns this on by default, `--expiring=false` overrides it, and git 2.46+ is recommended. — [gh auth login manual](https://cli.github.com/manual/gh_auth_login)

**Vercel (`vercel login`)**
- Since 12 Sep 2025, `vercel login` uses the OAuth 2.0 Device Flow, so you can sign in from any browser-capable device. — [Vercel changelog: New Vercel CLI login flow](https://vercel.com/changelog/new-vercel-cli-login-flow)
- **Deprecated:** email login (`vercel login you@email`), `--github`, `--gitlab`, `--bitbucket`, `--oob`. Most lost support on 26 Feb 2026. The SAML `team` method stayed supported until 1 Jun 2026. — [Vercel changelog](https://vercel.com/changelog/new-vercel-cli-login-flow)
- The `vercel login` reference (updated 10 Apr 2026) lists global options such as `--non-interactive`, `--scope` and `--team`. `--token` is a global option used for CI. — [vercel login docs](https://vercel.com/docs/cli/login); [vercel env docs (global options list)](https://vercel.com/docs/cli/env)

**Stripe CLI (`stripe login`)**
- Current docs: `stripe login` shows a pairing code and opens the Dashboard. There you confirm the code and choose the CLI's access to accounts, sandboxes and live mode. After approval the CLI stores credentials in the OS secure credential store (when available) and refreshes the session automatically. — [Stripe CLI: login](https://docs.stripe.com/cli/login); [Stripe CLI keys](https://docs.stripe.com/stripe-cli/keys)
- For CLI versions newer than v1.50.0, an Administrator or IAM Admin must enable CLI access first, under Settings → Team and security → MCP and CLI access. Login signs in only that one user, and revoking it signs out only that user. — [Stripe CLI: login](https://docs.stripe.com/cli/login)
- Agent-friendly flags:
  - `--non-interactive` prints `browser_url`, `verification_code` and a `next_step` command as JSON. It turns on automatically when stdin isn't a TTY.
  - `--complete=<poll-url>` polls until the human approves, then saves the credentials.
  - `--new-session` revokes and re-logs in.
  - `stripe login list`, `stripe switch`, `stripe reauth` and `stripe logout` manage the session. — [Stripe CLI: login](https://docs.stripe.com/cli/login)
- **Changed behaviour (conflict between doc versions):** older or localized copies of the CLI keys page say `stripe login` creates two restricted keys (test and live), valid for 90 days and stored in `~/.config/stripe/config.toml`. The current English page instead describes the secure-store session that refreshes itself. — older: [search result citing docs.stripe.com/stripe-cli/keys?locale=pt-BR](https://docs.stripe.com/stripe-cli/keys?locale=pt-BR); current: [docs.stripe.com/stripe-cli/keys](https://docs.stripe.com/stripe-cli/keys)
- In older versions, an expired CLI key printed the whole error body and still exited 0. A later fix shows an expiry message, and the remedy is to re-run `stripe login`. — [stripe-cli PR #792](https://github.com/stripe/stripe-cli/pull/792)
- Key resolution: `STRIPE_API_KEY` and `STRIPE_DEVICE_NAME` env vars take precedence over everything else. `--api-key` overrides local config for one command. `stripe config --set test_mode_api_key ...` sets a persistent key. — [Stripe CLI keys](https://docs.stripe.com/stripe-cli/keys)

**Cloudflare (`wrangler login`, `cloudflared tunnel login`)**
- `wrangler login` requests all scopes by default. `--scopes-list` shows the available scopes and `--scopes` selects a subset. `--browser=false` prints the link instead of opening it. The callback listens on `--callback-host` (default `localhost`) and `--callback-port` (default `8976`). — [Wrangler general commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- By default the OAuth tokens sit in a **plaintext TOML file**, typically `~/.config/.wrangler/config/default.toml`. `--use-keyring` writes an AES-256-GCM encrypted `default.enc` instead and keeps its key in the OS keychain. — [Wrangler general commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- OAuth tokens refresh automatically when they expire. `wrangler logout` invalidates the OAuth token and deletes the stored credentials. `CLOUDFLARE_API_TOKEN` takes priority over stored OAuth credentials and is the recommended route for headless or CI use. `wrangler auth token` returns the active credential (order: API token, then API key with email, then OAuth). `wrangler whoami --json` exits non-zero when you aren't authenticated. — [Wrangler general commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- `cloudflared tunnel login` downloads `cert.pem` once. It bundles the origin certificate's keys and a tunnel token.
  - Scope is **account-wide**: it can create, delete and manage all tunnels for the account.
  - Validity is at least 10 years, and the token inside stays valid until revoked.
  - To revoke it, delete the associated API token in the dashboard.
  - By contrast, the per-tunnel credentials file (`<TUNNEL-UUID>.json`) can only run that one tunnel and does not expire. — [Cloudflare tunnel permissions](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/tunnel-permissions/)

**AWS (`aws login`, SSO/Identity Center)**
- `aws login` (AWS CLI **2.32.0+**) reuses an AWS Management Console sign-in. It works for root, IAM users and federated IAM identities. Identity Center users are pointed to `aws configure sso` instead. — [AWS CLI: Login using console credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)
- Credentials refresh every 15 minutes as needed. The overall session lasts at most the IAM principal's session duration, **maximum 12 hours**, after which `aws login` must be run again. — [AWS CLI sign-in guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)
- Credentials are cached in `~/.aws/login/cache` (override with `AWS_LOGIN_CACHE_DIRECTORY`). The profile gets `login_session = arn:...`.
  - `aws login --remote` gives a cross-device code flow for SSH or headless hosts.
  - `aws logout [--profile X | --all]` deletes the cached credentials.
  - The IAM identity needs the `SignInLocalDevelopmentAccess` managed policy.
  - Same-device and cross-device logins can be controlled separately with the IAM resource ARNs `arn:aws:signin:{region}:{account}:oauth2/public-client/localhost` and `.../remote`. — [AWS CLI sign-in guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)
- Older SDKs or tools that don't support console credentials can share them through `credential_process = aws configure export-credentials --profile signin --format process`. — [AWS CLI sign-in guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)

**Google Cloud (`gcloud auth login`, ADC)**
- `gcloud auth application-default login` supplies credentials to the Cloud Client Libraries. The gcloud CLI itself doesn't use ADC; `gcloud auth login` credentials are separate. — [Google: Provide credentials to ADC](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)
- Impersonation: `gcloud auth application-default login --impersonate-service-account SA_EMAIL` needs `roles/iam.serviceAccountTokenCreator` on that service account. `gcloud auth application-default revoke` revokes ADC user credentials. Google says service account keys are a security risk if not managed correctly, and recommends impersonation or user credentials instead. — [Google: Set up ADC for local dev](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
- Non-Cloud scopes such as Drive need your own OAuth client: pass `--client-id-file` and `--scopes`. — [Google: Set up ADC for local dev](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
- File locations (secondary sources): ADC is written to `$HOME/.config/gcloud/application_default_credentials.json`. `gcloud auth login` writes to the SQLite `credentials.db`, with `access_tokens.db` alongside. Both hold refresh tokens. — [Stack Overflow mirror: where are ADC stored](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/40032678/where-are-google-application-default-credentials-stored); [jpassing.com: ADC vs personal gcloud credentials](https://jpassing.com/2020/01/14/google-application-default-credentials-vs-your-personal-gcloud-credentials/)
- **OAuth client setup can't be fully automated:** the IAP OAuth Admin API was deprecated on 22 Jan 2025 and can no longer create or manage OAuth clients. If an app needs a custom client ID, Google says to create it in the Google Cloud console. Otherwise IAP uses a Google-managed client. Automation must use a pre-created client. — [Google: Migrate from the IAP OAuth Admin API](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client). A Google Groups post claimed a permanent shutdown in July 2025, which official docs don't confirm. — [google-apps-manager group post](https://groups.google.com/g/google-apps-manager/c/EVTIA70NPbk)

**Resend (`resend login`)**
- `resend login --web` logs in through the browser with no prompts. The CLI prints the authorize URL and profile to stderr, waits up to 5 minutes, and stores an OAuth grant. The browser must be on the same machine, because the callback goes to `127.0.0.1`. — [resend-cli README](https://github.com/resend/resend-cli)
- In non-TTY, `CI`, `GITHUB_ACTIONS` or `TERM=dumb` contexts, you must pass `--web` or `--key`, otherwise login fails with `missing_key`. Key precedence is `--api-key`, then `RESEND_API_KEY`, then the config file. `resend doctor` reports the key source with the key masked. — [resend-cli README](https://github.com/resend/resend-cli)
- **Storage changed in 2.7.0:** PR #320 (OAuth PKCE with loopback callback and state checks) was merged on 3 Jul 2026 and shipped in 2.7.0. Tokens go to OS secure storage (the "OS keychain") when it's available. Only metadata (`type`, `scope`, `storage: secure_storage|file`) goes to `credentials.json`, and the file holds the grant only as a fallback. Refresh runs on demand with a 60-second leeway, and an expired or revoked refresh token surfaces as `invalid_grant`. — [resend-cli PR #320](https://github.com/resend/resend-cli/pull/320)
- **Conflict:** the README still describes `~/.config/resend/credentials.json` (mode 0600, directory 0700) as the credential store and doesn't mention the keychain. It probably predates or simplifies 2.7.0. — [resend-cli README](https://github.com/resend/resend-cli)
- The CLI ships an agent skill (`skills/resend-cli/SKILL.md`). `npx skills add resend/resend-skills` installs the wider platform skills, and `--dry-run` works on `emails send` and on broadcasts and batch commands. — [resend-cli README](https://github.com/resend/resend-cli)

**Supabase CLI**
- The access token is stored in native credentials storage. If none is available, it falls back to plain text at `~/.supabase/access-token`. — [supabase init reference](https://supabase.com/docs/reference/cli/supabase-init)
- Browser-based automatic login exists since v1.114.0: the token is decrypted with an in-memory ECDH key and then stored in the OS store. `--name` sets the token's stored name. `SUPABASE_ACCESS_TOKEN` skips login, for CI. — [Supabase blog: Automatic CLI login](https://supabase.com/blog/automatic-cli-login); [supabase login reference](https://supabase.com/docs/reference/cli/supabase-login)

**Neon CLI**
- `neon login` opens a browser OAuth flow. **`neon auth` is now a legacy alias.** Newer docs give the credential path `~/.config/neon/credentials.json`; older docs said `~/.config/neonctl/credentials.json`. `--keyring` stores the credential in the OS keyring instead. — [Neon CLI login](https://neon.com/docs/cli/login); [Neon CLI auth (legacy)](https://neon.com/docs/cli/auth)
- Resolution order: `--api-key`, then `NEON_API_KEY`, then the credentials file, then browser login. Vercel-managed Neon accounts must use an API key. — [Neon CLI login](https://neon.com/docs/cli/login)

**Apple (App Store Connect API keys)**
- There is no browser-login CLI. Access uses API keys plus self-signed ES256 JWTs. Team keys are generated by an Admin and aren't limited to one app. Individual keys carry the user's own access, and an Admin must first grant the "Generate Individual API Keys" permission. — [ASC: Revoking API keys](https://developer.apple.com/documentation/appstoreconnectapi/revoking-api-keys); [ASC: Creating API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
- JWT `exp` may be at most 20 minutes after `iat` for most requests. A token with a `scope` claim of GET-only entries, for specific resources (Build Runs, Workflows, Repositories, Test Results and others), can live up to **six months**. Team-key tokens use `iss` (the issuer ID). Individual-key tokens use `sub: "user"` and no `iss`. The `aud` is `appstoreconnect-v1`. — [ASC: Generating tokens for API requests](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)

### Inferences
- **Best current "authenticate once, keep working" path per provider:**
  - **GitHub:** `gh auth login --web`, which uses the keychain. Consider `--expiring` for auto-refreshed tokens.
  - **Vercel:** `vercel login` device flow.
  - **Stripe:** `stripe login --non-interactive`, then `--complete`. The agent drives it and the human approves in the Dashboard.
  - **Cloudflare:** `wrangler login --use-keyring --scopes ...` with minimal scopes.
  - **Resend:** `resend login --web` on 2.7.0+.
  - **Supabase:** `supabase login`.
  - **Neon:** `neon login --keyring`.
  - **AWS:** `aws login`. It needs a human at most every 12 hours. For longer unattended work, use Identity Center or role-based options (unverified here).
  - **Google Cloud:** `gcloud auth application-default login --impersonate-service-account` for least privilege.
  - **Apple:** keep the `.p8` in a secret manager and mint short JWTs per run. Only scoped GET tokens can be long-lived.
- The Stripe CLI's `--non-interactive` JSON output (URL, verification code, next step) is the cleanest agent handoff pattern found: the agent never sees a secret, and the human only clicks Approve.
- Files that fall back to plain text (gh, Supabase, Wrangler default, Resend before 2.7.0, gcloud's SQLite DBs, AWS login cache) are readable by any same-user process, including an agent's shell. Keychain storage only reduces this risk if the item is bound to the app (see the Claude Code finding in section 2).
- `cloudflared tunnel login` gives the laptop an account-wide, 10-year credential. Use it only when necessary. Remote-managed tunnels or a scoped API token are probably safer for agent-driven setup (not verified on a page).

### Gaps
- Vercel CLI token storage location and token lifetime/refresh: neither page fetched states them.
- IAM Identity Center (`aws configure sso`) session durations were not fetched. Don't state numbers without checking the AWS docs.
- Whether a fine-grained GitHub PAT can be created by API: the PAT page describes only UI and URL pre-fill creation.
- Whether the App Store Connect `.p8` can be downloaded only once was not confirmed on an Apple page.
- The macOS Wrangler config path may differ from `~/.config/.wrangler` (the docs say "typically"). Not verified.
- I found no official doc for a generic Google "create OAuth web client by API" path beyond the IAP deprecation. The claim that consent-screen and OAuth-client setup are console-only in general is unverified.

---

## 2. Remote MCP servers with OAuth: the spec, official provider servers, and client token storage

### Takeaway
Remote MCP servers authenticate with OAuth 2.1 plus PKCE and resource indicators. The 2026-07-28 spec revision deprecates Dynamic Client Registration (DCR) in favour of Client ID Metadata Documents (CIMD). Stripe, Vercel, Supabase, Neon, Cloudflare, GitHub and AWS all run official remote servers. Most accept OAuth for interactive clients and a scoped bearer token for CI. Claude Code and Codex store the resulting tokens in the OS keychain, falling back to a JSON file.

### Cited Findings

**MCP authorization spec**
- 2025-11-25 revision:
  - Authorization is optional. HTTP transports SHOULD conform to it. STDIO servers SHOULD NOT and should take credentials from the environment instead.
  - It is based on OAuth 2.1 (draft-13), RFC 8414, RFC 7591 (DCR), RFC 9728 (Protected Resource Metadata) and the CIMD draft.
  - MCP servers MUST implement RFC 9728 and clients MUST use it for discovery.
  - Clients SHOULD support CIMD and MAY support DCR. Client priority is pre-registered first, then CIMD, then DCR, then asking the user. — [MCP spec 2025-11-25: Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- Requirements on clients and servers:
  - Clients MUST use PKCE with S256, and MUST refuse to proceed if the metadata lacks `code_challenge_methods_supported`.
  - Clients MUST send the RFC 8707 `resource` parameter (the canonical server URI) in both authorization and token requests.
  - Servers MUST validate the token audience. Token passthrough to upstream APIs is forbidden.
  - Access tokens must never appear in query strings.
  - Authorization servers SHOULD issue short-lived access tokens and MUST rotate refresh tokens for public clients. — [MCP spec 2025-11-25: Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- Scopes: servers SHOULD put `scope` in the `WWW-Authenticate` challenge. Otherwise clients request `scopes_supported`. Runtime `403 insufficient_scope` triggers a step-up re-authorization, with retry limits. — [MCP spec 2025-11-25: Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- **2026-07-28 revision (current):**
  - DCR is deprecated as a registration mechanism in favour of CIMD and stays only for backward compatibility.
  - Authorization servers SHOULD send `iss` (RFC 9207), and clients MUST validate it.
  - Clients MUST key persisted client credentials by issuer and re-register when the authorization server changes.
  - DCR clients must send `application_type`.
  - The protocol also becomes stateless: no `initialize` and no `Mcp-Session-Id`.
  - The HTTP+SSE transport is reclassified as Deprecated. — [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

**Client-side storage and commands**
- **Claude Code:**
  - Add a server with `claude mcp add --transport http <name> <url>`.
  - Sign in with `/mcp`, or from the shell with `claude mcp login <name>` (`--no-browser` for the URL-paste flow over SSH).
  - Tokens are stored securely and refreshed automatically.
  - `claude mcp logout <name>` revokes. `claude mcp remove` deletes the local tokens but does **not** revoke them at the authorization server, so log out first.
  - `claude -p` and Agent SDK runs can't complete OAuth. — [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- **Claude Code, pre-registered clients:**
  - `--client-id`, `--client-secret` (masked prompt, or the `MCP_CLIENT_SECRET` env var) and `--callback-port`.
  - The client secret is kept in the macOS keychain, or in a credentials file elsewhere.
  - `.mcp.json` supports `${VAR}` expansion in headers.
  - Claude Code reads some credential env vars as empty in remote `url` and `headers` (e.g. `ANTHROPIC_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `NPM_TOKEN`), so a project can't exfiltrate them. — [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- Claude Code token location (secondary sources): the macOS Keychain, with a fallback to `~/.claude/.credentials.json` (mode 0600 on Linux) under an `mcpOAuth` key. — [SecretSpec blog](https://secretspec.dev/blog/claude-code-stores-oauth-tokens-in-plaintext/). Silverfort reported that the Keychain item can be read by any same-user process without a prompt, because it is created via `/usr/bin/security` rather than code-signed APIs. — [Let's Data Science summary of Silverfort report](https://letsdatascience.com/news/claude-code-keychain-design-exposes-oauth-credentials-268ba827) (secondary report; Anthropic's response not verified)
- **Codex CLI:** `mcp_oauth_credentials_store = auto | file | keyring`. `auto` uses the OS keyring when available and otherwise `CODEX_HOME/.credentials.json`. `codex mcp login` and `codex mcp logout` run the OAuth flow, which works only for streamable HTTP servers. — [openai/codex PR #4857](https://github.com/openai/codex/issues/4857). Codex uses `bearer_token_env_var` to read a static token from an env var. — [Stripe MCP docs (Codex section)](https://docs.stripe.com/mcp)

**Official provider MCP servers**
- **Stripe:**
  - The server is `https://mcp.stripe.com`. Use OAuth for interactive clients. The consent page grants one or more live accounts or sandboxes, with permissions set per environment.
  - For autonomous clients, use an **agent API key** (a restricted key with the "Agent" tag).
  - Admins enable or disable MCP per team, separately for live and sandbox, at MCP and CLI access.
  - Sessions are listed under OAuth sessions and can be revoked individually or all at once. — [Stripe MCP docs](https://docs.stripe.com/mcp)
- **Stripe deadline:** from December 2026, Stripe MCP stops accepting full-access secret keys and restricted keys without the Agent tag. Migrate by **30 Nov 2026**. Unsupported keys get a 401 with an OAuth discovery challenge. — [Stripe MCP docs](https://docs.stripe.com/mcp)
- **Stripe human confirmation:** some actions (refunds, Treasury `send_money` and `transfer_money`) require Dashboard approval. Approval tokens expire after 24 hours, and the check is separate from the client's own tool approval. `stripe agent setup` auto-configures MCP and skills for detected agents. — [Stripe MCP docs](https://docs.stripe.com/mcp)
- **Vercel:**
  - The server is `https://mcp.vercel.com`, a remote server with OAuth. It supports CIMD; otherwise clients need Vercel's review and approval, and there is a list of supported clients.
  - Connecting grants the same access as your Vercel user account. Explicit consent per client connection guards against confused-deputy attacks.
  - Vercel recommends enabling human confirmation.
  - The changelog notes MCP deploy and purchase support. — [Vercel MCP docs (updated 15 Sep 2026)](https://vercel.com/docs/agent-resources/vercel-mcp)
- **Supabase:**
  - The server is `https://mcp.supabase.com/mcp` and uses DCR by default. CI passes a PAT in a header.
  - URL params: `project_ref=<id>` (one project, account tools disabled), `read_only=true` (queries run as a read-only Postgres user) and `features=<groups>`.
  - The server runs with the developer's own permissions. — [Supabase MCP docs](https://supabase.com/docs/guides/getting-started/mcp)
- **Neon:**
  - The server is `mcp.neon.tech`, with OAuth or an API-key bearer token. An org API key limits the server to that org's projects.
  - Read-only comes from unchecking "Full access" during OAuth or from `readonly=true`. `projectId` scopes it to one project.
  - Neon intends the server for local development and IDEs, not production. — [neondatabase/mcp-server-neon](https://github.com/neondatabase/mcp-server-neon)
  - Sources disagree on whether read-only also forces SQL into READ ONLY transactions. A database role is the safer control. — [search summary of Neon sources incl. README](https://github.com/neondatabase/mcp-server-neon)
- **Cloudflare:** managed remote servers (e.g. `mcp.cloudflare.com/mcp`, `bindings.mcp.cloudflare.com/mcp`, `observability.mcp.cloudflare.com/mcp`) accept OAuth. For automation they accept a user or account API token as a bearer token. — [Cloudflare's MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/)
- **GitHub:**
  - The remote server defaults to OAuth sign-in, which can only use the scopes approved at sign-in. A PAT also works and is subject to org PAT restrictions.
  - Copilot Business and Enterprise need the "MCP servers in Copilot" policy. — [GitHub docs: Using the GitHub MCP server](https://docs.github.com/en/copilot/how-tos/context/model-context-protocol/using-the-github-mcp-server)
  - Read-only URL `https://api.githubcopilot.com/mcp/readonly` and per-toolset `/x/{toolset}[/readonly]` (third-party sources). — [dev.to write-up](https://dev.to/gil_5296961bf2e126cf43cb4/mcp-server-for-github-connect-the-official-server-in-two-minutes-and-when-to-build-your-own-2fm0); [Scalekit](https://www.scalekit.com/blog/github-mcp-server-per-user-oauth)
- **AWS:**
  - The managed remote AWS MCP Server went GA on 6 May 2026. — [AWS News Blog](https://aws.amazon.com/blogs/aws/the-aws-mcp-server-is-now-generally-available)
  - It authenticates via IAM SigV4. The open-source `mcp-proxy-for-aws` reads the standard credential chain (e.g. `aws login` creds), signs requests and forwards them.
  - The endpoint is reported as `https://aws-mcp.us-east-1.api.aws/mcp`.
  - It is not an IAM substitute: start with a dedicated read-only role. — [mcp.directory guide](https://mcp.directory/blog/aws-mcp-server-complete-guide-2026); [agentpedia guide](https://agentpedia.codes/blog/aws-mcp-server-secure-iam-guide) (secondary)

### Inferences
- An MCP OAuth grant is usually **user-equivalent** (Vercel says so explicitly; Supabase runs as your own permissions). Scope it down with server-side knobs: Supabase `project_ref`/`read_only`/`features`, Neon `projectId`/`readonly`, GitHub `/readonly`, Stripe's per-environment consent. Client-side tool approval is not a scope control.
- For unattended or CI agents, give the agent a provider-scoped token through an env var (`${VAR}` in `.mcp.json`, or Codex `bearer_token_env_var`). The value then never enters the prompt. Stripe requires these tokens to be Agent-tagged keys after 30 Nov 2026.
- Since the 2026-07-28 revision, a client connecting to new servers should expect CIMD rather than DCR. Vercel already supports CIMD, so supported-client lists will matter less.

### Gaps
- Anthropic's official statement of the exact MCP token storage location, and its response to the Silverfort report, were not verified.
- Cursor's MCP OAuth token storage was not researched.
- No official Google remote MCP server details or Resend MCP auth details were fetched.
- The GitHub `/readonly` path is from third-party sources only.
- AWS MCP endpoint and proxy versions come from secondary sources.

---

## 3. Minting least-privilege runtime credentials per provider

### Takeaway
Nearly every provider can now mint a narrowly scoped runtime credential. Resend has sending-only keys, optionally limited to one domain. Stripe has restricted and Agent-tagged keys with access policies. Cloudflare tokens can be scoped to a zone, IP-bound and given an expiry. GitHub has fine-grained PATs, and GitHub Apps with 1-hour tokens. AWS and GitHub Actions use OIDC roles. Apple JWTs can be scope-limited. Stripe restricted keys and GitHub fine-grained PATs are created in the dashboard and UI; Cloudflare and Resend keys can be created by API.

### Cited Findings
- **Resend:**
  - `POST /api-keys` takes `name` (max 50 chars) and `permission`: `full_access` (create, delete, get and update any resource) or `sending_access` (send emails only).
  - A domain restriction applies only when `permission` is `sending_access`.
  - The response returns `id` and `token` (`re_...`). — [Resend API: Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key)
- **Stripe:**
  - Restricted keys (`rk_`) carry chosen permissions. Secret keys (`sk_`) are no longer recommended for new uses. Org keys are `sk_org_`. "Managed API keys" are delivered by hosting platforms.
  - Create keys on the Dashboard API keys page.
  - Agent-tagged keys ("Authorising agent access to your account") are automatically subject to approval rules for payouts, refunds and config changes. Stripe calls them the recommended way to give agents access. — [Stripe API keys](https://docs.stripe.com/keys)
- **Stripe access policies** replace IP restrictions. They allow by IP/CIDR or by ASN and country, and can block VPNs, proxies and Tor. Stripe recommends them on all live keys. A self-created live restricted key is shown once only. — [Stripe API keys](https://docs.stripe.com/keys)
- **Cloudflare:**
  - Create tokens through `POST /accounts/{account_id}/tokens` (account-owned) or `POST /user/tokens`. The creating token needs Account API Tokens Edit, or the "Create additional tokens" template.
  - A policy has `effect`, `resources` (e.g. `com.cloudflare.api.account.zone.<ZONE_ID>: "*"`) and `permission_groups` by ID.
  - Optional fields: `condition.request.ip.in`/`not_in` (CIDR), `not_before` and `expires_on`.
  - The secret is shown once. — [Cloudflare: Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)
- **GitHub fine-grained PATs:**
  - Each token has one resource owner, selected repositories, and permissions at read, write or admin level. It always includes read access to public repositories.
  - Expiry is 1–366 days or none (default 30), and org or enterprise maximum-lifetime policies may block "none".
  - Orgs can require approval; while pending, the token can read only public resources.
  - There is a 50-token limit. GitHub recommends a GitHub App for org access or long-lived integrations. — [GitHub: Managing PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- **GitHub Apps:** installation access tokens expire after 1 hour. The request body can narrow them with `repositories` or `repository_ids` (up to 500) and `permissions`, but never beyond the app's own permissions. — [GitHub: Installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- **AWS via GitHub OIDC (no stored keys):**
  - The provider is `https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`.
  - The role trust policy conditions on `token.actions.githubusercontent.com:sub`, e.g. `repo:ORG/REPO:ref:refs/heads/main` or `repo:ORG/REPO:environment:NAME`.
  - The workflow needs `permissions: id-token: write`, then uses `aws-actions/configure-aws-credentials` with `role-to-assume`. — [GitHub: OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- **New OIDC subject format:** repos created after 15 Jul 2026, or repos that opt in to immutable subject claims, use IDs in the subject, e.g. `repo:octo-org@123456/octo-repo@456789:ref:refs/heads/octo-branch`. This isn't available on GHES. — [GitHub: OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- **Google:** impersonate a service account instead of downloading keys. The caller needs `roles/iam.serviceAccountTokenCreator`. — [Google ADC local dev](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
- **Apple:** the JWT `scope` claim restricts a token to the listed GET requests, and ASC rejects requests that don't match. Use roughly 2-minute lifetimes for one-off calls and 20 minutes for long processes. — [ASC: Generating tokens](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
- **Supabase and Neon MCP/runtime scoping:** Supabase `project_ref` and `read_only`; Neon org API keys limited to one org's projects. — [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp); [Neon MCP README](https://github.com/neondatabase/mcp-server-neon)

### Inferences
- **Practical minting map:**
  - **Resend:** `POST /api-keys` with `permission: sending_access` plus the domain restriction, one key per app or environment. The agent's own login stays full-access while the runtime key stays narrow.
  - **Stripe:** a Dashboard-created restricted key per service (Agent-tagged if an agent uses it) with an access policy. Programmatic creation outside Stripe Apps' RAK flow wasn't confirmed, so plan a human step.
  - **Cloudflare:** an API-created, zone-scoped token with `expires_on` and an IP condition matching the server.
  - **GitHub:** prefer a GitHub App with per-job tokens (`repositories` + `permissions`) over long-lived PATs.
  - **AWS:** an OIDC role per repo, branch or environment rather than access keys. Trust policies for new repos (after 15 Jul 2026) need the ID-bearing `sub` format.
- The agent should mint the key and pipe it straight into the destination (section 4), so the key never prints to stdout. For APIs that return `token` in JSON, extract it with a tool like `jq -r .token` inside a pipe and never print it.

### Gaps
- The exact Resend domain-restriction parameter name (believed to be `domain_id`) is not shown on the fetched page.
- Whether Stripe restricted or agent keys can be created by API outside Stripe Apps' RAK install flow was not confirmed.
- Whether GitHub fine-grained PATs can be created by API was not confirmed.
- Vercel access-token scoping and expiry options were not fetched.
- Supabase and Neon scoped service-role or database-role minting by API was not researched.

---

## 4. Secret delivery and sync (GitHub Actions, Vercel, server env files, secret managers) and keeping secrets out of model context

### Takeaway
All the main targets accept values on stdin, so an agent can mint, pipe and store a secret without it appearing in chat or logs. `gh secret set NAME` reads stdin and encrypts locally. `vercel env add NAME env < file` reads stdin, and Vercel now has a write-only "Secret" type. `op run` and `op inject` resolve references at runtime. Watch for documented patterns that leak: `--body "$VAR"`, `--value "sk_live_..."`, and `echo value |` put the secret in shell history or the process list.

### Cited Findings

**GitHub Actions secrets (`gh secret set`)**
- Without `--body`, the value is read from stdin or an interactive prompt. `-f/--env-file` loads a dotenv file, and `-f -` reads that from stdin. Values are encrypted locally before upload. — [gh secret set manual](https://cli.github.com/manual/gh_secret_set)
- Scope options:
  - `--env` for environment secrets.
  - `--org` with `--visibility all|private|selected`, `--repos` or `--no-repos-selected`.
  - `--user` for Codespaces.
  - `--app actions|agents|codespaces|dependabot`. **New: `agents`** makes a secret available to agent sessions.
  - `--no-store` prints the encrypted value instead of storing it. — [gh secret set manual](https://cli.github.com/manual/gh_secret_set)

**Vercel env vars**
- **New model (Aug 2026):** environment variables are **Config** (readable after saving) or **Secret** (write-only after saving). Legacy "Sensitive" variables are treated as Secrets. Secrets are now allowed in Development, which reverses the earlier Production/Preview-only rule. — [Vercel: Config and Secret env vars (updated 28 Aug 2026)](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- **Deprecated:** the "Enforce Sensitive Environment Variables" team policy. It is replaced by the optional "Separate Production Secret Values" policy, which requires Production Secrets to differ from other environments. — [Vercel: Config and Secret env vars](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- Build logs redact Secret values that are 32+ characters long, and Vercel logs an Activity Log event per masked key. `VERCEL_OIDC_TOKEN` and `VERCEL_AUTOMATION_BYPASS_SECRET` are always redacted. — [Vercel: Config and Secret env vars](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- REST API: `POST /v10/projects/{id}/env` with `"type": "sensitive", "visibility": "secret"`, or `"type": "encrypted"|"plain", "visibility": "config"`. — [Vercel: Config and Secret env vars](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- CLI:
  - Pass a value with `vercel env add [name] [environment] [gitbranch] < [file]`, or `cat file | vercel env update NAME preview`.
  - The docs warn that `echo [value] | vercel env add` saves the value in bash history.
  - Set the type with `--type secret|config`, or `--sensitive`/`--no-sensitive`. `--visibility` is a **deprecated** alias.
  - Defaults are Secret for Production, Preview and custom environments, and Config for Development.
  - Variables with a public prefix such as `NEXT_PUBLIC_` are stored as Config. — [vercel env CLI (updated 20 Aug 2026)](https://vercel.com/docs/cli/env)
- `vercel env run -e production -- <cmd>` injects variables without writing a file. `vercel env pull` merges into an existing file, and for unreadable Secrets it keeps the local value or writes a placeholder. — [vercel env CLI](https://vercel.com/docs/cli/env)
- The Vercel CLI docs' own examples use `--value "sk_live_..." --sensitive --yes`. — [vercel env CLI](https://vercel.com/docs/cli/env)

**1Password**
- Service accounts provide CLI authentication that "isn't associated with an individual". You choose which vaults and Environments they can reach and which actions they may take. Usage reports show which items a service account accessed. The limit is 100 service accounts. — [1Password service accounts](https://www.1password.dev/service-accounts/)
- `op run` resolves `op://vault/item/field` references from `--env-file`, exported variables or `--environment <id>`. It passes them to a subprocess only for the life of that process. `--no-masking` shows secrets in output, which implies masking is the default (not explicitly confirmed). 1Password warns that same-user processes can read another process's environment. — [1Password: Load secrets into the environment](https://www.1password.dev/cli/secrets-environment-variables/)
- `op inject` resolves a template file containing `{{ op://... }}` references into a config file with real secrets. It supports `${VAR:-default}` expansion. — [1Password: Template syntax](https://www.1password.dev/cli/secrets-template-syntax/)

**Doppler, Infisical, SOPS (lighter coverage)**
- Doppler service tokens are scoped to one project and config, and are typically stored as a `DOPPLER_TOKEN` GitHub secret. One tool documents OIDC exchange for short-lived Doppler tokens on Team and Enterprise plans. — [fnox Doppler provider doc](https://docs.rs/crate/fnox/latest/source/docs/providers/doppler.md) (third-party)
- Infisical uses Machine Identities with Universal Auth (client ID and secret). It is open source and self-hostable, while Doppler is cloud-only. — [pkgpulse comparison](https://www.pkgpulse.com/guides/infisical-vs-doppler-vs-hashicorp-vault-secrets-2026) (secondary, vendor-adjacent)
- SOPS edits encrypted YAML, JSON, ENV, INI and binary files. It encrypts with AWS KMS, GCP KMS, Azure Key Vault, HuaweiCloud KMS, age and PGP. — [SOPS docs](https://getsops.io/docs/)

**General secret-hygiene guidance**
- OWASP says to make sure pipeline output doesn't leak secrets, to mask or encrypt so plaintext is never logged, to keep a process for scrubbing leaked secrets from logs, and to alert on extraction attempts (e.g. double base64). — [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- Stripe says not to share keys over email, chat or other unencrypted channels, and to store them in a platform secrets vault, or in env vars if there's no vault. — [Stripe API keys](https://docs.stripe.com/keys)

### Inferences
- **Out-of-context patterns:**
  - Mint and deliver in one pipeline, e.g. a curl to the provider API, then `jq -r .token`, then `gh secret set NAME --repo O/R` (stdin), then the Vercel equivalent `vercel env add NAME production --sensitive`, also from stdin.
  - For a server env file, pipe into `ssh host 'umask 077; cat >> /path/.env'`, or into `install -m 600` on the remote.
  - Never use `--body`, `--value` or `echo`, which leak into history or argv.
  - Use `tee` to fan one value out to several sinks, with `>/dev/null` so nothing prints.
  - Confirm success with metadata only: `gh secret list`, `vercel env ls`, or a remote `grep -c '^NAME=' .env`. Never cat the value.
- Values that Next.js inlines at build time (`NEXT_PUBLIC_*`) are public by design, and Vercel stores them as Config. Never put a secret under a public prefix.
- Vercel redacts only values of 32+ characters, so short secrets (PINs, short passwords) can still show up in build logs.
- With `op run` and `vercel env run`, the agent's shell never holds the secret as a literal. The child process still has it in its environment, and so does any same-user process that can read it.

### Gaps
- Doppler and Infisical native sync to GitHub and Vercel was not verified on official pages.
- Pulumi ESC was not researched.
- SOPS + age specifics (`.sops.yaml` rules, `SOPS_AGE_KEY_FILE`, `exec-env`) were not fetched; only the landing page.
- `op run` default masking and the `OP_SERVICE_ACCOUNT_TOKEN` variable name were not confirmed on the fetched pages.
- The GitHub `--app agents` semantics (which agent products read these secrets) were not explored.

---

## 5. Revocation, rotation and audit

### Takeaway
Every provider covered has a list-and-revoke surface:

- **GitHub:** settings pages and `gh auth logout`.
- **Stripe:** an OAuth sessions table, including admin "Revoke all", plus key rotation with a grace period of up to 7 days.
- **Cloudflare:** token delete, `wrangler logout`, and deleting the tunnel's API token.
- **AWS:** `aws logout`.
- **Google:** `application-default revoke`.
- **Apple:** key revoke, which is irreversible.
- **MCP clients:** a logout command, which is not the same as removing the server.

No authority gives a universal rotation interval. Guidance points to short-lived and dynamic credentials instead.

### Cited Findings
- Stripe:
  - Revoke MCP and CLI OAuth sessions under User settings → OAuth sessions. Admins can do it per member, including "Revoke all". Revocation applies only to the account and environment in view.
  - `stripe logout` revokes the CLI session and clears local credentials. — [Stripe MCP docs](https://docs.stripe.com/mcp); [Stripe CLI login](https://docs.stripe.com/cli/login)
- Stripe key rotation: both the old and new key work for **up to 7 days**, and you can schedule a rotation. Check request logs before expiring the old key. Keys unused for transfers or payouts for 180+ days get limited access. Request logs per key are in Workbench. — [Stripe API keys](https://docs.stripe.com/keys)
- Cloudflare:
  - `wrangler logout` invalidates the OAuth token.
  - API tokens are revoked by deleting them in the dashboard.
  - `cert.pem` is revoked by deleting the associated API token. — [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/general/); [Tunnel permissions](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/tunnel-permissions/)
- AWS: run `aws logout [--profile|--all]` or let the 12-hour session expire. — [AWS CLI sign-in](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)
- Google: `gcloud auth application-default revoke`. — [Google ADC local dev](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
- GitHub: delete fine-grained PATs under Settings → Developer settings. A leaked token belonging to someone else can be reported for revocation via the REST API. Deleting a PAT also deletes any deploy key created with it. — [GitHub: Managing PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- Apple: revoke immediately if a key is lost, compromised or unused. A revoked key **cannot be reinstated**, and revoked keys stay listed for 30 days. — [ASC: Revoking API keys](https://developer.apple.com/documentation/appstoreconnectapi/revoking-api-keys)
- MCP clients: `claude mcp logout <name>` revokes. `claude mcp remove` alone does not revoke at the authorization server. "Clear authentication" is in `/mcp`. — [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- Audit:
  - Stripe Workbench MCP tool-call logs and per-key request logs. — [Stripe MCP](https://docs.stripe.com/mcp); [Stripe keys](https://docs.stripe.com/keys)
  - Vercel Activity Log events for redacted secrets. — [Vercel env types](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
  - 1Password service-account usage reports. — [1Password service accounts](https://www.1password.dev/service-accounts/)
- Rotation cadence (OWASP):
  - OWASP gives **no fixed interval**. It says to rotate regularly so stolen credentials work only briefly, to automate rotation, and to prefer dynamic secrets with short leases and explicit revocation.
  - User credentials should be rotated only on suspected compromise.
  - CI/CD logs should be queryable for at least 90 days. — [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- Default and maximum lifetimes that act as de facto rotation:
  - GitHub fine-grained PAT: default 30 days, maximum 366 days or none. — [GitHub PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
  - GitHub App installation token: 1 hour. — [GitHub App tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
  - Apple JWT: 20 minutes. — [ASC tokens](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
  - AWS login session: 12 hours. — [AWS CLI sign-in](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)
  - Cloudflare: `expires_on` sets the expiry. — [Cloudflare token API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)

### Inferences
- **Suggested cadence (inference, not from a single authority):**
  - Prefer credentials that expire without anyone acting: OIDC for AWS, GitHub App tokens, short Apple JWTs.
  - For static runtime keys (Resend sending keys, Stripe restricted keys, Cloudflare tokens), set an explicit expiry where supported and rotate every 90 days or so, and immediately on staff change or suspected leak.
  - Re-run the agent's laptop logins whenever their refresh tokens lapse. Revoke them when a project ends.
- Keep a small inventory per project: provider, credential name or ID, scope, where it is synced, expiry. Rotation then becomes a scripted mint, pipe, verify, and expire-the-old-one sequence.

### Gaps
- Vercel token revocation and listing via CLI/API was not fetched.
- Resend API key list/delete endpoints and `resend logout` server-side revocation are not documented on the pages fetched.
- Supabase and Neon token revocation surfaces were not fetched.
- Google OAuth refresh-token lifetime policies (e.g. testing-mode limits) were not researched.

---

## 6. Security guidance on giving agents credentials

### Takeaway
Providers and researchers agree:

- Scope agent credentials to the minimum.
- Keep humans approving consequential actions.
- Assume prompt injection.

The highest-risk setup is an agent that combines private data, untrusted content and an outbound channel (the "lethal trifecta"). Providers now add server-side approval gates: Stripe's Agent-tagged keys with approval rules and human confirmation, and Vercel's and Supabase's explicit consent and review guidance.

### Cited Findings
- Simon Willison's "lethal trifecta" (16 Jun 2025) is access to private data, exposure to untrusted content, and the ability to communicate externally. Together they let an attacker steal data via prompt injection. His advice:
  - Avoid the combination entirely.
  - Scope credentials tightly and prefer read-only access.
  - Be wary of mixing MCP tools from different sources.
  - Don't rely on prompt-based guardrails.
  - Require approval for consequential actions after the agent has read untrusted input. — [Simon Willison: The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- Stripe:
  - Turn on the client's tool-approval setting, and take care combining Stripe MCP with other servers, because of prompt injection.
  - Agent-tagged keys get default approval rules covering payouts, refunds and account configuration, which guard against agent mistakes and hallucinations.
  - Human-confirmation actions need Dashboard approval. — [Stripe MCP](https://docs.stripe.com/mcp); [Stripe API keys](https://docs.stripe.com/keys)
- Supabase:
  - Malicious text in data, such as a support ticket, can make an LLM run harmful queries, so review each tool call and keep manual approval on.
  - Unattended routines should be project-scoped and read-only, and should report recommendations rather than write.
  - Don't give the server to customers.
  - Elicitation confirmations are a guardrail, not a guarantee. — [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp)
- Vercel:
  - Verify the official endpoint, and only use trusted clients.
  - Connecting grants user-equivalent access.
  - Vercel gives a prompt-injection exfiltration example (copying deployment logs to a malicious domain).
  - Always enable human confirmation. — [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)
- MCP spec: token passthrough is forbidden, servers MUST validate the token audience, and DCR proxies must get consent per client to prevent confused-deputy attacks. — [MCP spec 2025-11-25: Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- Claude Code:
  - Verify that you trust each server, because servers that fetch external content expose you to prompt injection.
  - `disabledMcpjsonServers` or `--strict-mcp-config` can block project-supplied servers.
  - Remote `url` and `headers` expansion blanks known credential env vars. — [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- AWS MCP Server is not an IAM substitute or an agent safety boundary. Start with read-only discovery and a dedicated role. — [agentpedia AWS MCP guide](https://agentpedia.codes/blog/aws-mcp-server-secure-iam-guide) (secondary)
- 1Password warns that same-user processes can read the environment of other processes. — [1Password op run](https://www.1password.dev/cli/secrets-environment-variables/)
- A keychain item created through `/usr/bin/security` was reported as readable by same-user processes without a prompt (Silverfort, about Claude Code). — [Let's Data Science summary](https://letsdatascience.com/news/claude-code-keychain-design-exposes-oauth-credentials-268ba827) (secondary)

### Inferences
- **Recommended guardrails for an agent on a laptop:**
  1. **Separate the agent's control-plane login from runtime keys.** The agent's login can be broad but human-approved and revocable (OAuth/keychain). Runtime keys are minted narrow (sending-only, zone-scoped, restricted, OIDC).
  2. **Never route secrets through chat.** Mint into a pipe. The human enters any unavoidable secret in the provider UI or a masked prompt, never in the conversation.
  3. **Prefer server-side gates over client prompts.** Stripe approval rules, Supabase `read_only`, Neon `readonly`, GitHub `/readonly`, AWS read-only roles.
  4. **Keep production write access out of agent sessions that also browse the web or read email.** This breaks the trifecta.
  5. **Revoke at the issuer** (logout or session revoke), not just locally.
- Keychain storage on macOS is not a strong boundary against code running as the same user, and an agent's shell is such code. Least privilege and short lifetimes matter more than where the token is stored.

### Gaps
- Official GitHub, AWS or Google security guidance written specifically for AI agents was not located in this pass. OWASP's agentic-AI top-10 was not fetched.
- I found no independent measurements of how often prompt-injection-driven credential misuse occurs in coding agents.
