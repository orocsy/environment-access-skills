---
name: stack-setup
description: Check, record and set up one app's whole stack from a short stack.yaml in that app's repo. The owner picks a provider for each job (DNS, API host, web, database, email, payments, sign-in, CI); the agent does every step an API or CLI allows and leaves the owner only sign-in, approval, terms, payment and the few console buttons providers keep for people. Use when asked to check production, "is everything set up", record what exists, list what the owner still has to do, or set up a new app's providers.
---

# stack-setup

One file says what an app needs. One command checks all of it.

```text
stack.yaml           committed in the app repo: providers and names, never secrets
.stack/state.json    committed beside it: resource IDs, human-step status, last check results
```

Read commands never change anything. Change commands show their plan and do nothing without `--confirm`.

## Commands

Run from the app repo (it looks for `infra/stack/stack.yaml`, then `stack.yaml`):

```sh
S=<this skill>/scripts/stack.mjs
node $S doctor     # tools, logins, deadlines
node $S connect    # the sign-ins still to do, before any work
node $S import     # find what already exists, record IDs
node $S verify     # green/red for every item
node $S gates      # human steps still open
node $S plan       # what apply would do

node $S apply --confirm      # create what's missing, mint keys, write the store and mirrors
node $S sync --confirm       # re-copy the store to its mirrors, correct config values
node $S teardown --confirm   # remove only what stack-setup created
node $S gates set <id> done --by <name>
```

Options: `--report file.md` saves the Markdown report, `--json` prints JSON, `--wait <minutes>` sets how long `apply` waits for DNS (default 10), and `--no-save` leaves state alone (read commands only).

Exit codes: `0` done or all green, `1` something is red or failed, `2` something couldn't be checked (a login or tool is missing), `3` waiting (DNS), `10` changes planned but not confirmed, `64` usage.

### What apply does today

| Provider | Creates | Mints | Syncs |
|---|---|---|---|
| `cloudflare` | DNS records other adapters ask for; the CNAME to a tunnel | | |
| `resend` | the sending domain, its DNS records (through the DNS capability), then verification | a send-only key for that domain only | `EMAIL_FROM` |
| `vercel` | config env values (`value:` or `from: <capability>.url`) | | corrects values that differ |
| `github` | | | the whole store into each `github-secret` mirror |
| secret store | | | `server-env` (a file on the host, a dated backup each time) or `local-env` (a 0600 file on this machine, refused inside Git unless ignored) |

Writing to a `1password` store, Stripe, Google, the AWS host bootstrap and `rotate` come in M3.

## How to work with it

1. Run `connect` first. Each sign-in still to do is a **preflight** gate. Give the owner all of them in one message, before other work.
2. Run `import` on an app whose resources were made by hand. Commit the state file it writes.
3. Run `verify`. Report the summary line and every red or blocked row in plain words. Don't paste the whole table unless asked.
4. Run `gates` and give the owner only the open steps, grouped as the output groups them. Every step already has its link and pre-filled values. A step with "closes itself" needs no reply; the next `verify` sees it.
5. When the owner says a manual step is done, run `gates set <id> done --by <name>`.
6. To set something up: run `plan` and tell the owner what it will create, in plain words. Run `apply --confirm` only once they have agreed. If it stops at a DNS wait, run it again later; finished steps aren't repeated.
7. `teardown --confirm` removes only what stack-setup created, newest first, revoking keys at the issuer. Anything imported or made by hand is never touched. It's safe to re-run: things already gone count as removed.

## Rules

- **Secrets never appear.** Not in stack.yaml, state.json, reports, arguments or chat. The tool refuses to write anything shaped like a key. Checks report names, counts and IDs only.
- **Secrets the owner hands over** go through `secure-key-handoff` (the gate lists which names). Never ask for them in chat.
- **Terms, payments, account creation:** the owner does these. Never accept terms or pay for them.
- **Choosable secret store:** `secrets.canonical.type` is `server-env` (a file on the API host), `local-env` (a file on this machine) or `1password` (a vault item). Checks read names only. A minted key goes straight from the provider into the store and its mirrors, held in memory and passed on stdin.
- **Never overwrite:** a DNS record that already points somewhere else is a conflict for a person to resolve. A key whose value is already in the store is left alone; replacing it is `rotate`.
- **Nothing is minted unless its store can be written.** If the store can't be read, the key step is skipped.

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

M3 brings `rotate`, Stripe and Google set-up, the AWS host bootstrap and writing to 1Password. See [`docs/stack-setup/DESIGN.md`](../../docs/stack-setup/DESIGN.md).
