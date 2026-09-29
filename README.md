# Loss of Support Form — Dr Pretorius Inc

A claimant intake form for a **loss of support claim**: the dependants of
someone killed in a road accident fill it in on a phone or a laptop, and it
arrives at the practice as a single PDF.

Built from the **Savage Jooste & Adams loss of support form**
(`../sja-loss-of-support`), which is its sibling and not its parent — separate
app, separate repository, separate Netlify site. Nothing here deploys over that
one, and a progress file from one is refused by name in the other.

**Deliberately carries no logo and no watermark**, the same as the practice's
**Accident Information Form** (`../Accident-Form-Dr_Pretorius`), whose deep-red
accent this build shares. Add branding later by following the pattern that was
removed: the SJA build's `pdf-builder.js` (`prepareAssets`, `renderWatermark`,
`paintWatermark`, the logo in `drawLetterhead` / `drawRunningHead`) and its
`styles.css` (`.logo`, `.watermark*`, the `--watermark-*` tokens) show the
shape.

**Console engine:** `dr-pretorius-loss-of-support`. Set the version on this
form in the IFTFC console to the ISO date of each deploy that changes
behaviour.

---

## How it is put together

| Path | What it is |
| --- | --- |
| `public/index.html` | The shell: header, sidebar, five screens, action bar |
| `public/styles.css` | The whole look. Design tokens at the top, components below |
| `public/app.js` | The twenty sections, the state machine, drafts, sending |
| `public/pdf-builder.js` | The PDF: letterhead, attachments, footers — no logo |
| `public/fonts/` | Barlow and Barlow Condensed, served from this site |
| `public/jspdf.umd.min.js` | jsPDF 2.5.1, vendored — no CDN |
| `netlify/functions/send-form.js` | The only server-side code |
| `netlify/functions/form-recipients.js` | The recipient menu, fetched at run time |
| `serve.py` | Local dev server. Not used in production |

There is no build step and no `package.json`. The files in `public/` are what
Netlify serves.

### Phone and laptop

One build, one stylesheet, one breakpoint at 900px.

- **Phone** — one section at a time, with a hub screen listing all twenty to
  move between them. Full-width controls at 46px or taller. The two buttons
  stack.
- **Laptop** — the section list becomes a permanent left sidebar with the
  current section marked, so there is no hub screen. Fields run two to a row;
  long answers, repeatable entries, documents, photographs, the sketch and the
  signature stay full width.
- Wording follows the device: tap or click, finger or trackpad.

Verified at 375px, 768px and desktop on 2026-09-22, on the SJA build this
was forked from. The layout code is unchanged here; only colour, wording and
the removal of the logo differ.

---

## The form

Twenty sections in six groups.

| # | Section | Group |
| --- | --- | --- |
| 01 | Your own details | About you |
| 02 | **Personal details of the deceased** | The deceased |
| 03 | **Personal details of the dependants** | The deceased |
| 04 | **How the deceased was involved** | The accident |
| 05 | Date and time of the accident | The accident |
| 06 | Location and conditions | The accident |
| 07 | How it happened | The accident |
| 08 | Other driver and vehicle | The accident |
| 09 | Police, case number and inquest | The accident |
| 10 | Witnesses | The accident |
| 11 | Education of the deceased | Support and loss |
| 12 | Employment and earnings of the deceased | Support and loss |
| 13 | The support the deceased provided | Support and loss |
| 14 | Medical treatment and cause of death | Support and loss |
| 15 | Funeral and related expenses | Support and loss |
| 16 | Insurance and other benefits | Support and loss |
| 17 | Supporting documents | Evidence |
| 18 | Photographs | Evidence |
| 19 | Sketch of the scene | Evidence |
| 20 | Signature and consent | Declaration |

The three in bold are the sections Richard specified for the sibling build.
**Every section here is inherited as-is and is awaiting the practice's own
list** — Richard has said he will work through which questions belong and which
do not. Changing them means editing `SECTIONS` in `app.js` and nothing else.

### Questions still to come from the practice

Section 04 asks whether the person was a **pedestrian or cyclist** or a
**driver or motorcyclist**, and branches. The branch is settled. The questions
*inside* each branch are marked `PROVISIONAL` in `app.js`. They sit in two
clearly-marked blocks; nothing else in the file refers to them.

### The form descriptor language

`SECTIONS` in `app.js` is the whole form. Each field carries a type:

| `t` | What it draws |
| --- | --- |
| `t` | one line of text |
| `a` | a long answer |
| `s` | a dropdown |
| `r` | one choice from a list |
| `c` | several choices from a list |
| `m` | repeatable entries — `f.sub` holds the fields inside one entry |
| `p` | the six photograph slots |
| `d` | a set of document slots — `f.set` names which set |
| `k` | the scene sketch |
| `g` | the signature |
| `h` | a heading part-way down a section |

Plus:

- **`showIf: [key, value]`** — the field appears only when that answer is
  given. `value` may be an **array**, so one field can be shown by any of
  several answers. A hidden field is never required, never counted as
  outstanding, and **never printed in the PDF**.
- **`reqIf: [key, value]`** — required only when that answer is given.
- **`alert:`** on a *section* — one line above the fields, drawn in capitals.
  Used on section 03.

#### Two things the descriptor language cannot do

Neither is broken today — every `showIf` key in `SECTIONS` is a radio — but
both would fail **silently** if that changed, so they are written down rather
than left to be rediscovered:

- **A text field cannot govern a `showIf`.** `renderSection()` hands the
  re-render callback to `selectControl` and `choiceControl` only, never to
  `textControl`. Fixing it would mean re-rendering the section on every
  keystroke, which costs the claimant their cursor position — so if a text
  field ever needs to govern, that needs designing, not patching.
- **A multi-choice (`t: 'c'`) field cannot govern either.** `choose()` returns
  early on the multi branch, before the callback.

In both cases `GOVERNS[key]` would be set and the callback would simply never
fire, so the dependent field would never appear and nothing would report an
error. Carl's F-5, 2026-09-22.

**Headings and alerts are stored in sentence case and capitalised by CSS.**
Typing them as capitals makes some screen readers spell them out letter by
letter. `text-transform` gives the reader words and
the claimant capitals. Do not "fix" this by capitalising the strings.

### Two document sets, not one

`DOC_SETS` holds two: `report` (the four pages of the accident report, shown
only when the claimant says they have it) and `certs` (six slots for the death
certificate, the deceased's ID, a marriage certificate, a birth certificate,
the funeral account, and one spare). Slot ids are unique across both because
they share one store.

`liveDocIds()` walks every `t: 'd'` field and excludes any whose `showIf` is
not satisfied. That is what stops the PDF saying "Have you obtained an accident
report? No" on one page and attaching the report on the next — a contradiction
in a legal file. A new document set inherits this automatically.

### What a saved draft keeps, and what it drops

Deliberately asymmetric, and worth knowing before it surprises you:

- **Hidden text answers are kept.** Answer the pedestrian branch, switch to
  driver, switch back — the pedestrian answers are still there. `saveDraft()`
  writes every `RESTORABLE` value whether or not it is currently visible, so a
  mis-tap never destroys half an hour of typing.
- **Hidden document uploads are dropped.** `saveDraft()` filters documents
  through `liveDocIds()`. Answer "No" to the accident-report question and the
  pages you attached are not written to the file, and do not come back if you
  change the answer to "Yes" again after reloading it. Within one session they
  do come back — they are only excluded at the boundaries that leave the page.

Each half is right on its own: keeping text preserves work, and dropping
documents avoids writing a death certificate the claimant has just said they
do not have. Together they are surprising, so they are written down rather
than reconciled — reconciling them would cost one or the other.

