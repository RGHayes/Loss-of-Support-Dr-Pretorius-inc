/**
 * Emails a completed Loss of Support Form as a PDF attachment.
 *
 * Written in Netlify's classic CommonJS handler format on purpose: it needs no
 * bundling step, so it works on a plain drag-and-drop deploy as well as a Git
 * deploy. (The newer `export default` format only becomes invocable once
 * Netlify's bundler has run — a drag-and-drop deploy lists the function but
 * every request to it returns 404.)
 *
 * The page offers a choice of recipient, but the choice is only ever a menu:
 * this function checks the requested address against an allowlist and refuses
 * anything not on it, so the endpoint cannot be turned into a mailer for other
 * people no matter what the browser sends.
 *
 * Nothing is written to disk, to a database or to the log. The only trace a
 * submission leaves is the email itself, in the practice's inbox.
 *
 * ── WHERE THE ALLOWLIST COMES FROM ────────────────────────────────────────
 * Two sources, and the safe one always wins.
 *
 *   1. The IFTFC console, if IFTFC_CONSOLE_URL and IFTFC_CONFIG_KEY are set.
 *      Lets a recipient be added or removed, or the form paused, without a
 *      code deploy.
 *   2. REPORT_TO_EMAIL, this site's own environment variable. Used when the
 *      console is not configured, is unreachable, is slow, or answers with
 *      anything this function does not fully understand.
 *
 * The console can never make this function do something it could not already
 * do. It chooses among addresses; it cannot invent one. That is enforced by
 * RECIPIENT_DOMAINS below, which the console cannot write to.
 *
 * ── THE DOMAIN FLOOR ──────────────────────────────────────────────────────
 * RECIPIENT_DOMAINS is the control that makes holding recipients in a database
 * acceptable at all. Every address, wherever it came from, must be on one of
 * those domains or it is refused here. Set it in Netlify, which the console
 * has no access to. The worst a compromised console can then do is move a
 * form from one mailbox at the practice to another at the same practice — not
 * redirect a claimant's privileged file to a stranger.
 *
 * Environment variables (Netlify → Site configuration → Environment variables,
 * with the scope set to include Functions):
 *   RESEND_API_KEY      required — the Resend API key
 *   REPORT_TO_EMAIL     required — fallback allowlist, comma separated
 *   RECIPIENT_DOMAINS   optional NOW, and the floor is not. If unset, a
 *                       built-in floor of drpretoriusinc.co.za and
 *                       iftfc.co.za applies instead - see DEFAULT_DOMAINS
 *                       below. Setting this REPLACES that list. There is
 *                       no configuration in which there is no floor, which
 *                       is what every document here already claimed and
 *                       the code did not do (CARL-eco-006).
 *   REPORT_FROM_EMAIL   REQUIRED. There is no fallback and this function
 *                       refuses to start without it - see the check on
 *                       fromAddress below. It must be on a domain verified
 *                       in Resend, or Resend answers 403 on every send with
 *                       no bounce to see, which is why an unverified default
 *                       is worse than no default. This line said 'optional'
 *                       until 30 September 2026, contradicting both the code
 *                       ten lines of CLAUDE.md, and the three READMEs that
 *                       said the same thing were corrected the same day while
 *                       this one was missed.
 *   IFTFC_CONSOLE_URL   optional — e.g. https://iftfc-console.netlify.app
 *   IFTFC_CONFIG_KEY    optional — the console's config:read key
 *   IFTFC_EVENT_KEY     optional — the console's event:write key
 *   IFTFC_FORM_SLUG     optional — defaults to "loss-of-support".
 *                                 The same literal in all three places it is
 *                                 read (here twice, and in
 *                                 form-recipients.js) — see the note at
 *                                 reportEvent().
 *
 * With none of the IFTFC_* variables set, this function behaves exactly as it
 * did before the console existed.
 */

/* Netlify runs synchronous functions with a 6 MB request limit, and base64
   inflates the PDF by a third. These caps sit under that with room to spare;
   the browser refuses to send anything larger before it gets here. */
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 5_600_000;
const MAX_FIELD_LEN = 4000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/* The console must never be able to hold up a claimant. If it has not answered
   in this long, it is ignored and the environment variable is used instead. */
/* Q-S1, Richard's decision 29 September 2026. Was 2500ms. Measured that day:
   the console's /api/form-config answers in 1.0-1.6s warm on the unauthenticated
   path - and that path is refused BEFORE the database query an authorised call
   performs, so the real figure is higher. Under a second of headroom, and two
   real fail-opens were observed on two different hosts (CARL-console-022).
   On timeout this falls back to the form's OWN settings, silently, while the
   console still shows the form as governed. 6000ms buys a cold start on either
   side. The cost is borne only when the console is genuinely slow or down, and
   the config cache means it is not paid per submission. */
