# Terraform/OpenTofu vs stack-setup

Written 9 Nov 2026 for the owner's three questions. Sources are listed at the end. Provider coverage comes from the [research report](../../reports/Automated%20stack%20provisioning%20for%20agents.md), checked on 7 Nov 2026.

## Short answers

1. **Does Terraform fit several projects?** Yes. Each app gets its own folder of config and its own state, and shared pieces become modules. That is its normal use.
2. **Is it free?** The tools are free to run on your own machine:
   - **OpenTofu** is open source (MPL 2.0, Linux Foundation).
   - **Terraform** 1.6 and later uses the Business Source License (BSL 1.1). Running it for your own apps is allowed. The licence only stops companies from selling a product that competes with HashiCorp's.
   - **HCP Terraform**, HashiCorp's hosted service, has a free plan for up to 500 managed resources. WiggleTrail would use about 40. The old free plan ended on 31 March 2026, and paid plans are billed per resource.
3. **If we used it, would we still need stack-setup?** Yes. Terraform covers about half of this stack, and it's the easy half. It can't do the slow parts: the human steps, secrets that are shown only once, copying values from one provider into another, and keeping the server env file in sync. Google won't let any tool create a sign-in client, so that step stays manual whichever tool we pick.

**Recommendation: hybrid, later.** stack-setup stays the one command you run. It reads `stack.yaml`, keeps the list of human steps and moves secrets by pipe. Once an app has real users or a second environment, the Cloudflare, Vercel, GitHub and AWS adapters can hand their part to OpenTofu (not Terraform, so the licence never matters), with encrypted state. Until then, plain CLI and API calls are shorter and have one less tool to learn.

## Side by side

| | Terraform / OpenTofu | stack-setup |
|---|---|---|
| **Cloudflare** (zone, DNS, tunnel) | Strong (vendor provider) | Adapter over the REST API |
| **Vercel** (projects, env, domains) | Strong (vendor provider, write-only env values) | Adapter over `vercel api` |
| **GitHub** (secrets, workflows) | Strong, but secret values land in state unless pre-encrypted | Adapter over `gh`; values only by stdin |
| **AWS** (EC2, IP, security group) | Strong (official provider) | Adapter over `aws`; host setup reuses `ec2-bootstrap.sh` |
| **Stripe** | Young provider (0.3.0); no Connect settings; webhook secret kept in state | Adapter over `stripe`; Connect settings become a pre-filled human step |
| **Resend** | Community provider, 1 star | Adapter over `resend` (official CLI) |
| **Google sign-in client** | Not possible | Human step with pre-filled values; the secret is collected by secure handoff |
| **Human steps** (sign-in, terms, payment, console buttons) | Not modelled; apply just fails | A step list: link, pre-filled values, a check that closes each step |
| **Secrets in state** | Often, depending on the provider | Never; state holds IDs only, and a guard refuses to write anything shaped like a key |
| **Wiring between providers** (Resend records → Cloudflare, API URL → Stripe webhook → GitHub and the server) | Possible within one config; values pass through state | The runner passes outputs between adapters; secrets go straight to the store |
| **Server env file sync** | Out of scope (needs a provisioner or Ansible) | Built in: canonical store → mirrors, checked by name only |
| **Several apps, different providers** | Modules per provider; each app writes its own config | Each app's `stack.yaml` picks providers; the adapters are shared |
| **Adopting things made by hand** | `import` blocks | `stack import` |
| **Detecting drift** | `plan -refresh-only` | `stack verify` |
| **Cost** | Free locally; HCP free up to 500 resources | Free; Node 22 only |
| **Learning curve** | HCL, state, providers, backends | One YAML file and nine commands |

## What Terraform does better, and what we borrow

Terraform converges: a re-run with no changes does nothing, and `plan` shows the difference before anything changes. stack-setup copies both. Every adapter step gets or creates by a natural key. `plan` comes before `apply`. Anything destructive needs `--confirm`. If a future app moves everything onto Cloudflare, Vercel and AWS with no human steps, a plain OpenTofu config may be enough on its own. stack-setup should then call it rather than compete with it.

## Sources

- HCP Terraform free plan: [HashiCorp, "Continuing HCP Terraform's enhanced free tier experience"](https://www.hashicorp.com/blog/continuing-hcp-terraform-s-enhanced-free-tier-experience); [Scalr on the legacy plan's end](https://scalr.com/learning-center/hcp-terraform-free-tier-is-being-discontinued-what-you-need-to-know). Paid per-resource prices are only in third-party guides, so check HashiCorp's pricing page before relying on them.
- Licences: [Spacelift on HashiCorp's licence change](https://spacelift.io/blog/hashicorps-license-change); [Encore, OpenTofu vs Terraform 2026](https://encore.dev/articles/opentofu-vs-terraform-2026). Read the BSL and MPL texts themselves before any commercial use.
- Provider coverage, secrets in state and Google's removed OAuth API: [research report](../../reports/Automated%20stack%20provisioning%20for%20agents.md), sections on IaC and human gates.
