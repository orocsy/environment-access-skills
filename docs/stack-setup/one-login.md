# One sign-in per provider, the agent does the rest

Status: design for owner approval, 11 Nov 2026.

## What the owner wants

The owner sets up an app the way Supabase feels:
1. Sign in once.
2. Maybe create one key, or just confirm one.
3. Get on with building.

The agent does everything else: keys, URLs, webhooks, permissions, sandbox and live, even email verifications. That covers going live and getting paid too, not only deploying.

## How the "one click" products manage it

The research behind this is in [the report](../../reports/Automated%20stack%20provisioning%20for%20agents.md).
- **Supabase is one product.** The database, sign-in, storage and functions are all Supabase, so there is only one account to have.
- **Vercel Marketplace and Stripe Projects are umbrellas** with partner contracts. You sign in to the umbrella once. When you pick a provider, you accept that provider's terms in one dialog. The umbrella then creates your account at the provider using its own signed identity, and puts the keys straight into your project. That works because each provider has built the umbrella's partner API.
  - Stripe Projects covers dozens of providers from one Stripe sign-in, and writes the credentials to `.env` ([Stripe Projects](https://docs.stripe.com/cli/projects.md)). It doesn't push them to a production host for you.
  - Vercel Marketplace only fills Vercel projects.

We can't become an umbrella: that takes partner deals. We can do two things instead:
1. **Use an umbrella as one adapter** wherever it already covers a capability. For example, Supabase or Neon through Stripe Projects.
2. **Make every other provider one sign-in**, after which the agent mints its own narrow keys.

## Why WiggleTrail took so many steps, and the fix for each

| What happened | Why | Fix |
|---|---|---|
| Sign-ups and terms at every provider | First time; providers keep these for people | Unavoidable, but once per provider, all in one sitting (`stack connect`) |
| A new Cloudflare token for each new job (DNS, tunnel, then email forwarding) | Each token was made with only what that job needed | **One bootstrap token** made from Cloudflare's "Create additional tokens" template. The agent then mints a narrow token per job by API ([Cloudflare](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)). |
| AWS sign-in every 12 hours | Console sign-ins expire | **Done:** the agent's own narrow key |
| Everything set up in test mode, then again for live | Sandbox first by design | `environments: [sandbox, live]` in one stack file. `apply` does both, and live is gated once, at go-live. |
| Console-only steps: the Google client, Stripe Connect settings and live restricted key, Apple | The providers allow these only in their dashboards | Unavoidable. Each is one pre-filled page with the exact values (`stack guide`), and whatever it produces comes back by `gates pickup` |
| Keys pasted around | No hand-back path yet | **Done:** secure handoff, `pickup`, and minting straight into the store |
| Verification emails to click | The address belongs to a person | The **agent inbox** (below) |
| "Which page? Which setting?" | Knowledge in the agent's head, not in the tool | **Done:** guided steps with dated sources |

## The target, provider by provider

| Provider | You do once | The agent does after |
|---|---|---|
| GitHub | `gh auth login` approval | Secrets, workflows, deploy keys |
| Vercel | `vercel login` approval | Projects, env values, domains, redeploys |
| Cloudflare | Create the bootstrap token (one pre-filled page), handed back by pickup | Every narrow token, DNS, tunnels, email forwarding, rules |
| AWS | One `aws login` | Its own narrow key, rotation, servers (prices confirmed first) |
| Resend | `resend login --web` approval | Domains, DNS records, send-only keys, the agent inbox |
| Stripe | `stripe login` approval; the live restricted key (one pre-filled page); live activation (identity, bank) | Webhooks and their secrets, Connect checks, products and prices |
| Google sign-in | Consent screen terms, creating the client (one pre-filled page), publishing | Redirects, storing and rotating the secret, checks |
| Apple | Enrolment, and agreements in App Store Connect | Bundle IDs, certificates, App Store Connect settings through an API key you create once |
| Tencent Cloud | Real-name verification; one `tccli auth login` | Its own CAM key, servers (bought last), DNSPod, COS, SMS templates |
| WeChat Pay / Alipay | Merchant onboarding as the business; download the API certificate once | Keys and certificates into the store, callbacks, checks |
| Through Stripe Projects (Supabase, Neon, Clerk and others) | One Stripe sign-in; accept each provider's terms in the dialog | The resource, its keys into the store |

After the first sitting, the owner's part is confirming prices and approving go-live steps that need identity.

## The agent inbox

Some steps send an email that someone has to open: a forwarding destination to confirm, a notice from a provider. Give the agent its own address on the app's domain, for example `agent@ops.example.com`, using Resend's receiving ([Resend receiving](https://resend.com/docs/dashboard/receiving/introduction)). The agent reads it through the API.

- **Use it** where an address is only for notices or confirmations the agent asked for, such as a Cloudflare forwarding destination or a provider's technical contact.
- The agent may follow a confirmation link only for a step the owner already approved, and says which link it followed.
- **Never:**
  - signing up for an account in the owner's name;
  - receiving passwords;
  - acting on anything in an email it didn't expect.

  Mail it didn't expect is shown to the owner, not acted on.
- **The owner's own inbox stays the owner's.** A specific verification email can be forwarded to the agent inbox when they want it handled.

## Working with each project's own agent

Every project has an agent building it. That agent knows the tech stack; stack-setup knows the providers. They meet in one file:
1. **The project's agent runs `stack init`.** It reads the repo: package files, Dockerfiles and compose files, env examples, deploy docs. It drafts `infra/stack/stack.yaml`: a provider for each capability, the env names the code reads (the contract), and the interview's answers it can infer.
2. **The owner answers only what can't be inferred**, such as who files in China, or whether the app takes payments, through `stack guide ask`.
3. **stack-setup then works from the file:** `plan`, `apply`, `guide`. When the project's agent adds a dependency (a queue, an email provider, AI), it edits the stack file, and the next `plan` shows the change.
4. **Machine-wide credentials are shared:** the Cloudflare starter token, provider CLI sign-ins, and the AWS owner sign-in. A new project creates only its own agent keys.

Already true: an existing company skips the registration steps (`registration: registered`), straight to filings and audits. Apps offering generative AI in China get the AI service filing step (`ai: true`).

## Milestones (to approve)

1. **O1:** the Cloudflare bootstrap token and token minting; email forwarding (Email Routing rules) as a capability. This also finishes WiggleTrail's `support@` forwarding.
   - Live 13 Nov 2026: the owner's starter token is at `~/.config/stack-setup/cloudflare-bootstrap.env`, shared by every project on this computer. WiggleTrail's agent token is minted, and the manual one it replaced is revoked.
   - Built 12 Nov 2026, in #8. WiggleTrail's `support@` forwarding was already live, so it's now checked (green) rather than rebuilt. Minting waits on the owner's one bootstrap token.
2. **O2:** `environments: [sandbox, live]` in one stack file; Stripe live mode through the same adapter; a go-live gate bundle.
3. **O3:** the agent inbox: Resend receiving, a `wait-for-email` step kind, and confirmation links followed only for approved steps.
4. **O4:** a Stripe Projects adapter for the providers it covers, after checking what an Australian account can use.
5. **O5:** an Apple App Store Connect API key adapter, so bundle IDs, certificates and App Store settings stop being console work.
6. **O6:** `stack init`, so a project's agent drafts its stack file from the code.
