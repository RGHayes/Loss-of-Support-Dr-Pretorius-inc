# Loss of Support Form — Dr Pretorius Inc — repo guide for Claude Code

A single claimant intake form. The claimant fills it in, the browser builds a
PDF, and only that finished document is sent. **Nothing is stored on this
website** — not in cookies, not in localStorage, not on the server. The published
privacy notice says exactly that, so anything that stores an answer makes a legal
statement untrue.

**CARL-eco-006.** These rules were checked against the code on 30 September 2026
and were all true when written. If one becomes false, fix the code or fix the
rule — a rule that quietly stops being true is worse than no rule, because it
tells the next reader not to look.

## Hard rules

- **Never deploy without being asked.** Deploying is Richard's decision.
- **Never add persistence.** No `localStorage`, `sessionStorage`, cookies or
  IndexedDB. "Save progress" downloads a file to the claimant's own device and
  sends it nowhere.
- **`RECIPIENT_DOMAINS` is required, not optional.** It is the floor this site
  enforces itself: the only domains a completed form may ever reach, and the one
  control the console **cannot** widen. With it unset there is no floor at all.
  A compromised console must never be able to deliver Dr Pretorius Inc's claimant
  documents anywhere but Dr Pretorius Inc.
- **No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `eval`.** Verified: zero
  occurrences in this repo's own code today — the only mention is the rule itself.
  Everything is a real node with `textContent`.
- **Never print a secret value.** Never read or display `.env*`, `*.pem`, `*.key`.
  `RESEND_API_KEY`, `IFTFC_CONFIG_KEY` and `IFTFC_EVENT_KEY` are never logged,
  never echoed in an error, and never sent to the browser.
- **`REPORT_FROM_EMAIL` has no fallback**, deliberately. An unverified sender
  makes Resend 403 every send silently, so the function refuses to start instead.

## The send path — the part to be careful with

`netlify/functions/send-form.js` carries a real claimant's document. It cannot be
exercised locally: `serve.py` only *stands in* for these functions. So a change
here is verified by reading, by a deliberate live test to Richard's own address,
or not at all — never by assuming.

- The console may **tighten** this form's limits and may never loosen them. The
  size cap is `Math.min(built-in, console value)`; the rate limit is checked
  before any network call and is deliberately not read from the console at all.
- `isTest` travels from the demo path so a client's trial run does not land in
  their own delivery figures, and the subject line carries `[TEST]`.
- A `Content-Type` that is not `application/json` is refused; an `Origin` that is
  present and foreign is refused; an **absent** Origin stays allowed, because a
  legitimate non-browser caller sends none.

## The PDF

`pdf-builder.js` embeds DejaVu Sans **only when an answer needs it**, so a
claimant named Łukasz can submit — before that, the guard blocked them entirely.
Two things the browser taught us and reading did not:

- `addFileToVFS` on `jsPDF.API` throws; it must be called on the **document**.
- Registration does **not** carry from one document to the next — a second
  document asked for `DejaVuSans` silently rendered in `times`, with no error.

So registration happens per document inside `build()`, followed by a check that
throws if it did not take, and a last line that refuses rather than render a name
in the wrong font. `COVERAGE` was extracted from the font file, not from its
documentation. See `VENDORED.md` for the pinned jsPDF version and why it is
pinned.

## The lesson these four repos keep re-learning

**These apps share paragraphs, guards and bugs.** A correction applied to one and
not its siblings has cost this project repeatedly — a statutory citation fixed in
one app and left wrong in another for a week; a character guard fixed in one and
missed in a second; a slug default that pointed at a different client's form.

**Grep all four repos for the literal before you fix the instance in front of
you.** One wrong string was found three separate times in three separate passes.

## Layout

| Path | What it is |
|---|---|
| `public/app.js` | The whole form: `SECTIONS[n].f` holds the fields (`f`, not `fields`) |
| `public/pdf-builder.js` | Builds the PDF. `window.DrPretoriusLossOfSupportPDF` |
| `public/styles.css` | `font-size` is in `rem` so text scales with the reader's setting |
| `netlify/functions/send-form.js` | The send path. Read the section above first |
| `netlify/functions/form-recipients.js` | Recipient menu, rate-limited, console-backed |
| `VENDORED.md` | Pinned third-party versions and the advisory against them |