const CONFIG_TIMEOUT_MS = 6000;
const CONFIG_CACHE_MS = 60 * 1000;
/* 1500 ms, and it stays there. On 2026-09-26 this was briefly raised to 5000
   because five curl round trips to the console measured 1.6-2.0s. That
   measurement was wrong for this caller: it was taken from a laptop in South
   Africa and included the local network leg, which a Netlify function calling
   another Netlify function does not pay. Checked against the database
   afterwards, every single event had recorded at 1500 ms — five out of five,
   nothing dropped. Raising it only made a claimant wait longer whenever the
   console is slow or down, for no benefit. Leave it unless real dropped events
   show up in the log, which now says so by name when they do. */
const EVENT_TIMEOUT_MS = 1500;

/* ---- Best-effort abuse throttle -------------------------------------------
   Netlify keeps a warm container between invocations, so this state survives
   across requests that reach the same instance. It is deliberately
   dependency-free so the function still deploys without a bundling step.

   Stated plainly: the state is per-instance, so it resets on a cold start and
   is not shared between concurrent instances. It stops casual flooding and
   caps how much of the email quota an attacker can burn. It is not a hard
   guarantee. A durable limiter needs @netlify/blobs, which requires a bundled
   deploy. */
const RATE_WINDOW_MS = 60 * 60 * 1000;      // one hour
const MAX_PER_IP = 10;                      // a firm's office shares one address
const MAX_PER_INSTANCE = 80;
const MAX_TRACKED_IPS = 5000;

const ipHits = new Map();
let instanceHits = [];
let configCache = null;

/* LAST KNOWN-GOOD SETTINGS — the fix for CARL-eco-003.
   configCache above is a freshness cache: it is consulted only BEFORE the
   fetch, and never after one fails. So every failure path fell back to `base`,
   whose `paused` is hard-coded false — which meant the console being
   unreachable, slow, or answering oddly silently UN-paused a form. That is the
   console's only enforcement action over a child form, and it lifted itself.
   lastGood keeps the newest answer the console ever gave, with no expiry, so a
   form the console has said is paused stays paused until the console says
   otherwise. It is per-instance (a Netlify function is stateless, and a cold
   start starts empty), so it is a floor on the failure, not a guarantee. */
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

const withinWindow = (times, now) => times.filter((t) => now - t < RATE_WINDOW_MS);

/* Netlify sets x-nf-client-connection-ip itself, so a caller cannot spoof it.
   x-forwarded-for is only a fallback and is client-controlled. */
function clientIp(event) {
  const headers = event.headers || {};
  return headers['x-nf-client-connection-ip']
    || String(headers['x-forwarded-for'] || '').split(',')[0].trim()
    || 'unknown';
}

/* CARL-drplos-007. Which IPs have already had a rate_limited event reported in
   the current window, so the transition is reported and the flood is not. */
const limitedReported = new Map();
let rateLimitIsNew = false;

function rateLimited(event, now) {
  instanceHits = withinWindow(instanceHits, now);
  if (instanceHits.length >= MAX_PER_INSTANCE) return true;

  const ip = clientIp(event);
  const hits = withinWindow(ipHits.get(ip) || [], now);
  if (hits.length >= MAX_PER_IP) {
    ipHits.set(ip, hits);
    /* CARL-drplos-007. Every blocked request used to report a rate_limited
       event to the console. So deliberately tripping the throttle burned the
       console's event-key allowance and BLINDED the delivery record — the
       throttle's own noise denying the thing it protects. Report only the
       transition into limited, once per IP per window. */
    const lastReport = limitedReported.get(ip) || 0;
    rateLimitIsNew = (now - lastReport) >= RATE_WINDOW_MS;
    if (rateLimitIsNew) limitedReported.set(ip, now);
    if (limitedReported.size > MAX_TRACKED_IPS) {
      for (const [key, at] of limitedReported) {
        if ((now - at) >= RATE_WINDOW_MS) limitedReported.delete(key);
        if (limitedReported.size <= MAX_TRACKED_IPS) break;
      }
    }
    return true;
  }

  hits.push(now);
  ipHits.set(ip, hits);
  instanceHits.push(now);

  if (ipHits.size > MAX_TRACKED_IPS) {
    for (const [key, times] of ipHits) {
      if (!withinWindow(times, now).length) ipHits.delete(key);
      if (ipHits.size <= MAX_TRACKED_IPS) break;
    }
  }
  return false;
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  body: JSON.stringify(body),
});

