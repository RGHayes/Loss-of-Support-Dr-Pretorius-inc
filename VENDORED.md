# Vendored third-party code

**CARL-eco-005.** These files are committed into this repo rather than installed,
and there was no `package.json`, lockfile or manifest of any kind — so **no
scanner could see them and no reviewer could tell what version was running.**
This file is that manifest. Keep it accurate; it is the only record.

| File | Package | Version | SHA-256 | Licence |
|---|---|---|---|---|
| `public/jspdf.umd.min.js` | jsPDF | **2.5.1** | `98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875` | MIT |
| `public/fonts/DejaVuSans.ttf` | DejaVu Sans | 2.37 | `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954` | Bitstream Vera + public-domain DejaVu changes |
| `public/fonts/DejaVuSans-Bold.ttf` | DejaVu Sans Bold | 2.37 | `e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724` | as above |

All four form repos carry a **byte-identical** copy of jsPDF — verified
30 September 2026, one distinct SHA-256 across four repos.

## Known advisory against the pinned version

**CVE-2025-29907** — user control of the first argument to `addImage` causes
high CPU and denial of service in jsPDF before 3.0.1. `html()` and
`addSvgAsImage()` are affected too. **The advisory's fixed version is 3.0.1**
— "The vulnerability was fixed in jsPDF 3.0.1. Upgrade to jspdf@>=3.0.1",
vulnerable range `< 3.0.1`, first patched 3.0.1.

This file previously said the advisory recommended **4.2.1**, which is the
current npm release and not what GHSA-w532-jxjh-hjhj says (`CARL-eco-020`).
The error ran in one direction: it inflated the required jump from ONE major
version to TWO, which made the deferral below look better justified than it
is. Read reason 2 with that in mind — 2.5.1 → 3.0.1 is still a major version
and the argument survives, but it is a weaker argument than the one this file
was making.

**The advisory's own recommended mitigation is already in place here**, which is
why the upgrade is deferred rather than ignored. Every `addImage` first argument
in this app is either a canvas data URL this code produced, or a string validated
against:

    IMAGE_DATA_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/]+={0,2}$/

including on the draft-restore path, which is the one route by which an
attacker-supplied image could otherwise arrive. `html()` and
`addSvgAsImage()` are not called anywhere in this app.

## Why the upgrade is deferred, and what would change that

Deferred deliberately on 30 September 2026, for two reasons stated so the next
reader can disagree with them:

1. **The mitigation is the advisory's own.** Reachability is a hypothesis, not a
   demonstrated path — Carl's assessment, not a convenient reading.
2. **2.5.1's API is load-bearing right now.** The Unicode font support added on
   29 September uses `addFileToVFS` / `addFont` on the document instance, and
   depends on behaviour verified against this exact build — including that font
   registration does **not** carry from one document to the next. A major version
   jump needs that whole path re-verified, and the forms go to clients this
   week. Note this is 2.5.1 → **3.0.1**, one major version, not the two this
   file used to imply.

**Upgrade when:** there is time to re-verify the PDF path end to end — a real
send with a name outside Windows-1252, checking the rendered PDF embeds
`FontFile2` and `ToUnicode` and that bold still renders. That is roughly an
hour's work and it is not work to do the week of a launch.

**Re-check this file whenever the vendored bytes change.** A manifest that has
stopped matching is worse than none, because it is believed.
