# Guided setup: one step at a time, nothing to search for

Status: design for owner approval, 10 Nov 2026. It builds on the gate ledger in [DESIGN.md](DESIGN.md) and applies to every stack, not only China.

## The problem

Some setup can't be done by an agent. A person has to sign in, pay, show their face to a camera, answer an SMS within 24 hours, or wait 20 working days for a regulator. Today stack-setup lists those steps as gates. That's enough for a handful of console clicks. It isn't enough for long flows such as China's ICP filing, where the person would otherwise:
- search for what to do next;
- guess which documents to prepare;
- miss deadlines;
- ask at every step.

The goal: the owner answers a few questions once. After that they're told exactly one thing to do at a time, with everything they need on the same screen. The agent does everything else and keeps track.

## What a guided step contains

Each gate gains these optional fields. Adapters and **compliance packs** fill them in, so the owner never has to:

| Field | Meaning | Example (ICP filing) |
|---|---|---|
| `who` | The person who has to do it | the filing subject (`主体负责人`) and the site's responsible person (`网站负责人`) |
| `where` | The exact place to do it | the Tencent Cloud ICP console, or the 腾讯云助手 mini program for the face check |
| `steps` | Numbered actions, in the console's own words and language | "备案 → 首次备案 → 选择主体类型 …" |
| `prefill` | Every value worked out in advance, ready to copy | site name, service description, the resource's 备案授权码 |
| `documents` | What to have ready, with format rules | ID photo (colour, both sides), signed 承诺书, business licence scan |
| `after` | Gates that must be done first | `domain.realname`, `host.purchased` |
| `takes` | How long it usually takes, and who is waiting | "1–2 working days, Tencent reviews; they may phone you" |
| `deadline` | A clock that starts when something happens | "within 24 hours of the MIIT SMS"; "within 30 days of the site going live" |
| `faq` | The questions people usually ask at this step, answered | "Can the site name be in English? No: it must be Chinese and describe the site." |
| `probe` | How the agent knows it's done without asking | the DNS answer changes; the Tencent filing status reads 已备案 |
| `sources` | Official pages the step is based on, each with the date it was last checked | links to Tencent and MIIT docs |

`doctor` warns when a step's `sources` were last checked more than 90 days ago. Regulations change, so a stale step is re-read before anyone relies on it.

## The commands

```text
stack guide                 the next thing to do, and only that, with everything on one screen
stack guide all             the whole route as a timeline: tracks, waits, deadlines, critical path
stack guide done [--note]   say the current step is finished (probes close their own steps)
stack guide stuck "<what>"  record what went wrong; the agent reads it and answers
stack guide ask             the up-front questions again, to change an answer
```

`guide` is read-only apart from recording progress in `.stack/state.json`. Real changes still go through `plan` → `apply --confirm`.

### 1. Questions once, up front

A compliance pack starts with a short interview. The answers go into the stack file's `profile:` and prune the route, so the owner never sees steps that don't apply to them. For China:

1. Who files: a mainland company, a person with a mainland ID card, or a foreigner with a passport? (The last depends on the province.)
2. Will the service take payments or sell anything online? If so, a commercial licence (B25) may be needed as well as a filing.
3. Which forms: a website, a WeChat mini program, an app?
4. Will users' data leave mainland China? For example, a backend overseas.
5. Will children use it? Under PIPL, children's data (under 14) is sensitive and needs a parent's consent.

### 2. One screen per step

```text
Step 4 of 11 · ICP filing · you (the 主体负责人) · about 20 minutes

Submit the filing in the Tencent Cloud console
  1. Open https://console.cloud.tencent.com/beian → 首次备案
  2. Choose 主体类型: 个人 · 省份: 广东 (pre-filled from your answers)
  3. Paste these values:
       网站名称      童趣足迹活动预约        (the name must describe the site; no brand-only names)
       网站域名      example.cn
       备案授权码    (your server's code, filled in once the server is bought)
  4. Upload the documents (all ready? ✓ ID front ✓ ID back ✓ 承诺书 signed)

What happens next: Tencent checks it within 1–2 working days and may phone you.
Then step 5, the face check, arrives on your phone.

Common questions
  · "备案号 shows as 待审核": normal, nothing to do.
  · "Rejected for the site name": use the suggested name above, or ask: stack guide stuck "site name rejected"
```

### 3. The whole route, as a timeline

`stack guide all` shows:
- **parallel tracks:** for example, the domain transfer can run while the account's real-name check is pending;
- **the critical path;**
- **dated deadlines,** computed once a clock starts.

Waiting steps show who they're waiting on: the provider, a regulator, or the owner.

### 4. Deadlines that come to you

Clocks such as the 24-hour SMS reply or the 30-day police filing become `doctor` deadlines. With the owner's agreement, a scheduled task runs `stack guide` daily while any clock is running. It messages only when a step becomes the owner's to do, or a deadline is under 48 hours away.

## What the agent does, and never does

- **Does:**
  - works out every value;
  - checks documents' format before the owner uploads them (size, colour, both sides, in date);
  - buys nothing without a confirmed price (`--accept-cost`);
  - changes code and DNS when a step needs it, such as putting the filing number in the site footer;
  - verifies each step with a probe.
- **Never does:**
  - face checks or SMS replies;
  - legal declarations, or terms accepted on the owner's behalf;
  - payments without confirmation;
  - solving a CAPTCHA (where a probe would need one, the step is checked by the owner instead).
- **Legal questions** are flagged, never answered as fact. A step that depends on law (a commercial licence, data export, children's data, MLPS grading) carries `needs: lawyer` and the exact question to ask one.

## Milestones (to approve)

1. **G1: `guide` for the existing stacks.** Add the new gate fields, `guide` / `guide all` / `done` / `stuck`, and the source-age check in `doctor`. Fill them in for the gates that already exist: Google publishing, Stripe live, Apple enrolment, AWS root MFA. Done when WiggleTrail's open steps read as one guided route.
2. **G2: the China compliance pack**, described in [china-mainland.md](china-mainland.md). The interview, ICP filing, police filing, app or mini-program filing, and the payment, sign-in and SMS qualification steps, each with its sources.
3. **G3: reminders** through a scheduled task, for clocks that are running.