const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_FIELD_LEN) : '');

/* Strip anything that could break out of a header line, and keep it short.
   Four of these now concatenate into one Subject: at MAX_FIELD_LEN apiece a
   caller bypassing the page could build a 16 000-character subject line, which
   a mail client truncates — pushing the real detail out of sight in the very
   place the reader looks first. The browser caps text at 200; this is the
   same floor, enforced where it cannot be bypassed. */
const MAX_HEADER_LEN = 200;
const headerSafe = (v) => clean(v).replace(/[\r\n]+/g, ' ').slice(0, MAX_HEADER_LEN);

const escapeHtml = (v) => clean(v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const parseList = (v) => String(v || '')
  .split(',')
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

/* ---- The domain floor -----------------------------------------------------
   CARL-eco-004. (This block first cited CARL-eco-006 as a second floor finding.
   It is not one - eco-006 is "no project-level agent instruction file with
   concrete security mandates exists in any of the four repos", the CLAUDE.md
   finding. Caught by Vera on review. Closing eco-006 on this evidence would have
   closed a live, unrelated defect.)

   Every document in this repo said RECIPIENT_DOMAINS was the floor the console
   cannot widen - CLAUDE.md called it "required, not optional". The code said
   otherwise: `floor.length ? filter : list`, so with the variable UNSET there
   was no floor at all and the console could have directed a claimant's medical
   report to any address on earth. Three headers said "strongly recommended",
   one said "optional", and only reading the code told you which was true.

   Worse, the absence was SILENT. Nothing logged it, nothing reported it, and
   diagnose() had no branch for it - a site with no floor described itself as
   healthy. That unverifiability was the defect, not just the gap.

   So the floor is now unconditional: with RECIPIENT_DOMAINS unset, DEFAULT_DOMAINS
   applies, and there is no path through this file that filters against nothing.

   WHY THIS CANNOT BREAK LIVE DELIVERY - measured, 30 September 2026, not
   assumed. GET /api/form-recipients on all four live sites returned recipients
   on exactly two domains each: the firm's own and iftfc.co.za. Whatever the
   floor is set to today, it therefore already permits both, so a built-in floor
   of those two domains cannot remove an address that is currently delivering.

   RECIPIENT_DOMAINS still REPLACES this when set, rather than intersecting with
   it. That is deliberate. The threat model is a compromised console, and the
   console cannot write an environment variable - while an operator adding the
   firm's real domain in a few days must not need a code change to do it.

   iftfc.co.za is CARL-eco-001: the operator's own domain is a live delivery
   target on a client's claimant form. It is here because it is here today, and
   it comes out of this list the moment the firm's own addresses replace it. 
   ON THE NAME, because the first one lied. This was called BUILTIN_FLOOR. A
   "floor" is something nothing can go under, and this is not that: a configured
   RECIPIENT_DOMAINS REPLACES this list rather than intersecting with it, so
   RECIPIENT_DOMAINS=co.za admits every .co.za domain on earth and is wider than
   the built-in. That replacement is deliberate - the threat model is a
   compromised CONSOLE, which cannot write an environment variable, and an
   operator adding the firm's real domain in a few days must not need a code
   change. But the name claimed a guarantee the code does not make, which is the
   exact habit this project keeps having to unlearn. It is DEFAULT_DOMAINS.
   */
const DEFAULT_DOMAINS = ['drpretoriusinc.co.za', 'iftfc.co.za'];

function effectiveFloor() {
  const set = parseList(process.env.RECIPIENT_DOMAINS)
    .map((d) => String(d).trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return set.length ? set : DEFAULT_DOMAINS.slice();
}

/* Bucketed rather than exact. With a fixed template the exact size of a PDF
   correlates with how many photographs and how much text a submission held,
   which is a fingerprint linking submissions to one another. The bucket says
   the only thing that is operationally useful: whether it was near the cap. */
function sizeBucket(bytes) {
  const kb = bytes / 1024;
  if (kb < 128) return 0;
  if (kb < 256) return 1;
  if (kb < 512) return 2;
  if (kb < 1024) return 3;
  if (kb < 2048) return 4;
  if (kb < 4096) return 5;
  return 6;
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ---- Settings -------------------------------------------------------------
   Returns { allowed, paused, pausedMessage, source } and, on a replay,
   stale: true. Never throws, and never leaves `allowed` wider than the
   environment variable would have allowed on its own — the RECIPIENT_DOMAINS
   floor is applied to every path.

   WHAT HAPPENS WHEN THE CONSOLE'S ANSWER IS WRONG (corrected 2026-09-29).
   This used to say the environment variable is used whenever anything is
   wrong. That is no longer true, and the change was deliberate: falling back
   to the environment variable also reset `paused` to false, so a console
   outage silently un-paused the form — the one thing the console can actually
   enforce (CARL-eco-003). Now, if the console has EVER answered successfully
   in this instance, that last good answer is replayed instead, declaring
   itself as source "stale-console" with stale: true so nothing downstream
   mistakes it for a live one (CARL-eco-018). Only when there is no such answer
   — a cold start, or a form never successfully wired — does it fall back to
   REPORT_TO_EMAIL. The replay is per-instance and a cold start begins empty,
   so it is a floor on the failure, not a guarantee. */
async function loadSettings() {
  const fallback = parseList(process.env.REPORT_TO_EMAIL).filter((a) => EMAIL_RE.test(a));
  const floor = effectiveFloor();

  /* No conditional - the floor is never empty, see effectiveFloor. The '|| \'\''
     matters: split('@')[1] is undefined for a string with no @, and .toLowerCase()
     on that THROWS rather than filtering it out. The original had this guard; my
     rewrite dropped it and Vera caught it on review. Unreachable today behind
     EMAIL_RE at every call site, which is not a reason to ship a throw. */
  const applyFloor = (list) => list.filter(
    (a) => floor.indexOf((String(a).split('@')[1] || '').toLowerCase()) !== -1);

  const base = {
    allowed: applyFloor(fallback),
    /* The environment fallback has no ids - REPORT_TO_EMAIL is a list of
       addresses and nothing more. An event from this path reports no recipient
       and the console shows "not recorded". */
    recipientIds: {},
    paused: false,
    pausedMessage: '',
    /* CARL-drplos-009: null means "the console said nothing", not "no limit". */
    maxPdfMb: null,
    source: 'env'
  };

  const consoleUrl = String(process.env.IFTFC_CONSOLE_URL || '').replace(/\/+$/, '');
  const configKey = process.env.IFTFC_CONFIG_KEY;
  if (!consoleUrl || !configKey) return base;

  if (configCache && Date.now() - configCache.at < CONFIG_CACHE_MS) {
    return configCache.value;
  }

  try {
    const slug = String(process.env.IFTFC_FORM_SLUG || 'loss-of-support');
    const res = await withTimeout(fetch(
      consoleUrl + '/api/form-config?form=' + encodeURIComponent(slug),
      { headers: { Authorization: 'Bearer ' + configKey, Accept: 'application/json' } }
    ), CONFIG_TIMEOUT_MS);

    if (!res.ok) {
      console.error('send-form: console refused the settings request, status=%d — using %s', res.status, lastGood ? 'the console\'s last known-good list (STALE)' : 'REPORT_TO_EMAIL');
      return lastGood ? replay(lastGood) : base;
    }

    const body = await res.json();
    const list = Array.isArray(body && body.recipients) ? body.recipients : null;
    if (!list) {
      console.error('send-form: console answered in an unexpected shape — using %s', lastGood ? 'the console\'s last known-good list (STALE)' : 'REPORT_TO_EMAIL');
      return lastGood ? replay(lastGood) : base;
    }

    const fromConsole = applyFloor(
      list.map((r) => String((r && r.email) || '').trim().toLowerCase())
          .filter((a) => EMAIL_RE.test(a))
    );

    /* An empty list from the console is treated as a fault, not an
       instruction. A form that has lost its recipients should keep using the
       last known-good list, not start refusing every claimant. */
    if (!fromConsole.length) {
      console.error('send-form: console returned no usable recipients — using %s', lastGood ? 'the console\'s last known-good list (STALE)' : 'REPORT_TO_EMAIL');
      return lastGood ? replay(lastGood) : base;
    }

    /* RICHARD-2026-09-30. Which mailbox a form reached is now recorded in the
       console (schema/12). The id is resolved HERE, server side, from the
       address the claimant chose - the browser never sends one and therefore
       cannot name a mailbox it was not offered. Console answers only: the
       REPORT_TO_EMAIL fallback has no ids and reports none, which is the truth
       rather than a gap. */
    const recipientIds = {};
    list.forEach((r) => {
      const a = String((r && r.email) || '').trim().toLowerCase();
      if (r && r.id && a) recipientIds[a] = String(r.id);
    });

    const value = {
      allowed: fromConsole,
      recipientIds: recipientIds,
      paused: !!(body.form && body.form.status === 'paused'),
      pausedMessage: (body.form && String(body.form.pausedMessage || '').slice(0, 600)) || '',
      /* CARL-drplos-009. The console has always SENT this and no form app has
         ever read it, so the operator has been editing a control that governs
         nothing. On app 5 it stopped being merely inert and started being
         wrong: the console displayed 5 MB while the form enforced 4, so a
         claimant with a 4.5 MB file was refused a submission the operator
         believed they had allowed. */
      maxPdfMb: (body.form && Number(body.form.maxPdfMb)) || null,
      source: 'console'
    };
    configCache = { at: Date.now(), value: value };
    lastGood = value;
    return value;
  } catch (err) {
    /* Timeout, DNS, TLS, anything. The claimant must never notice. */
    console.error('send-form: console unreachable (%s) — using %s',
      (err && err.message) || 'unknown',
      lastGood ? 'the console\'s last known-good list (STALE)' : 'REPORT_TO_EMAIL');
    return lastGood ? replay(lastGood) : base;
  }
}

/* The console accepts a fixed list of error codes and refuses anything else
   with a 400 — which would turn a provider fault into a lost record, the very
   silence this change exists to end. Resend can answer 402, 409 or 451, none
   of which the console knows. Map to the nearest code it does know rather than
   inventing one it will throw away. The claimant-facing message still quotes
   the real status, because that is what is useful on the telephone. */
const CONSOLE_ERROR_CODES = ['E400', 'E401', 'E403', 'E404', 'E413', 'E422', 'E429',
                             'E500', 'E502', 'E503'];

function providerCode(status) {
  const code = 'E' + status;
  if (CONSOLE_ERROR_CODES.indexOf(code) !== -1) return code;
  return status >= 500 ? 'E502' : 'E400';
}

/* Turns the console's status code into the thing to actually change, so
   whoever reads this log line does not have to go and read the console's
   source to find out what it meant. */
function eventHint(status, slug) {
  if (status === 401) {
    return ' IFTFC_EVENT_KEY is missing, wrong, revoked or expired — mint a new'
      + ' event:write key on the company page in the console and set it here.';
  }
  if (status === 403) {
    return ' That key exists but is not an event:write key. Config keys cannot record events.';
  }
  if (status === 404) {
    return ' The console has no form with the reference "' + slug + '" for this key\'s company.'
      + ' Set IFTFC_FORM_SLUG to the REFERENCE shown on the form\'s page in the console.';
  }
  if (status === 400) {
    return ' The console refused the payload itself — see the code above.';
  }
  if (status === 429) {
    return ' Too many events on this key in the past hour.';
  }
  if (status >= 500) {
    return ' The console is up but could not store the row; check its own SUPABASE_* variables.';
  }
  return '';
}

/* Said once per cold start rather than once per submission: enough to find in
   the log, not enough to bury it. */
let warnedNotReporting = false;

/* ---- Usage reporting ------------------------------------------------------
   Records THAT a form was submitted and how it went. Deliberately carries no
   claimant name, no reference, no email address, no filename and no document —
   the console has no column any of those could be written into, and this is
   the only place that could try. Failure here is ignored: a console that is
   down must never stop a claimant's form reaching the practice. */
/* CARL-eco-017. `isTest` was the literal `false`, so a form site could never
   mark a submission as a test and every demo send counted as real client intake.
   Passed as a PARAMETER, not module state: a warm Netlify instance can serve
   concurrent requests, and a shared mutable flag would eventually label somebody
   else's submission a test. */
async function reportEvent(outcome, errorCode, bytes, isTest, recipientId) {
  const consoleUrl = String(process.env.IFTFC_CONSOLE_URL || '').replace(/\/+$/, '');
  const eventKey = process.env.IFTFC_EVENT_KEY;
  /* MUST match the REFERENCE shown on this form's page in the console, AND the
     default in form-recipients.js. On the sibling SJA build these three
     literals drifted apart — 'loss-of-support' in one file, 'loss-of-support-
     form' in the other — so events were refused with a 404 the moment the
     console variables were set: delivering fine, recording nothing, invisibly.
     All three say 'loss-of-support' here. Change them together. */
  const slug = String(process.env.IFTFC_FORM_SLUG || 'loss-of-support');

  if (!consoleUrl || !eventKey) {
    if (!warnedNotReporting) {
      warnedNotReporting = true;
      console.error(
        'send-form: deliveries are NOT being recorded in the console because %s is not set '
        + 'on this site. Netlify > Site configuration > Environment variables, scope including '
        + 'Functions, then redeploy. The form itself is unaffected.',
        [!consoleUrl ? 'IFTFC_CONSOLE_URL' : null, !eventKey ? 'IFTFC_EVENT_KEY' : null]
          .filter(Boolean).join(' and ')
      );
    }
    return;
  }

  try {
    const res = await withTimeout(fetch(consoleUrl + '/api/form-event', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + eventKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        form: slug,
        outcome: outcome,
        errorCode: errorCode || null,
        sizeBucket: sizeBucket(bytes || 0),
        isTest: isTest === true,
        /* Omitted rather than sent as null when unknown, so this behaves
           identically against a console that has not run schema/12 yet. */
        ...(recipientId ? { recipientId: recipientId } : {})
      })
    }), EVENT_TIMEOUT_MS);

    /* THE BUG THIS CLOSES. fetch() resolves on 4xx and 5xx — it only rejects
       when the request could not be made at all. The catch below therefore
       never saw a wrong key, a revoked key, the wrong scope, or a form slug
       the console does not know. Every one of those came back quietly and was
       indistinguishable from success: the email went out, the console recorded
       nothing, and no line anywhere said why. */
    if (!res.ok) {
      /* The console names the fault in a field called `code`. It is a short
         constant like BAD_FORM — never claimant content — so it is safe to log
         and it is the difference between an afternoon and a minute. */
      let detail = '';
      try {
        const body = await res.json();
        const code = body && (body.code || body.error);
        if (code) detail = ' (' + String(code).slice(0, 120) + ')';
      } catch (err) { /* the status is the point; the body is a bonus */ }

      console.error(
        'send-form: the console REFUSED the event, status=%d, form="%s"%s.'
        + ' The email was sent — only the record failed.%s',
        res.status, slug, detail, eventHint(res.status, slug)
      );
    }
  } catch (err) {
    console.error('send-form: could not reach the console to record the event (%s).'
      + ' The form was unaffected.', (err && err.message) || 'unknown');
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed.' });
  }

  /* False until the payload has been read, so events raised before that report
     as real traffic rather than inheriting a flag nobody set. */
  let isTestSubmission = false;

  /* CARL-drplos-006. Two narrow guards, before anything is parsed.

     (1) Content-Type must be application/json. A cross-site form POST cannot
         set that header without triggering a CORS preflight, so this alone
         closes the simple-request path by which another site could drive this
         endpoint from a visitor's browser — which is how the per-IP throttle
         was launderable through other people's addresses.
     (2) An Origin that is PRESENT and not ours is refused. An ABSENT Origin
         stays allowed on purpose: a legitimate non-browser caller sends none,
         and breaking those to chase a header is a worse trade.

     Deliberately no CSRF token: this page persists nothing and has no session
     to forge against, so a token would be ceremony rather than a control. */
  const ctype = String(
    (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || ''
  );
  if (!/^application\/json\b/i.test(ctype)) {
    return reply(415, { error: 'This endpoint accepts application/json only.' });
  }

  const origin = String(
    (event.headers && (event.headers.origin || event.headers.Origin)) || ''
  );
  if (origin) {
    const host = String((event.headers && (event.headers.host || event.headers.Host)) || '');
    if (!host || origin.toLowerCase() !== 'https://' + host.toLowerCase()) {
      return reply(403, { error: 'That request did not come from this form.' });
    }
  }

  // Reject oversized bodies before spending memory or CPU on them.
  if ((event.body || '').length > MAX_BODY_BYTES) {
    await reportEvent('oversize', 'LOCAL_PDF_TOO_LARGE', 0, isTestSubmission);
    return reply(413, { error: 'The submission is too large.' });
  }

  if (rateLimited(event, Date.now())) {
    /* Not awaited: a blocked request must not hold an invocation open for the
       event timeout. Fire and forget, and only on the transition. */
    if (rateLimitIsNew) {
      const p = reportEvent('rate_limited', 'LOCAL_RATE_LIMIT', 0, isTestSubmission);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
    return {
      statusCode: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Retry-After': '3600',
      },
      body: JSON.stringify({
        error: 'Too many forms have been sent from this connection in the past hour. Please try again later, or telephone the office.',
      }),
    };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.REPORT_FROM_EMAIL;
  const settings = await loadSettings();
  const allowed = settings.allowed;

  if (!apiKey || !fromAddress || allowed.length === 0) {
    /* Name the specific variable so this is diagnosable from the function log
       without guesswork. The value itself is never logged. */
    const missing = [
      !apiKey ? 'RESEND_API_KEY' : null,
      !fromAddress ? 'REPORT_FROM_EMAIL' : null,
      allowed.length === 0 ? 'REPORT_TO_EMAIL (or RECIPIENT_DOMAINS excludes every address)' : null,
    ].filter(Boolean).join(' and ');
    console.error(
      `send-form: missing configuration -> ${missing}. `
      + 'Set it in Netlify > Site configuration > Environment variables, make sure the '
      + 'scope includes Functions, then redeploy.'
    );
    await reportEvent('validation_rejected', 'LOCAL_CONFIG_MISSING', 0, isTestSubmission);
    return reply(500, { error: 'Email delivery is not configured on the server.' });
  }

  /* A paused form still answers, and answers in the operator's own words. The
     browser shows this instead of a generic failure, so a claimant is told to
     telephone rather than left retrying. */
  if (settings.paused) {
    await reportEvent('validation_rejected', 'LOCAL_FORM_PAUSED', 0, isTestSubmission);
    return reply(503, {
      error: settings.pausedMessage
        || 'This form is temporarily unavailable. Please telephone the office.',
      code: 'PAUSED'
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return reply(400, { error: 'Could not read the submission.' });
  }
  /* CARL-eco-017. Client-supplied, and that is acceptable here: the demo path is
     passcode gated, the worst a false claim achieves is keeping a submission out
     of a figure, and the document itself is already named
     EXAMPLE-NOT-A-REAL-SUBMISSION. It is not a security control and is not
     treated as one. */
  isTestSubmission = payload.isTest === true;
  // Hidden field: a real person leaves it empty.
  if (clean(payload.website)) return reply(200, { ok: true });

  const firstName = headerSafe(payload.firstName);
  const surname = headerSafe(payload.surname);
  const deceasedFirstName = headerSafe(payload.deceasedFirstName);
  const deceasedSurname = headerSafe(payload.deceasedSurname);
  const claimRef = headerSafe(payload.claimRef);

  if (!firstName || !surname) {
    await reportEvent('validation_rejected', 'E400', 0, isTestSubmission);
    return reply(400, { error: 'The form is missing the claimant’s name.' });
  }

  /* The page chooses from a menu; this decides whether that choice is real.
     Anything not on the allowlist is refused, so a tampered page, a crafted
     progress file or a request made outside the browser cannot redirect a
     form to an address of the sender's choosing. */
  const requested = clean(payload.recipientEmail).toLowerCase();
  const recipient = allowed.find((a) => a === requested);
  if (!recipient) {
    await reportEvent('recipient_rejected', 'LOCAL_DOMAIN_REFUSED', 0, isTestSubmission);
    return reply(403, {
      error: 'That recipient is not one this form is allowed to send to. '
        + 'Please choose again, or telephone the office.',
    });
  }

  const pdfBase64 = typeof payload.pdfBase64 === 'string' ? payload.pdfBase64 : '';
  if (!pdfBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) {
    await reportEvent('validation_rejected', 'LOCAL_PDF_INVALID', 0, isTestSubmission);
    return reply(400, { error: 'The attached document was not readable.' });
  }
  const pdfBytes = Math.floor(pdfBase64.length * 0.75);
  /* CARL-drplos-009. The console's value applies only where it is STRICTER than
     the built-in cap — never wider. Same principle as RECIPIENT_DOMAINS: the
     console may tighten what this site does and may never loosen it, so a
     compromised console cannot raise a form's limits. A missing or nonsense
     value leaves the built-in cap standing alone. */
  const consoleMb = Number(settings && settings.maxPdfMb);
  const effectiveMaxBytes = (consoleMb > 0)
    ? Math.min(MAX_PDF_BYTES, Math.round(consoleMb * 1024 * 1024))
    : MAX_PDF_BYTES;
  if (pdfBytes > effectiveMaxBytes) {
    await reportEvent('oversize', 'LOCAL_PDF_TOO_LARGE', pdfBytes, isTestSubmission);
    return reply(413, { error: 'The attached document is too large.' });
  }

  /* Valid base64 is not the same as a valid PDF. Without this, a caller
     bypassing the page could attach any bytes at all and have them delivered
     to the intake inbox inside a legitimate-looking submission email. */
  let header;
  try {
    header = Buffer.from(pdfBase64.slice(0, 12), 'base64').toString('latin1');
  } catch (err) {
    header = '';
  }
  if (header.slice(0, 5) !== '%PDF-') {
    await reportEvent('validation_rejected', 'LOCAL_PDF_INVALID', pdfBytes, isTestSubmission);
    return reply(400, { error: 'The attached document was not a valid PDF.' });
  }

  const filename = (clean(payload.pdfFilename) || 'Loss-of-Support-Form.pdf')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 120);

  /* The matter is named after the deceased — that is how the practice, the Fund
     and the court all refer to it — and falls back to the person who filled
     the form in when the deceased's name was left blank. */
  const matterName = (deceasedFirstName || deceasedSurname)
    ? ((deceasedFirstName + ' ' + deceasedSurname).trim() + ' (deceased)')
    : (firstName + ' ' + surname);

  const subject = (isTestSubmission ? '[TEST] ' : '')
    + 'Loss of Support Form – '
    + (claimRef ? claimRef + ' – ' : '')
    + matterName;

  /* Client-supplied, so it is shown in the message body as well as being set
     as a header — a reply must never go somewhere the reader cannot see. */
  const replyTo = clean(payload.email);
  const replyToValid = EMAIL_RE.test(replyTo);

  const row = (label, value) => '<tr><td style="color:#5d5d60;padding:4px 12px 4px 0">'
    + label + '</td><td style="padding:4px 0"><strong>' + value + '</strong></td></tr>';

  const html = '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1d1f20;line-height:1.6">'
    + '<p>A Loss of Support Form has been submitted.</p>'
    + '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">'
    + row('Deceased', (deceasedFirstName || deceasedSurname)
      ? escapeHtml((deceasedFirstName + ' ' + deceasedSurname).trim())
      : '<em>not supplied</em>')
    + row('Completed by', escapeHtml(firstName) + ' ' + escapeHtml(surname))
    + row('Reference', claimRef ? escapeHtml(claimRef) : '<em>not supplied</em>')
    + row('Received', new Date().toISOString())
    + row('Reply goes to', replyToValid
      ? escapeHtml(replyTo)
      : '<em>no valid address supplied — replies come back to you</em>')
    + '</table>'
    + '<p>The completed form is attached as a PDF. The supporting documents, the '
    + 'accident report, any photographs, the scene sketch and the signature are the '
    + 'closing pages of that document.</p>'
    + '</div>';

  /* The sender is REPORT_FROM_EMAIL and nothing else. There used to be a
     hardcoded 'noreply@iftfc.com' fallback here, on the stated basis that
     iftfc.com was verified in Resend. That domain was retired on 2026-09-29,
     and a fallback to a domain nobody is maintaining is the worst possible
     default: Resend refuses an unverified sender with a 403, so EVERY send
     fails, and it fails silently as far as the claimant's browser is
     concerned. The guard above now refuses to start without this variable,
     which turns an invisible delivery outage into a named configuration
     error in the function log. Set it to an address on a domain verified in
     Resend — today that is iftfc.co.za. (STEVE-eco-002) */
  const body = {
    from: fromAddress,
    to: [recipient],
    subject,
    html,
    attachments: [{ filename, content: pdfBase64 }],
  };

  // Set only when valid; either way the address is shown in the body above.
  if (replyToValid) body.reply_to = replyTo;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      /* Log the STATUS and nothing else.
         This used to log the chosen recipient, the whole allowlist, and 400
         characters of Resend's own response. Resend echoes the offending
         request back on a 422 — including the subject line, which carries the
         claimant's name. That put claimant identity into a log Richard reads,
         which is precisely what the platform's zero-access guarantee says
         cannot happen. The status code is what actually tells you which fault
         it is; everything else was detail that leaked. */
      console.error('send-form: the email provider rejected the message, status=%d.', res.status);

      /* A 4xx from the provider is a configuration fault, not a blip. Telling
         the claimant to try again would send them round the same loop, so the
         two cases get different advice. Neither reveals what the provider
         actually said. */
      if (res.status >= 400 && res.status < 500) {
        await reportEvent('provider_error', providerCode(res.status), pdfBytes, isTestSubmission);
        /* The provider's status code goes back as a short reference. It names
           no address, no key and no internal detail, but it is the difference
           between "the key is wrong" (401), "that sender or recipient is not
           allowed" (403) and "the request was malformed" (422) — which is what
           whoever picks up the telephone actually needs to know. */
        return reply(502, {
          error: 'The form could not be delivered because of a problem with this firm’s email setup. '
            + 'Please telephone the office and quote reference E' + res.status
            + ' — trying again will not help.',
          code: 'E' + res.status,
        });
      }
      await reportEvent('provider_error', res.status >= 500 ? 'E502' : 'E500', pdfBytes, isTestSubmission);
      return reply(502, { error: 'The form could not be sent just now. Please try again.' });
    }
  } catch (err) {
    /* The message, not the object: an error object from fetch can carry the
       request it failed on, and that request holds the PDF. */
    console.error('send-form: the request to the email provider failed (%s).',
      (err && err.message) || 'unknown');
    await reportEvent('provider_error', 'LOCAL_NETWORK', pdfBytes, isTestSubmission);
    return reply(502, { error: 'The form could not be sent just now. Please try again.' });
  }

  /* Resolved from the chosen address, never accepted from the browser. */
  await reportEvent('sent', null, pdfBytes, isTestSubmission,
                    (settings.recipientIds || {})[recipient]);
  return reply(200, { ok: true });
};
