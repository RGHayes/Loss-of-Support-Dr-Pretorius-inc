# What `.claude/settings.json` actually protects — and what it does not

Raised as `CARL-eco-007`: every dangerous-operation rule in this repo lived in
prose, in `CLAUDE.md`. Prose is a soft control. An agent may not follow it under a
confusing or adversarial prompt — **including one embedded in a file the agent
reads as part of its work**, which is the case prose is weakest against, because
the agent is reading the injected instruction in the same voice as the real one.

`.claude/settings.json` moves the rules that *can* be mechanical into the
permissions layer, where refusal does not depend on the agent's judgement.

## Covered, mechanically

| Denied | Why |
|---|---|
| `Read`/`Edit`/`Write` of `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `.netrc`, `.npmrc`, `credentials` | The secret-value rule in `CLAUDE.md`, made unbypassable for the file tools |
| `rm -rf`, `rm -fr`, `sudo` | Irreversible, and never needed for this work |
| `git push --force`, `-f`, `--force-with-lease`, `filter-branch`, `reflog delete`, `update-ref -d` | Rewriting published history destroys the audit trail the Defect Ledger depends on |
| `curl … \| sh`, `wget … \| bash` | Executing a downloaded script |
| `npx` | Fetches and runs an unpinned package. See `VENDORED.md` — third-party code is pinned here, deliberately |

And **asked** rather than denied, because each is legitimate sometimes:
`git push`, `git reset --hard`, `git clean -fd`, `git checkout --`.

## NOT covered — read this part

**1. `Bash(...)` matching is a speed bump, not a wall.** It matches the command
string. `rm -rf x` is refused; a `rm` reached through a variable, an alias, a
shell function, `find -exec`, or a Python one-liner is not. The real protection
for secrets is that `Read`, `Edit` and `Write` are denied outright — those are
path-matched, not string-matched. Do not read this file and conclude the shell is
sandboxed. It is not.

**2. Deploying is deliberately NOT denied.** `CLAUDE.md` says never deploy without
being asked, and that rule stays prose on purpose: Richard *does* ask, often, and
a hard denial would block the work he asked for while he is away from the
keyboard. A permission prompt cannot tell an authorised deploy from an
unauthorised one. What guards deploys is the prose rule plus the pre-deploy guards
in `tools/`.

**3. "Never add persistence" is not expressible here.** No permission pattern can
see a `localStorage` call. That rule is enforced by `tools/prelaunch-guard.py`
and by reading.

## If a denial gets in the way

Do not delete an entry to get past it. Either the operation is genuinely needed —
in which case say so to Richard and let him decide — or the denial is doing its
job. A deny list that gets edited whenever it fires is decoration.
