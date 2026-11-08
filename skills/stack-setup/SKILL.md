---
name: stack-setup
description: Check, record and (in later versions) set up one app's whole stack from a short stack.yaml in that app's repo. The owner picks a provider for each job (DNS, API host, web, database, email, payments, sign-in, CI); the agent does every step an API or CLI allows and leaves the owner only sign-in, approval, terms, payment and the few console buttons providers keep for people. Use when asked to check production, "is everything set up", record what exists, list what the owner still has to do, or set up a new app's providers.
---

# stack-setup

One file says what an app needs. One command checks all of it.

```text
stack.yaml           committed in the app repo: providers and names, never secrets
.stack/state.json    committed beside it: resource IDs, human-step status, last check results
```

Today (M1) it only **reads**. It never creates, changes or deletes anything at a provider.

## Commands

Run from the app repo (it looks for `infra/stack/stack.yaml`, then `stack.yaml`):

```sh
node <this skill>/scripts/stack.mjs doctor    # tools, logins, deadlines
node <this skill>/scripts/stack.mjs import    # find what already exists, record IDs
node <this skill>/scripts/stack.mjs verify    # green/red for every item
node <this skill>/scripts/stack.mjs gates     # human steps still open
node <this skill>/scripts/stack.mjs gates set <id> done --by <name>
```

Add `--report file.md` to save the Markdown report, `--json` for JSON, `--no-save` to leave state alone.

Exit codes: `0` all green, `1` something is red, `2` something couldn't be checked (a login or tool is missing), `64` usage.

## How to work with it

1. Run `doctor` first. Anything red there is a missing tool or login. Turn each one into a **preflight** gate for the owner, all in one message, before other work.
2. Run `import` on an app whose resources were made by hand. Commit the state file it writes.
3. Run `verify`. Report the summary line and every red or blocked row in plain words. Don't paste the whole table unless asked.
4. Run `gates` and give the owner only the open steps, grouped as the output groups them. Every step already has its link and pre-filled values. A step with "closes itself" needs no reply; the next `verify` sees it.
5. When the owner says a manual step is done, run `gates set <id> done --by <name>`.

## Rules

- **Secrets never appear.** Not in stack.yaml, state.json, reports, arguments or chat. The tool refuses to write anything shaped like a key. Checks report names, counts and IDs only.
- **Secrets the owner hands over** go through `secure-key-handoff` (the gate lists which names). Never ask for them in chat.
- **Terms, payments, account creation:** the owner does these. Never accept terms or pay for them.
- **Choosable secret store:** `secrets.canonical.type` is `server-env` (a file on the API host) or `1password` (a vault item). Both are checked by name only.

## stack.yaml

A full example is [`docs/stack-setup/example.stack.yaml`](../../docs/stack-setup/example.stack.yaml) in this repo. Each capability names a `provider`; the adapter for that provider checks the rest of its options and names any that are missing.

| Provider | Capability | Checks |
|---|---|---|
| `cloudflare` | DNS | token, zone active, tunnel healthy, tunnel ingress, CNAME to the tunnel |
| `aws-ec2-docker` | API host | login, instance running and sized, Elastic IP, open ports, `/health`, SSH, cloudflared |
| `docker-postgres`, `docker-redis` | database, cache | container up and healthy on the host |
| `vercel` | web | production ready, Git link, domains verified, env names present |
| `github` | CI | repo, Actions secret names, last deploy run |
| `resend` | email | domain verified, region, DNS records, a key exists |
| `stripe` | payments | webhook routes refuse unsigned calls; endpoints enabled (needs the Stripe CLI) |
| `google-oauth` | sign-in | the API redirects to Google with the expected client |

A provider with no adapter yet is reported as skipped, not failed. To add one, write `scripts/adapters/<provider>.mjs` with `validate`, `gates`, `doctor`, `import` and `verify`. Register it in `adapters/index.mjs` and test it against recorded JSON in `tests/`.

## Not yet

`plan`, `apply`, `connect` and `sync` arrive in M2. `rotate` arrives in M3. See [`docs/stack-setup/DESIGN.md`](../../docs/stack-setup/DESIGN.md).