(Allison's A-8, 2026-09-22.)

### Caps

Repeatable entries are capped at **25** apiece. That is not a design opinion:
it is what stops a crafted progress file building a form with a million rows.
Text fields cap at 200 characters, long answers at 3000, and the finished PDF
at 4 MB.

---

## Where the answers live

**Nowhere but the claimant's own browser, until they press send.**

- No `localStorage`, no `sessionStorage`, no cookies, no IndexedDB.
- Reloading or closing the page clears everything. The page warns first.
- Save and resume is a JSON file the claimant downloads to their own device and
  loads back in later. It never touches a server.
- On send, the browser builds the PDF itself and posts only that finished
  document. The server never sees the answers as fields it could store.
- The function writes nothing to disk, to a database or to the log. The only
  copy of a submission is the email in the practice's inbox.

A saved progress file is treated as untrusted input. Only the known field keys
are restored, choices must be one of the options the form offers, images must
be real image data, and anything else in the file is discarded.

**A progress file from any other form cannot be loaded here**, and vice versa:
the `app` field is `dr-pretorius-loss-of-support` and a mismatch is refused by
name rather than half-restored into the wrong boxes. That covers the practice's
own accident form and both SJA forms.

---

## Setting it up on Netlify

1. Create a **new** site from **its own** Git repository. Netlify reads
   `netlify.toml`, so there is nothing to configure by hand.
2. Add the environment variables under **Site configuration → Environment
   variables**, with the scope set to include **Functions**:

   | Variable | Required | What it does |
   | --- | --- | --- |
   | `RESEND_API_KEY` | yes | The Resend API key |
   | `REPORT_TO_EMAIL` | yes | Where forms go. Comma-separate for several |
   | `RECIPIENT_DOMAINS` | strongly recommended | The domain floor — see below |
   | `REPORT_FROM_EMAIL` | **yes** | The sender. Must be on a domain verified in Resend — today that is `iftfc.co.za`. There is no fallback: the function refuses to start without it, on purpose (see below) |
   | `IFTFC_CONSOLE_URL` | no | The master console, if it is being used |
   | `IFTFC_CONFIG_KEY` | no | The console's `config:read` key |
   | `IFTFC_EVENT_KEY` | no | The console's `event:write` key |
   | `IFTFC_FORM_SLUG` | no | Defaults to `dr-pretorius-loss-of-support` |

3. Redeploy. **Netlify environment variables only take effect on a rebuild** —
   saving them in the dashboard changes nothing until the site builds again. If
   the live endpoint keeps returning an old value, force a build with
   `git commit --allow-empty -m "rebuild"` before concluding the value is
   wrong.

**Suggested values for this site**, matching the practice's accident form:

| Variable | Value |
| --- | --- |
| `REPORT_TO_EMAIL` | `richard@iftfc.co.za,richardh@drpretoriusinc.co.za,admin@drpretoriusinc.co.za` |
| `RECIPIENT_DOMAINS` | `iftfc.co.za,drpretoriusinc.co.za` |
| `REPORT_FROM_EMAIL` | an address on `iftfc.co.za` — the only domain verified in Resend |

**`RECIPIENT_DOMAINS` must never contain `iftfc.com`.** That was the sender
domain, it has been retired, and putting a sender domain on the floor is what
lets the sender address through as a recipient.

**`REPORT_TO_EMAIL` is a list, and the function sends to the one address the
claimant picked from it.** It is an allowlist, not a distribution list. With
**exactly one** entry, `openRecipientDialog()` skips the picker and submits
straight away — so "it did not ask me who to send to" is a symptom of a
one-entry allowlist, not a broken dialog.

**Set `RECIPIENT_DOMAINS`.** It is the floor the function enforces itself, and
the reason recipients held in the console's database are acceptable at all: the
worst a compromised console can do is move a form from one mailbox at the
practice to another at the same practice.

### After every deploy, check the form can actually send

A deploy can succeed, serve the form perfectly, pass every security header —
and still be unable to deliver a single submission, because the environment
variables are not set. The claimant finds out after filling in twenty sections.

One command tells you:

```bash
curl -s https://<this-site>/api/form-recipients
```

**Read the `diagnostic` field, not the array length.** If `diagnostic` is
absent, the form can send. If it is present, it names the environment variable
at fault in plain words — it never prints a value.

```json
{"recipients":[],"paused":false,"source":"env",
 "diagnostic":["REPORT_TO_EMAIL is set and its addresses are valid, but
   RECIPIENT_DOMAINS excluded every one of them. …"]}
```

**A non-empty `recipients` array does NOT on its own mean the form can send.**
That endpoint never touches `RESEND_API_KEY`, so a site can show a perfect
recipient list and still fail every submission. That is why the diagnostic
reports a missing key separately, even when the list is full.

The three faults it tells apart, because they need different fixes:

| What you see | What to change |
| --- | --- |
| `REPORT_TO_EMAIL is not set` | Add it |
| `nothing in it parsed as an email address` | Commas only — no quotation marks, semicolons or line breaks |
| `RECIPIENT_DOMAINS excluded every one of them` | Set it to the domains **you send to**, not the practice's |
| `RESEND_API_KEY is not set` | Add it; the list is already fine |

(Inherited from the SJA build, where Allison's A-0 on 2026-09-22 was exactly
what the first deploy did, and the diagnostic was added on 2026-09-25 after the
*second* deploy did it again for a different reason.)

**Do not drag-and-drop deploy this site.** A drag-and-drop deploy skips
Netlify's bundler, and the functions are then listed but return 404 for every
request. Push to Git instead.

If the function returns 500, open its log. It names the variable it could not
see, and never logs the value.

---

## The demo generator

`SHOW_DEMO_BUTTON` is **`true`**, so the "Generate Example Report" tab appears
on the deployed site, and the passcode `2190` is readable in the page source.
This matches the practice's accident form and is deliberate, so the practice
can be shown a filled form from the real URL. **It must go back to
`'localhost'` before a real claimant gets the link.**

State the cost plainly rather than pretending it is not there:

- anyone who reads the page source has the passcode, and can post a fabricated
  intake form to the practice — rate-limited to 10 per IP per hour, and only
  ever to an allowlisted address;
- the docked button lies across the right-hand edge where the Remove buttons of
  a repeatable entry sit, which is why `body.has-demo` moves phone content 34px
  clear of it.

Setting `SHOW_DEMO_BUTTON` to `'localhost'` removes both. One line.

---

## Running it locally

```
python3 serve.py
```

Then open the address it prints. The dev server sends the same security headers
as production, so the app is always tested under the real Content Security
Policy, and it stands in for the Netlify functions so the send path can be
exercised without the Netlify CLI. It never sends real email and never writes a
submission down.

| Variable | Effect |
| --- | --- |
| `PORT` | Defaults to 8758, so this can run alongside the sibling forms |
| `DEV_SEND_MODE` | `ok` (default), `reject`, `down` |
| `DEV_PAUSED=1` | Exercises the paused-form branch |
| `DEV_RECIPIENTS` | Overrides the recipient menu |
| `DEV_SAVE_PDF=1` | Writes the generated PDF next to this file, so the layout can be checked by eye. Local only — the real function has no equivalent |

---

## Still outstanding

These are not code, and none of them can be guessed.

1. **The `[SQUARE BRACKET]` placeholders in `privacy.html` and `terms.html`** —
   the practice's registered name, physical address, telephone number, POPIA
   Information Officer and file-retention period. A live form collecting
   identity numbers and cause-of-death data must not carry placeholders, and
   the pages currently show their own "before this page goes live" warning box
   under the practice's name. Same item is open on the practice's accident form
   and on both SJA forms.
2. **The questions themselves** — every section is inherited from the SJA build
   and awaits the practice's own list. Richard has said he will work through
   this.
3. **The two branch question sets in section 04**, marked `PROVISIONAL`.
4. **Confirm the POPIA paragraph in privacy.html section 2A** — the one saying
   the Act protects the information of a *living* person, so the deceased's
   details fall outside it. That is what the Act says; whether the practice
   wants to say it is the practice's call.
5. **No domain verified in Resend for the practice**, so mail sends from an
   `iftfc.co.za` address rather than from `drpretoriusinc.co.za`.
6. **Register the engine in the IFTFC console** —
   `dr-pretorius-loss-of-support`, version = the deploy date.

---

## What differs from the SJA loss of support build

Everything below is the complete list; the form logic, the sections, the PDF
layout and the security posture are otherwise byte-for-byte the same code.

| Area | Change |
| --- | --- |
| Accent | Steel blue `#1B5397` → deep red `#971B30`, the full ramp, matching the practice's accident form |
| Logo | `sja-logo.jpg` deleted; the header `<img class="logo">`, the review-screen watermark and the PDF's logo and watermark all removed |
| Icons | The red crosshair `favicon.svg` / `favicon-32.png` / `apple-touch-icon.png` from the practice's accident form |
| Wording | "the firm" / "your attorney" → "the practice" / "Dr Pretorius Inc"; a doctor–patient disclaimer rather than an attorney–client one; kicker "Client intake" → "Claimant intake" |
| Purpose | "assess and administer a claim" → "prepare a report in connection with a claim" throughout, including the PDF declaration and both legal pages |
| PDF global | `window.SJALossOfSupportPDF` → `window.DrPretoriusLossOfSupportPDF` |
| Draft identity | `DRAFT_APP_ID` `dr-pretorius-loss-of-support`, file `DrPretorius-loss-of-support-progress.json` |
| Footer | `Dr Pretorius Inc · Confidential · Contains medical information` |
| `IFTFC_FORM_SLUG` | Default is now the **same literal in all three places it is read**. On the SJA build `form-recipients.js` still says `loss-of-support` while `send-form.js` says `loss-of-support-form` — worth fixing there |
| `serve.py` | `DEV_SAVE_PDF` writes next to the script instead of reaching back out and into a hard-coded folder name; default port 8758 |
