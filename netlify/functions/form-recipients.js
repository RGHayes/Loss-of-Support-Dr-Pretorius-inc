/**
 * The menu of recipients the page offers, fetched at run time.
 *
 * Without this, adding a recipient in the IFTFC console would change what the
 * server accepts but not what the page offers — the new address would exist
 * and never be shown, which is the "change it in both places" trap the README
 * warns about, only moved somewhere harder to see.
 *
 * WHAT THIS IS NOT
 * It is only a menu. send-form.js holds the real allowlist and refuses any
 * address not on it, so a tampered page achieves nothing. This endpoint
 * exposes no key, writes nothing, and returns nothing about any submission.
 *
 * WHY IT DUPLICATES A LITTLE OF send-form.js
 * Sharing a module between Netlify functions needs the bundler, and this site
 * is deliberately deployable without one. Thirty lines repeated is the price
 * of that, and both copies fail the same safe way: to REPORT_TO_EMAIL.
 *
 * Environment variables: the same ones send-form.js uses.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
/* Q-S1, Richard's decision 29 September 2026. Was 2500ms. Measured that day:
   the console's /api/form-config answers in 1.0-1.6s warm on the unauthenticated
   path - and that path is refused BEFORE the database query an authorised call
   performs, so the real figure is higher. Under a second of headroom, and two
   real fail-opens were observed on two different hosts (CARL-console-022).
   On timeout this falls back to the form's OWN settings, silently, while the
   console still shows the form as governed. 6000ms buys a cold start on either
   side. The cost is borne only when the console is genuinely slow or down, and
   the config cache means it is not paid per submission. */
const TIMEOUT_MS = 6000;
const CACHE_MS = 60 * 1000;

let cache = null;

/* LAST KNOWN-GOOD SETTINGS — CARL-eco-003 / Laura R-1.
   `cache` above is consulted only BEFORE the console fetch, never after one
   fails, so every failure path fell back to `base` — whose `paused` is
   hard-coded false. The recipient allowlist never failed open (the domain
   floor holds it), but the PAUSED FLAG did: an unreachable console silently
   un-paused the form, which is the one thing the console can actually enforce.
   lastGood keeps the newest console answer with no expiry. Per-instance only
   (Netlify functions are stateless and a cold start begins empty), so this is
   a floor on the failure rather than a guarantee. */
let lastGood = null;

/* CARL-eco-018. The replay must not claim to BE the console.
   lastGood holds the console's own success object, whose `source` is the
   literal string "console". Replaying it verbatim on a failure path made a
   console outage — or a revoked config key — indistinguishable from a healthy
   integration: the scheduled health probe reads exactly this field, mapped
   "console" to configOk true, and recorded outcome `ok`. That also re-armed
   the console's Pause assurance during precisely the failure this replay
   exists to survive. So the replay declares itself: `stale-console`, plus an
   explicit stale flag. The recipients and the paused floor are unchanged —
   only the provenance is now honest. */
function replay(v) {
  return Object.assign({}, v, { source: 'stale-console', stale: true });
}

const parseList = (v) => String(v || '')
  .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    /* CARL-drplos-013. The site's X-Robots-Tag comes from _headers and
       netlify.toml, and NEITHER reaches a function response — same gap as
       CARL-console-013. So the page was noindex while THIS endpoint, which
       returns a named intake map of a law firm or a medical practice, was
       served with no directive at all and was crawlable. Set it here, on the
       response itself, because that is the only place that works. */
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  },
  body: JSON.stringify(body),
});

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
    ]);
  } finally { clearTimeout(timer); }
}

/* A readable label for an address that came from the environment variable
   rather than the console, so the dialog never shows a bare email. */
function labelFor(address) {
  const local = String(address).split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : address;
}

/* ---- Why is the menu empty? -------------------------------------------------
   An empty `recipients` array has several causes that look identical from
   outside, and each needs a different fix. Without this, finding out which one
   it is means reading a Netlify function log — so in practice it means
   guessing, changing a variable, redeploying, and looking again.

   WHAT THIS MAY AND MAY NOT SAY. Names of environment variables, never their
   contents: no address, no domain, no count of either, and nothing about the
   API key beyond whether one is present. A healthy site gets NO diagnostic
   field at all, so this adds nothing to a working deployment — it only speaks
   when the form is already broken, which is already visible from the empty
   array and from the 500 that send-form returns.

   Reviewed by Carl 2026-09-25: safe to expose. The recipient allowlist and the
   domain floor are both enforced server-side in send-form.js and neither is
   reachable or changeable by a caller, so knowing a floor exists buys an
   attacker nothing. This must NOT be copied into send-form.js's error body —
   that reply goes to a claimant mid-submission and stays plain. */
