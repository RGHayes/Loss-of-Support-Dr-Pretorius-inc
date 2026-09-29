/* ============================================================================
   Builds the Loss of Support PDF that goes to Dr Pretorius Inc.

   A4 portrait, a plain letterhead on page one, a compact running head on the
   pages after it, and a confidential footer with page numbers. The
   certificates, the accident report, the photographs, the scene sketch and the
   signature are appended as the closing pages, each set under its own heading.
   Deliberately no logo and no watermark — this build carries no branding, the
   same as the practice's accident information form.

   Everything happens in the browser. The answers are never sent anywhere as
   structured data — only this finished document is.
   ========================================================================= */
(function () {
  'use strict';

  /* ── jsPDF 2.5.1, vendored — what must never be called ────────────────
     Checked 2026-09-22 against the four published advisories. None of them
     is reachable in THIS build, and each stays unreachable only because of
     a specific property of the code below. Keep them true:

       CVE-2025-68428  arbitrary file read via loadFile, reached through
         (9.2)         addImage / html / addFont given a filesystem PATH.
                       Node.js only. jsPDF is loaded in the browser here and
                       nowhere else — the Netlify functions never touch it.
                       Every addImage argument below is a canvas data URL or a
                       data URL already validated against IMAGE_DATA_RE in
                       app.js. Never a path.

       CVE-2026-31938  HTML injection via the OPTIONS argument of output(),
         (9.6)         in the new-window paths. app.js calls
                       output('datauristring') — a literal, no options
                       object — and this app never opens a PDF in a window.

       CVE-2026-25755  PDF object injection via addJS. NEVER CALLED.
         (8.8)

       CVE-2026-24043  XMP injection via addMetadata. NEVER CALLED.
                       setProperties below takes fixed literals only.

     So: do not call addJS, addMetadata, addFont, html or loadFile. Do not
     pass a user-controlled options object to output(), and do not add a
     new-window output path. Do not pass addImage anything but a data URL
     this code produced or validated. If any of those has to change, upgrade
     jsPDF first — 4.2.1 or later fixes all four.

     There is no package.json, so no scanner will ever warn about this copy.
     This comment is the warning. */

  /* ── Printing a name the standard fonts cannot ────────────────────────
     Q-S2, Richard's decision 29 September 2026.

     jsPDF's standard-14 fonts are WinAnsi-encoded, so a claimant named Łukasz
     could not submit this form AT ALL: the pre-send guard blocked the send
     rather than put a wrong character in a legal document. Blocking is the
     right failure if the only alternative is corruption — but turning a real
     person away because of their own name is a worse outcome than either.

     DejaVu Sans is embedded instead, and ONLY when it is needed. It is fetched
     from this site's own `fonts/` directory, so it satisfies the CSP's
     `default-src 'self'` with no exception, and it costs nothing at all for the
     overwhelming majority of claimants whose names the standard fonts handle.

     WHAT IT DOES NOT FIX, stated so nobody assumes otherwise: DejaVu's
     format-4 cmap covers the Basic Multilingual Plane only. An emoji lives
     outside it, so an emoji is still unprintable and the send is still blocked
     with the character named. That is correct rather than a shortfall — an
     emoji in a legal document is not a name.

     COVERAGE below was extracted FROM THE FONT FILE, not copied from its
     documentation: 242 ranges, 5371 code points, verified to include U+0141 Ł,
     U+00EB ë, Croatian, Turkish, Vietnamese, Cyrillic, Greek, Arabic and
     Hebrew. A guard that guesses what a font covers is how a name silently
     becomes a row of boxes. */
  var COVERAGE = '0,20-7E,A0-2E9,2EC-2EE,2F3,2F7,300-34F,351-353,357-358,35A,35C-362,370-377,37A-37F,384-38A,38C,38E-3A1,3A3-525,531-556,559-55F,561-587,589-58A,5B0-5C3,5C6-5C7,5D0-5EA,5F0-5F4,606-607,609-60A,60C,615,61B,61F,621-63A,640-655,657,65A,660-670,674,679-6BF,6C6-6C8,6CB-6CC,6CE,6D0,6D5,6F0-6F9,7C0-7E7,7EB-7F5,7F8-7FA,E3F,E81-E82,E84,E87-E88,E8A,E8D,E94-E97,E99-E9F,EA1-EA3,EA5,EA7,EAA-EAB,EAD-EB9,EBB-EBD,EC0-EC4,EC6,EC8-ECD,ED0-ED9,EDC-EDD,10A0-10C5,10D0-10FC,1401-1407,1409-141B,141D-1435,1437-144A,144C-1452,1454-14BD,14C0-14EA,14EC-1507,1510-153E,1540-1550,1552-156A,1574-1585,158A-1596,15A0-15AF,15DE,15E1,1646-1647,166E-1676,1680-169C,1D00-1D14,1D16-1D23,1D26-1D2E,1D30-1D5B,1D5D-1D6A,1D77-1D78,1D7B,1D7D,1D85,1D9B-1DBF,1DC4-1DC9,1E00-1EFB,1F00-1F15,1F18-1F1D,1F20-1F45,1F48-1F4D,1F50-1F57,1F59,1F5B,1F5D,1F5F-1F7D,1F80-1FB4,1FB6-1FC4,1FC6-1FD3,1FD6-1FDB,1FDD-1FEF,1FF2-1FF4,1FF6-1FFE,2000-2064,206A-2071,2074-208E,2090-209C,20A0-20B5,20B8-20BA,20BD,20D0-20D1,20D6-20D7,20DB-20DC,20E1,2100-2109,210B-2149,214B,214E,2150-2185,2189,2190-2311,2318-2319,231C-2321,2324-2328,232B-232C,2373-2375,237A,237D,2387,2394,239B-23AE,23CE-23CF,23E3,23E5,23E8,2422-2423,2460-2469,2500-269C,269E-26B8,26C0-26C3,26E2,2701-2704,2706-2709,270C-2727,2729-274B,274D,274F-2752,2756,2758-275E,2761-2794,2798-27AF,27B1-27BE,27C5-27C6,27E0,27E6-27EB,27F0-28FF,2906-2907,290A-290B,2940-2941,2983-2984,29CE-29D5,29EB,29FA-29FB,2A00-2A02,2A0C-2A1C,2A2F,2A6A-2A6B,2A7D-2AA0,2AAE-2ABA,2AF9-2AFA,2B00-2B1A,2B1F-2B24,2B53-2B54,2C60-2C77,2C79-2C7F,2D00-2D25,2D30-2D65,2D6F,2E18,2E1F,2E22-2E25,2E2E,4DC0-4DFF,A4D0-A4FF,A644-A647,A64C-A64D,A650-A651,A654-A657,A662-A66E,A68A-A68D,A694-A695,A698-A699,A708-A716,A71B-A71F,A722-A72B,A730-A741,A746-A74B,A74E-A753,A756-A757,A764-A767,A780-A783,A789-A78E,A790-A791,A7A0-A7AA,A7F8-A7FF,EF00-EF19,F000-F003,F400-F426,F428-F441,F6C5,FB00-FB06,FB13-FB17,FB1D-FB36,FB38-FB3C,FB3E,FB40-FB41,FB43-FB44,FB46-FB4F,FB52-FBA3,FBAA-FBAD,FBD3-FBDC,FBDE-FBDF,FBE4-FBE9,FBFC-FBFF,FE00-FE0F,FE20-FE23,FE70-FE74,FE76-FEFC,FEFF,FFF9-FFFD';

  var covRanges = null;
  function ranges() {
    if (covRanges) return covRanges;
    covRanges = COVERAGE.split(',').map(function (part) {
      var bits = part.split('-');
      var lo = parseInt(bits[0], 16);
      return [lo, bits.length > 1 ? parseInt(bits[1], 16) : lo];
    });
    return covRanges;
  }

  function covered(cp) {
    var r = ranges();
    var lo = 0, hi = r.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (cp < r[mid][0]) hi = mid - 1;
      else if (cp > r[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  /* Walks code POINTS, not UTF-16 code units — otherwise every emoji is split
     into two lone surrogates and reported as two unidentifiable blobs, which is
     the bug NINA-CALL-10 was about. */
  function unprintable(text) {
    var out = [];
    var v = String(text == null ? '' : text);
    var chars = v.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) || [];
    chars.forEach(function (ch) {
      var cp = ch.codePointAt(0);
      if (!covered(cp) && out.indexOf(ch) === -1) out.push(ch);
    });
    return out;
  }

  /* True once the embedded font is registered. `build()` is deliberately
     SYNCHRONOUS — the whole asset pipeline is built that way — so the font is
     registered on the jsPDF prototype BEFORE build() is called, never inside
     it. app.js awaits ensureUnicodeFont() and only then builds. */
  var FAMILY = 'helvetica';
  var unicodeReady = null;

  function fetchFontBase64(url) {
    return window.fetch(url, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' returned ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      /* Chunked so a 757 KB font does not blow the argument limit on
         String.fromCharCode, which is a real ceiling on older Safari. */
      var bytes = new Uint8Array(buf);
      var chunk = 0x8000;
      var parts = [];
      for (var i = 0; i < bytes.length; i += chunk) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
      }
      return window.btoa(parts.join(''));
    });
  }

  /* The font bytes, held in memory once fetched. Registration happens PER
     DOCUMENT in build(), not here, and that is not a stylistic choice:
     `addFileToVFS` on jsPDF.API throws "Cannot read properties of undefined
     (reading 'vFS')" because the prototype has no VFS, and registering on one
     instance does NOT carry to the next — a second document asked for
     'DejaVuSans' silently rendered in `times` with no error raised. Verified
     both, in a browser, rather than assumed. A font that silently falls back is
     how a name becomes a row of boxes in a legal document. */
  var fontBytes = null;

  function ensureUnicodeFont() {
    if (unicodeReady) return unicodeReady;
    var ctor = window.jspdf && window.jspdf.jsPDF;
    if (!ctor) return Promise.resolve(false);
    unicodeReady = Promise.all([
      fetchFontBase64('fonts/DejaVuSans.ttf'),
      fetchFontBase64('fonts/DejaVuSans-Bold.ttf')
    ]).then(function (b64) {
      fontBytes = { normal: b64[0], bold: b64[1] };
      FAMILY = 'DejaVuSans';
      return true;
    }).catch(function (err) {
      /* Reset so a later attempt can retry, and report false rather than
         throwing: the caller's correct response is to keep the block, which is
         exactly today's behaviour. Failing to load a font must never fail a
         send that the standard fonts could have handled. */
      unicodeReady = null;
      fontBytes = null;
      FAMILY = 'helvetica';
      if (window.console && window.console.error) {
        window.console.error('pdf: embedded font unavailable —', err && err.message);
      }
      return false;
    });
    return unicodeReady;
  }

  /* DejaVu Sans ships regular and bold here, not oblique. The single italic in
     this document is the grey "nothing entered" note, so it maps to normal
     rather than costing another 700 KB for one caption. */
  function famStyle(style) {
    if (FAMILY === 'helvetica') return style;
    return style === 'italic' ? 'normal' : style;
  }

  var PAGE_W = 210;
  var PAGE_H = 297;
  var ML = 17;                     // left margin
  var MR = 17;                     // right margin
  var CW = PAGE_W - ML - MR;       // content width, 176 mm
  var FOOTER_RULE_Y = 277;
  var BOTTOM_LIMIT = 271;

  var LABEL_W = 52;                // wide enough for "Has the estate been reported to the Master"
  var SIMPLE = ['t', 'a', 's', 'r', 'c'];
  var VALUE_X = ML + LABEL_W + 3;
  var VALUE_W = CW - LABEL_W - 3;

  var INK = [29, 31, 32];
  var GREY = [122, 122, 125];
  var MID = [93, 93, 96];
  var ACCENT = [151, 27, 48];
  var HAIRLINE = [205, 207, 209];

  var FOOTER_TEXT = 'Dr Pretorius Inc  ·  Confidential  ·  Contains medical information';

  /* ── Small drawing helpers ─────────────────────────────────────────── */
  function setColor(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

  function rule(doc, y, rgb, thickness) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    doc.setLineWidth(thickness);
    doc.line(ML, y, PAGE_W - MR, y);
  }

  function monthName(n) {
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'][n];
  }

  function longDate(d) {
    return d.getDate() + ' ' + monthName(d.getMonth()) + ' ' + d.getFullYear();
  }

  /* ── The document ──────────────────────────────────────────────────── */
  function build(record) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) throw new Error('jsPDF is not available');

    var doc = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    /* Register the embedded font on THIS document, if it was fetched. Must be
       per document — see the note on fontBytes. If the registration does not
       take, fall back to helvetica rather than let jsPDF silently substitute
       `times` for a family it does not know: the characters that needed the
       font would then be dropped or boxed with nothing said. */
    if (fontBytes) {
      try {
        doc.addFileToVFS('DejaVuSans.ttf', fontBytes.normal);
        doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
        doc.addFileToVFS('DejaVuSans-Bold.ttf', fontBytes.bold);
        doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
        doc.setFont('DejaVuSans', 'normal');
        if (doc.getFont().fontName !== 'DejaVuSans') throw new Error('font did not take');
        FAMILY = 'DejaVuSans';
      } catch (err) {
        FAMILY = 'helvetica';
        if (window.console && window.console.error) {
          window.console.error('pdf: embedded font could not be registered —', err && err.message);
        }
      }
    }

    doc.setProperties({
      title: 'Loss of Support Form',
      subject: 'Loss of support intake — Dr Pretorius Inc',
      creator: 'Dr Pretorius Inc loss of support form'
    });

    var v = record.values;
    /* The deceased names the file, not the person who filled it in: that is
       how the practice, the Fund and the court all refer to the matter. The
       claimant is shown on the line beneath. */
    var deceased = [v.decFirstName, v.decSurname].filter(Boolean).join(' ');
    var claimant = [v.firstName, v.surname].filter(Boolean).join(' ');
    var ref = v.claimRef || '';
    var meta = [
      deceased ? 'Late ' + deceased : '',
      ref,
      'Submitted ' + longDate(record.submittedAt)
    ].filter(Boolean).join('  ·  ');
    var meta2 = claimant ? 'Completed by ' + claimant : '';

    var state = { y: 0, page: 0 };

    function drawLetterhead() {
      doc.setFont(FAMILY, famStyle('bold'));
      doc.setFontSize(7);
      setColor(doc, ACCENT);
      doc.text('CLAIMANT INTAKE', ML, 18, { charSpace: 0.6 });

      doc.setFontSize(17);
      setColor(doc, INK);
      doc.text('Loss of Support Form', ML, 25.5);

      doc.setFont(FAMILY, famStyle('normal'));
      doc.setFontSize(8.5);
      setColor(doc, MID);
      doc.text(meta, ML, 30.5);
      if (meta2) doc.text(meta2, ML, 34.6);

      rule(doc, meta2 ? 38.6 : 34.5, ACCENT, 0.5);
      state.y = meta2 ? 46 : 42;
    }

    function drawRunningHead() {
      doc.setFont(FAMILY, famStyle('bold'));
      doc.setFontSize(8.5);
      setColor(doc, INK);
      doc.text('Loss of Support Form', ML, 16.5);
      doc.setFont(FAMILY, famStyle('normal'));
      setColor(doc, MID);
      var runner = [deceased ? 'Late ' + deceased : '', ref].filter(Boolean).join('  ·  ');
      if (runner) doc.text(runner, ML + 46, 16.5);
      rule(doc, 20, HAIRLINE, 0.2);
      state.y = 27;
    }

    function newPage() {
      state.page += 1;
      if (state.page > 1) doc.addPage();
      if (state.page === 1) drawLetterhead(); else drawRunningHead();
    }

    function need(mm) {
      if (state.y + mm > BOTTOM_LIMIT) newPage();
    }

    /* ── Content blocks ─────────────────────────────────────────────── */
    function sectionHeading(number, name) {
      /* Enough room for the heading AND the first answer under it. At 16 mm a
         heading could be the last thing on a page, with its section starting
         overleaf — which reads as though the section were empty. */
      need(30);
      state.y += 6;
      doc.setFont(FAMILY, famStyle('bold'));
      doc.setFontSize(8);
      setColor(doc, MID);
      doc.text(number + '  ·  ' + name.toUpperCase(), ML, state.y, { charSpace: 0.55 });
      state.y += 3.4;
      rule(doc, state.y, HAIRLINE, 0.2);
      state.y += 4.6;
    }

    function labelledRow(label, value) {
      doc.setFont(FAMILY, famStyle('normal'));
      doc.setFontSize(9.5);
      var lines = doc.splitTextToSize(value, VALUE_W);
      var blockH = Math.max(lines.length * 4.3, 4.3);
      need(blockH + 2);

      doc.setFontSize(8.5);
      setColor(doc, GREY);
      var labelLines = doc.splitTextToSize(label, LABEL_W);
      doc.text(labelLines, ML, state.y);

      doc.setFontSize(9.5);
      setColor(doc, INK);
      doc.text(lines, VALUE_X, state.y);

      state.y += Math.max(blockH, labelLines.length * 4.1) + 1.6;
    }

    function paragraphBlock(label, value) {
      doc.setFont(FAMILY, famStyle('bold'));
      doc.setFontSize(7.5);
      var head = label.toUpperCase();
      need(12);
      setColor(doc, GREY);
      doc.text(head, ML, state.y, { charSpace: 0.4 });
      state.y += 4.4;

      doc.setFont(FAMILY, famStyle('normal'));
      doc.setFontSize(9.5);
      setColor(doc, INK);
      var lines = doc.splitTextToSize(value, CW);
      lines.forEach(function (line) {
        need(5);
        doc.text(line, ML, state.y);
        state.y += 4.5;
      });
      state.y += 1.6;
    }

    /* "Residential address", "Citizenship" — the same dividers the claimant
       saw on screen, so the PDF reads in the order they filled it in. */
    function subHeading(label) {
      need(12);
      state.y += 2.5;
      doc.setFont(FAMILY, famStyle('bold'));
      doc.setFontSize(7.5);
      setColor(doc, MID);
      doc.text(label.toUpperCase(), ML, state.y, { charSpace: 0.4 });
      state.y += 4.4;
    }

    /* Dependants, employers, qualifications, witnesses, hospitals. Each entry
       is numbered, so two dependants cannot be read as one. */
    function repeatBlock(f, entries) {
      if (!entries.length) { labelledRow(f.l, '—'); return; }
      entries.forEach(function (entry, i) {
        need(14);
        state.y += 1.5;
        doc.setFont(FAMILY, famStyle('bold'));
        doc.setFontSize(7.5);
        setColor(doc, ACCENT);
        doc.text((f.itemLabel + ' ' + (i + 1)).toUpperCase(), ML, state.y, { charSpace: 0.4 });
        state.y += 4.3;

        f.sub.forEach(function (sub) {
          var text = entry[sub.k];
          if (Array.isArray(text)) text = text.join(', ');
          if (!text) return;
          labelledRow(sub.l, String(text));
        });
        state.y += 1.8;
      });
    }

    function emptyNote(text) {
      doc.setFont(FAMILY, famStyle('italic'));
      doc.setFontSize(9);
      setColor(doc, GREY);
      need(6);
      doc.text(text, ML, state.y);
      doc.setFont(FAMILY, famStyle('normal'));
      state.y += 5.5;
    }

    /* ── Page one onwards: the answers ──────────────────────────────── */
    newPage();

    var entries = record.entries || {};
    var hidden = record.hidden || {};
    var reportDocs = record.reportDocs || [];
    var certDocs = record.certDocs || [];

    record.sections.forEach(function (sec, i) {
      /* A question the claimant was never shown — a nationality for a South
         African, a driver's details for someone who was driving — is not an
         unanswered question. It is not on their form at all. */
      var shown = sec.f.filter(function (f) { return !hidden[f.k]; });
      var textFields = shown.filter(function (f) { return SIMPLE.indexOf(f.t) !== -1; });
      var answered = textFields.filter(function (f) { return !!v[f.k]; });
      var filledRepeats = shown.filter(function (f) {
        return f.t === 'm' && (entries[f.k] || []).length;
      });
      var hasMedia = shown.some(function (f) { return ['p', 'd', 'k', 'g'].indexOf(f.t) !== -1; });

      sectionHeading(String(i + 1).padStart(2, '0'), sec.n);

      if (!answered.length && !filledRepeats.length && !hasMedia) {
        emptyNote('No information supplied.');
        return;
      }

      shown.forEach(function (f) {
        if (f.t === 'h') { subHeading(f.l); return; }
        if (f.t === 'm') { repeatBlock(f, entries[f.k] || []); return; }
        if (SIMPLE.indexOf(f.t) === -1) return;
        var value = v[f.k] || '';
        if (f.t === 'a') {
          if (value) paragraphBlock(f.l, value);
          else labelledRow(f.l, '—');
        } else {
          labelledRow(f.l, value || '—');
        }
      });

      if (sec.id === 'police' && reportDocs.length) {
        emptyNote(reportDocs.length + (reportDocs.length === 1
          ? ' page of the accident report is attached at the end of this document.'
          : ' pages of the accident report are attached at the end of this document.'));
      }

      if (sec.id === 'documents') {
        emptyNote(certDocs.length
          ? certDocs.length + (certDocs.length === 1
            ? ' document is attached at the end of this document: ' + certDocs[0].label + '.'
            : ' documents are attached at the end of this document: '
              + certDocs.map(function (d) { return d.label; }).join(', ') + '.')
          : 'No supporting documents were supplied.');
      }

      if (sec.id === 'photos') {
        emptyNote(record.photos.length
          ? record.photos.length + (record.photos.length === 1
            ? ' photograph is attached at the end of this document.'
            : ' photographs are attached at the end of this document.')
          : 'No photographs were supplied.');
      }
      if (sec.id === 'sketch' && !record.sketch) emptyNote('No sketch was supplied.');
    });

    /* ── Declaration and signature ──────────────────────────────────── */
    need(58);
    state.y += 4;
    doc.setFont(FAMILY, famStyle('bold'));
    doc.setFontSize(8);
    setColor(doc, MID);
    doc.text('DECLARATION', ML, state.y, { charSpace: 0.55 });
    state.y += 3.4;
    rule(doc, state.y, HAIRLINE, 0.2);
    state.y += 5;

    doc.setFont(FAMILY, famStyle('normal'));
    doc.setFontSize(9);
    setColor(doc, INK);
    var declaration = 'I confirm that the information given in this form is true and correct to the best of my knowledge, '
      + 'and that it is supplied freely and voluntarily to Dr Pretorius Inc for the purpose of preparing a '
      + 'report in connection with a claim for loss of support arising from the death of the person named above. '
      + 'I confirm that every person who depended on the deceased for support has been listed in this form.';
    doc.splitTextToSize(declaration, CW).forEach(function (line) {
      doc.text(line, ML, state.y);
      state.y += 4.4;
    });

    state.y += 6;
    var signBoxW = 78;
    var signBoxH = 24;
    if (record.signature) {
      try {
        var sp = doc.getImageProperties(record.signature);
        var sh = Math.min(signBoxH, signBoxW * (sp.height / sp.width));
        doc.addImage(record.signature, 'PNG', ML, state.y + (signBoxH - sh), signBoxW, sh);
      } catch (err) { /* an unreadable signature must not stop the document */ }
    }
    state.y += signBoxH + 1;
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.25);
    doc.line(ML, state.y, ML + signBoxW, state.y);
    doc.line(PAGE_W - MR - 52, state.y, PAGE_W - MR, state.y);

    state.y += 4;
    doc.setFontSize(8);
    setColor(doc, GREY);
    var signCaption = 'Signature';
    if (!record.signature) signCaption += ' — not captured';
    else if (record.signatureTyped) signCaption += ' — typed by the claimant';
    doc.text(signCaption, ML, state.y);
    doc.text('Date', PAGE_W - MR - 52, state.y);

    doc.setFontSize(9.5);
    setColor(doc, INK);
    if (v.signName) doc.text(v.signName, ML, state.y + 4.6);
    if (v.signDate) doc.text(v.signDate, PAGE_W - MR - 52, state.y + 4.6);

    /* Who signed, and on whose behalf. A loss of support form is often signed
       by a widow for herself and for minor children, and the file has to say
       so on the page where the signature is, not twenty pages earlier. */
    if (v.signCapacity) {
      doc.setFontSize(8);
      setColor(doc, GREY);
      doc.text('Signing as: ' + v.signCapacity, ML, state.y + 9.4);
    }

    /* ── Attachments ────────────────────────────────────────────────── */
    function attachmentPage(title) {
      newPage();
      doc.setFont(FAMILY, famStyle('bold'));
      doc.setFontSize(8);
      setColor(doc, MID);
      doc.text(title.toUpperCase(), ML, state.y, { charSpace: 0.55 });
      state.y += 3.4;
      rule(doc, state.y, HAIRLINE, 0.2);
      state.y += 6;
    }

    function placeImage(dataUrl, caption, maxH) {
      var props;
      try { props = doc.getImageProperties(dataUrl); } catch (err) { return; }
      var w = CW;
      var h = w * (props.height / props.width);
      if (h > maxH) { h = maxH; w = h * (props.width / props.height); }

      if (state.y + h + 10 > BOTTOM_LIMIT) {
        newPage();
        state.y += 2;
      }

      var x = ML + (CW - w) / 2;
      doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
      doc.setLineWidth(0.25);
      doc.rect(x - 1.2, state.y - 1.2, w + 2.4, h + 2.4);
      try {
        doc.addImage(dataUrl, props.fileType === 'PNG' ? 'PNG' : 'JPEG', x, state.y, w, h);
      } catch (err) { return; }
      state.y += h + 4.5;

      doc.setFont(FAMILY, famStyle('normal'));
      doc.setFontSize(8.5);
      setColor(doc, GREY);
      doc.text(caption, ML, state.y);
      state.y += 8;
    }

    if (certDocs.length) {
      attachmentPage('Supporting documents supplied by the claimant');
      certDocs.forEach(function (page) {
        placeImage(page.dataUrl, page.label, 205);
      });
    }

    if (reportDocs.length) {
      attachmentPage('Accident report supplied by the claimant');
      reportDocs.forEach(function (page) {
        placeImage(page.dataUrl, 'Accident report — ' + page.label, 205);
      });
    }

    if (record.photos.length) {
      attachmentPage('Photographs supplied by the claimant');
      record.photos.forEach(function (photo, i) {
        placeImage(photo.dataUrl, 'Photograph ' + (i + 1) + ' — ' + photo.label, 104);
      });
    }

    /* The notes on the sketch already appear with the sketch section, so they
       are not repeated here. */
    if (record.sketch) {
      attachmentPage('Sketch of the scene');
      placeImage(record.sketch, 'Sketch as drawn by the claimant', 150);
    }

    /* ── Footers, once the page count is known ──────────────────────── */
    var total = doc.internal.getNumberOfPages();
    for (var p = 1; p <= total; p++) {
      doc.setPage(p);
      rule(doc, FOOTER_RULE_Y, HAIRLINE, 0.2);
      doc.setFont(FAMILY, famStyle('normal'));
      doc.setFontSize(7.5);
      setColor(doc, GREY);
      doc.text(FOOTER_TEXT, ML, FOOTER_RULE_Y + 4.2);
      doc.text('Page ' + p + ' of ' + total, PAGE_W - MR, FOOTER_RULE_Y + 4.2, { align: 'right' });

      /* ALLISON-forms-015. An example report carried no mark of any kind and
         was indistinguishable from a real submission — in a medico-legal file
         that is a data-integrity problem, not a cosmetic one. Band every page,
         above the content, so it cannot be cropped off or missed. */
      if (record.isExample) {
        doc.setFillColor(176, 32, 32);
        doc.rect(0, 0, PAGE_W, 7.5, 'F');
        doc.setFont(FAMILY, famStyle('bold'));
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.text('EXAMPLE — NOT A REAL SUBMISSION', PAGE_W / 2, 5.2, { align: 'center' });
        setColor(doc, GREY);
      }
    }

    return doc;
  }

  window.DrPretoriusLossOfSupportPDF = {
    build: build,
    unprintable: unprintable,
    ensureUnicodeFont: ensureUnicodeFont,
    usingUnicodeFont: function () { return FAMILY !== 'helvetica'; }
  };
})();
