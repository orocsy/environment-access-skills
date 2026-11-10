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
node $S guide      # the owner's next step only, everything on one screen
node $S guide all  # the whole route: tracks, waits, deadlines, what costs money

node $S apply --confirm      # create what's missing, mint keys, write the store and mirrors
node $S sync --confirm       # re-copy the store to its mirrors, correct config values
node $S teardown --confirm   # remove only what stack-setup created
node $S rotate <name> --confirm   # replace a key or secret, then revoke the old one
node $S gates set <id> done --by <name>
node $S gates pickup <id> --file <path> --confirm   # store what a person handed back
```

Options: `--accept-cost` allows steps that cost money (only after the owner agreed to the price the plan shows), `--revoke <id>` names an old key made by hand for `rotate` to revoke, `--report file.md` saves the Markdown report, `--json` prints JSON, `--wait <minutes>` sets how long `apply` waits for DNS (default 10), and `--no-save` leaves state alone (read commands only).

Exit codes: `0` done or all green, `1` something is red or failed, `2` something couldn't be checked (a login or tool is missing), `3` waiting (DNS), `10` changes planned but not confirmed, `64` usage.

### What apply does today

| Provider | Creates | Mints | Syncs |
|---|---|---|---|
| `cloudflare` | DNS records other adapters ask for; the CNAME to a tunnel | | |
| `resend` | the sending domain, its DNS records (through the DNS capability), then verification | a send-only key for that domain only | `EMAIL_FROM` |
| `vercel` | config env values (`value:` or `from: <capability>.url`) | | corrects values that differ |
| `github` | | | the whole store into each `github-secret` mirror |
| `stripe` | webhook endpoints with the listed events (`webhooks.<name>: { path, events, connect, secret_env }`) | each endpoint's signing secret | corrects events; never re-creates an endpoint whose secret it doesn't hold |
| `aws-ec2-docker` | with `agent: { profile }`: an IAM user, a managed policy and a key for the agent. With `bootstrap: <script>` and no server: key pair, SSH-only firewall, instance, Elastic IP, then the script over SSH | the agent's access key, into `~/.aws/credentials` (0600) | |
| secret store | | | `server-env` (a file on the host, a dated backup each time; `reload:` makes the app reread it) or `local-env` (a 0600 file on this machine, refused inside Git unless ignored) |

`rotate` works for every minted value: `RESEND_API_KEY`, each Stripe `secret_env`, and `agent-key`. It always makes the new one, writes the store and mirrors, and reloads the app. Only then does it revoke the old one. Without `reload:` on a server-env store it keeps the old one and tells you to revoke it after the next deploy.

Values only a person can get go through `gates pickup`: Google's client JSON (`google.client`), or a KEY=value file from `secure-key-handoff` (for example `stripe.restricted-key`). The file is moved to the Trash afterwards.

### The AWS agent key

AWS console sign-ins (`aws login`) last 12 hours. With `agent: { profile: <name> }`, one `apply` (while the owner is signed in) makes an IAM user `stack-setup-<app>` and a key for it. After that every check and routine change uses that key. The key never expires; `rotate agent-key` replaces it without the owner. Its policy allows:
- reading the account;
- creating and managing only resources tagged `stack-setup:app=<app>`, in the stack's region;
- rotating its own key.

It can't create users, change policies, touch untagged resources (such as a server made by hand), use other regions, or read S3. AWS's policy simulator confirms each of these.

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
- **Money:** a step that costs money shows its price in the plan (💲), and `apply` refuses the whole run without `--accept-cost`. Nothing is half-built.

## Guiding the owner

When a person has steps to do, show them `stack guide` output, not a list of everything. Each step says:
- who does it, and where;
- the numbered actions, in the console's own words;
- values to paste, and documents to have ready;
- how long it takes, and any deadline;
- common questions, and the sources it's based on (with the date each was checked).

The rules:
- **When they finish a step:** `stack guide done <id>`. Steps with a check close themselves on `verify`.
- **When something goes wrong:** `stack guide stuck "<what happened>"`. Read the note and answer it.
- **Money comes last.** A paid step marked just-in-time (such as China's filing server) isn't offered until everything else its dependents need is done.
- **Advice:** steps marked ⚖ need a lawyer or adviser. Say so, and give the question to ask; never answer it as fact.
- **Stale sources:** if a step's sources were checked more than 90 days ago, re-read them before relying on the step.

## Places with their own rules (jurisdiction packs)

`jurisdiction: cn-mainland` in a stack file loads the China pack. It adds:
- **Up-front questions** (`stack guide ask`), answered once under `profile:`.
- **Warnings** for providers that don't serve mainland users: Google sign-in, Stripe, Vercel, Cloudflare, Resend, AWS.
- **The guided route:**
  - real-name checks;
  - the domain, and the filing server, bought just in time;
  - ICP filing with its 24-hour SMS;
  - app filing;
  - going live;
  - the police filing within 30 days;
  - SMS approval;
  - a privacy policy.

  Payments and data export show only when the answers need them.

Business registration isn't covered. Design: [`docs/stack-setup/china-mainland.md`](../../docs/stack-setup/china-mainland.md).

## Skills and tools a stack needs

`doctor` lists the agent skills and plugins that help with a stack's providers (for example CloudBase's toolkit for `tencent-cloudbase`, Cloudflare's for `cloudflare`), and whether each is installed. It also checks each pack's CLIs (`tccli` for China). Installing any of them is a download: ask first, and install in the app's own project, not globally, when it gives an agent account access.

## Use it in another project

The tool lives in this repo; each app keeps only its own `stack.yaml`.

1. Install the skill once per machine: `ln -s <this repo>/skills/stack-setup ~/.claude/skills/stack-setup`. Every Claude session in every project then has it.
2. In the app's repo, write `infra/stack/stack.yaml`. Start from [`docs/stack-setup/example.stack.yaml`](../../docs/stack-setup/example.stack.yaml) and pick a provider for each capability. A provider without an adapter is reported as skipped, not failed.
3. Run `connect`, then `import` (if things already exist), `verify` and `plan`. Commit `infra/stack/.stack/state.json`.
4. `apply --confirm` only after the owner has seen the plan.

Real IDs stay in the app's repo; this repo holds only the tool and synthetic examples.

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

- Writing to a password manager: 1Password, or a free option such as Bitwarden Secrets Manager, Infisical or OpenBao. That waits on the owner's choice.
- `stack init`, to scaffold a stack.yaml for a new app.
- A dry plan for a second, different app (M4).

See [`docs/stack-setup/DESIGN.md`](../../docs/stack-setup/DESIGN.md).
