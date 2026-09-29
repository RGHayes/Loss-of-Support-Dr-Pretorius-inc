/* ============================================================================
   Builds the Loss of Support PDF that goes to Savage Jooste & Adams.

   A4 portrait, the firm's letterhead on page one, a compact running head on
   the pages after it, the logo watermark on every page, and a confidential
   footer with page numbers. The certificates, the accident report, the
   photographs, the scene sketch and the signature are appended as the closing
   pages, each set under its own heading.

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
                       Every addImage argument below is a canvas data URL, a
                       data URL already validated against IMAGE_DATA_RE in
                       app.js, or the same-origin logo element. Never a path.

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
  var ACCENT = [27, 83, 151];
  var HAIRLINE = [205, 207, 209];

  var FOOTER_TEXT = 'Savage Jooste & Adams Inc.  ·  Confidential  ·  Attorney–client privileged';

  /* The logo, and the full-page watermark derived from it, are prepared once
     when the page loads so that building the PDF stays synchronous. */
  var logoImg = null;
  var logoRatio = 800 / 131;
  var watermark = null;

  function prepareAssets() {
    var img = new Image();
    img.onload = function () {
      logoImg = img;
      logoRatio = img.width / img.height;
      watermark = renderWatermark(img);
    };
    img.src = 'sja-logo.jpg';
  }

  /* A full-page, white-ground JPEG carrying the logo rotated and faded back.
     Drawn first on every page, so the content always sits over it. */
  function renderWatermark(img) {
    try {
      var w = 900;
      var h = Math.round(w * (PAGE_H / PAGE_W));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      var markW = w * 1.12;
      var markH = markW / (img.width / img.height);
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-24 * Math.PI / 180);
      ctx.globalAlpha = 0.13;
      ctx.drawImage(img, -markW / 2, -markH / 2, markW, markH);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch (err) {
      return null;
    }
  }

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
    doc.setProperties({
      title: 'Loss of Support Form',
      subject: 'Client intake — Savage Jooste & Adams',
      creator: 'Savage Jooste & Adams loss of support form'
    });

    var v = record.values;
    /* The deceased names the file, not the person who filled it in: that is
       how the firm, the Fund and the court all refer to the matter. The
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

    function paintWatermark() {
      if (!watermark) return;
      try {
        doc.addImage(watermark, 'JPEG', 0, 0, PAGE_W, PAGE_H, 'sja-watermark', 'FAST');
      } catch (err) { /* a missing watermark must never stop the form */ }
    }

    function drawLetterhead() {
      var logoW = 46;
      var logoH = logoW / logoRatio;
      if (logoImg) {
        try { doc.addImage(logoImg, 'JPEG', PAGE_W - MR - logoW, 14, logoW, logoH, 'sja-logo', 'FAST'); }
        catch (err) { /* carry on without it */ }
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      setColor(doc, ACCENT);
      doc.text('CLIENT INTAKE', ML, 18, { charSpace: 0.6 });

      doc.setFontSize(17);
      setColor(doc, INK);
      doc.text('Loss of Support Form', ML, 25.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      setColor(doc, MID);
      doc.text(meta, ML, 30.5);
      if (meta2) doc.text(meta2, ML, 34.6);

      rule(doc, meta2 ? 38.6 : 34.5, ACCENT, 0.5);
      state.y = meta2 ? 46 : 42;
    }

    function drawRunningHead() {
      var logoW = 30;
      var logoH = logoW / logoRatio;
      if (logoImg) {
        try { doc.addImage(logoImg, 'JPEG', PAGE_W - MR - logoW, 12, logoW, logoH, 'sja-logo', 'FAST'); }
        catch (err) { /* carry on without it */ }
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      setColor(doc, INK);
      doc.text('Loss of Support Form', ML, 16.5);
      doc.setFont('helvetica', 'normal');
      setColor(doc, MID);
      var runner = [deceased ? 'Late ' + deceased : '', ref].filter(Boolean).join('  ·  ');
      if (runner) doc.text(runner, ML + 46, 16.5);
      rule(doc, 20, HAIRLINE, 0.2);
      state.y = 27;
    }

    function newPage() {
      state.page += 1;
      if (state.page > 1) doc.addPage();
      paintWatermark();
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
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      setColor(doc, MID);
      doc.text(number + '  ·  ' + name.toUpperCase(), ML, state.y, { charSpace: 0.55 });
      state.y += 3.4;
      rule(doc, state.y, HAIRLINE, 0.2);
      state.y += 4.6;
    }

    function labelledRow(label, value) {
      doc.setFont('helvetica', 'normal');
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
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      var head = label.toUpperCase();
      need(12);
      setColor(doc, GREY);
      doc.text(head, ML, state.y, { charSpace: 0.4 });
      state.y += 4.4;

      doc.setFont('helvetica', 'normal');
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
      doc.setFont('helvetica', 'bold');
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
        doc.setFont('helvetica', 'bold');
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
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      setColor(doc, GREY);
      need(6);
      doc.text(text, ML, state.y);
      doc.setFont('helvetica', 'normal');
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
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setColor(doc, MID);
    doc.text('DECLARATION', ML, state.y, { charSpace: 0.55 });
    state.y += 3.4;
    rule(doc, state.y, HAIRLINE, 0.2);
    state.y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setColor(doc, INK);
    var declaration = 'I confirm that the information given in this form is true and correct to the best of my knowledge, '
      + 'and that it is supplied freely and voluntarily to Savage Jooste & Adams for the purpose of assessing and '
      + 'administering a claim for loss of support arising from the death of the person named above. '
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
      doc.setFont('helvetica', 'bold');
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

      doc.setFont('helvetica', 'normal');
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
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      setColor(doc, GREY);
      doc.text(FOOTER_TEXT, ML, FOOTER_RULE_Y + 4.2);
      doc.text('Page ' + p + ' of ' + total, PAGE_W - MR, FOOTER_RULE_Y + 4.2, { align: 'right' });
    }

    return doc;
  }

  window.SJALossOfSupportPDF = { build: build };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepareAssets);
  else prepareAssets();
})();