function diagnose(rawTo, parsedCount, afterFloorCount, floorCount) {
  const problems = [];

  if (afterFloorCount === 0) {
    if (!String(rawTo || '').trim()) {
      problems.push('REPORT_TO_EMAIL is not set on this site.');
    } else if (parsedCount === 0) {
      problems.push('REPORT_TO_EMAIL is set, but nothing in it parsed as an '
        + 'email address. It must be comma-separated, with no quotation marks, '
        + 'no semicolons and no line breaks.');
    } else if (floorCount > 0) {
      problems.push('REPORT_TO_EMAIL is set and its addresses are valid, but '
        + 'RECIPIENT_DOMAINS excluded every one of them. RECIPIENT_DOMAINS must '
        + 'list the domains of the addresses you actually send to — the part '
        + 'after the @ — not the client practice\u2019s domain.');
    } else {
      problems.push('REPORT_TO_EMAIL produced no usable address.');
    }
  }

  /* The floor removed SOME addresses but not all, so the menu still looks
     healthy and nothing anywhere says an address went missing. That is the
     failure this project's README warns about — "looks like nothing at all"
     — and it is how a wrong RECIPIENT_DOMAINS hides its own effect: you set
     three recipients, you see two, and there is no reason given.

     No count and no domain, only that it happened. If the floor is correctly
     narrower than REPORT_TO_EMAIL by design, this is still worth saying: an
     address in REPORT_TO_EMAIL that the floor rejects should come out of
     REPORT_TO_EMAIL. */
  if (afterFloorCount > 0 && afterFloorCount < parsedCount) {
    problems.push('The form can send, but RECIPIENT_DOMAINS excluded at least '
      + 'one address in REPORT_TO_EMAIL. If you expected more recipients in '
      + 'this menu than you can see, that is why.');
  }

  /* A populated menu does NOT mean the form can send. This endpoint never
     touches RESEND_API_KEY, so without this check a site can show a perfect
     recipient list and still fail every submission. */
  if (!process.env.RESEND_API_KEY) {
    problems.push('RESEND_API_KEY is not set, so nothing can be delivered even '
      + 'once the recipient list is correct.');
  }

  return problems.length ? problems : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed.' });

  const floor = parseList(process.env.RECIPIENT_DOMAINS);
  const applyFloor = (list) => (floor.length
    ? list.filter((r) => floor.indexOf(String(r.email).split('@')[1] || '') !== -1)
    : list);

  const parsed = parseList(process.env.REPORT_TO_EMAIL)
    .filter((a) => EMAIL_RE.test(a))
    .map((a) => ({ label: labelFor(a), email: a }));
  const fallback = applyFloor(parsed);

  const base = { recipients: fallback, paused: false, pausedMessage: '', source: 'env' };

  const problems = diagnose(
    process.env.REPORT_TO_EMAIL, parsed.length, fallback.length, floor.length);
  if (problems) base.diagnostic = problems;

  const consoleUrl = String(process.env.IFTFC_CONSOLE_URL || '').replace(/\/+$/, '');
  const configKey = process.env.IFTFC_CONFIG_KEY;
  if (!consoleUrl || !configKey) return reply(200, base);

  if (cache && Date.now() - cache.at < CACHE_MS) return reply(200, cache.value);

  try {
    /* Must be the same literal as the two in send-form.js — see the note at
       reportEvent() there for what drifting them apart costs. */
    const slug = String(process.env.IFTFC_FORM_SLUG || 'loss-of-support');
    const res = await withTimeout(fetch(
      consoleUrl + '/api/form-config?form=' + encodeURIComponent(slug),
      { headers: { Authorization: 'Bearer ' + configKey, Accept: 'application/json' } }
    ), TIMEOUT_MS);

    if (!res.ok) {
      console.error('form-recipients: console refused, status=%d — using %s', res.status, lastGood ? 'the console\'s last known-good list (STALE)' : 'REPORT_TO_EMAIL');
      return reply(200, lastGood ? replay(lastGood) : base);
    }

    const body = await res.json();
    const list = Array.isArray(body && body.recipients) ? body.recipients : null;
    if (!list) return reply(200, lastGood ? replay(lastGood) : base);

    const recipients = applyFloor(
      list
        .map((r) => ({
          /* Constrained to a role-label shape at the console, checked again
             here: a label is drawn into the page, so it must never be able to
             carry a claimant's name or a file reference. */
          label: String((r && r.label) || '').replace(/[^A-Za-z0-9 .'&-]/g, '').slice(0, 40),
          email: String((r && r.email) || '').trim().toLowerCase()
        }))
        .filter((r) => r.label && EMAIL_RE.test(r.email))
    );

    /* An empty list is a fault, not an instruction. Keep offering the
       environment variable's addresses rather than showing a claimant an
       empty dialog. */
    if (!recipients.length) return reply(200, lastGood ? replay(lastGood) : base);

    const value = {
      recipients: recipients,
      paused: !!(body.form && body.form.status === 'paused'),
      pausedMessage: (body.form && String(body.form.pausedMessage || '').slice(0, 600)) || '',
      source: 'console'
    };
    /* The console can supply recipients; it cannot supply the API key. A
       console-sourced menu with no RESEND_API_KEY still sends nothing, so the
       check has to sit on this path too — not only on the env fallback. */
    if (!process.env.RESEND_API_KEY) {
      value.diagnostic = ['RESEND_API_KEY is not set, so nothing can be '
        + 'delivered even though the recipient list is correct.'];
    }
    cache = { at: Date.now(), value: value };
    lastGood = value;
    return reply(200, value);
  } catch (err) {
    console.error('form-recipients: console unreachable (%s) — using %s',
      (err && err.message) || 'unknown',
      lastGood ? 'the console\'s last known-good list (STALE)' : 'REPORT_TO_EMAIL');
    return reply(200, lastGood ? replay(lastGood) : base);
  }
};
