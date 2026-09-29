/* ============================================================================
   Dr Pretorius Inc — Loss of Support Form

   The whole form lives in this file. Nothing is written to localStorage,
   sessionStorage, cookies or IndexedDB: answers exist only in this page's
   memory until the claimant either saves a progress file to their own device
   or presses send. Reloading the page clears everything.

   The only network call the page ever makes is the POST to SEND_ENDPOINT,
   which carries the finished PDF. The content security policy in _headers
   enforces that — connect-src is 'self' and nothing else.

   Built on the engine proved by the practice's Accident Information Form,
   with three things this document needs that that one did not:

     · every question is about one of THREE people — the person filling the
       form in, the deceased, and each dependant — so the wording of every
       label says which;
     · more than one set of document slots (the accident report, and the
       certificates a loss of support claim stands or falls on), so `t: 'd'`
       now names the set it belongs to;
     · an alert line at the top of a section, drawn in capitals.
   ========================================================================= */
(function () {
  'use strict';

  /* ── Configuration ─────────────────────────────────────────────────────
     The example-data generator is a testing aid, and its passcode is readable
     in this file, so it must not be here when the link goes to a client.

       'localhost'  shows it only when served from a development machine
       true         shows it everywhere, including the deployed site
       false        never shows it

     CURRENTLY true, at Richard's request, matching the practice's accident
     form: the deployed site can then be demonstrated to the practice from its
     real URL. The cost is stated plainly in the README — anyone who reads the
     page source has the passcode, and can post a fabricated form to the
     practice (rate-limited, and only ever to an allowlisted address). */
  var SHOW_DEMO_BUTTON = true;
  var DEMO_PASSCODE = '2190';

  function demoAllowed() {
    if (SHOW_DEMO_BUTTON === true) return true;
    if (SHOW_DEMO_BUTTON !== 'localhost') return false;
    var host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '' || /\.local$/.test(host);
  }

  var SEND_ENDPOINT = '/api/send-form';
  var RECIPIENTS_ENDPOINT = '/api/form-recipients';

  /* Version 1: this form has never shipped, so there is no older file shape to
     be compatible with. Bump it the moment a question changes, and a file
     saved against the old questions is refused by name rather than being
     half-restored into the wrong boxes. */
  var DRAFT_VERSION = 1;
  var DRAFT_APP_ID = 'dr-pretorius-loss-of-support';
  var DRAFT_FILENAME = 'DrPretorius-loss-of-support-progress.json';

  /* Netlify runs synchronous functions with a 6 MB request limit and base64
     inflates by a third, so the PDF itself has to stay well under that. */
  var MAX_PDF_BYTES = 4 * 1024 * 1024;
  var PHOTO_MAX_EDGE = 1400;
  var PHOTO_TARGET_BYTES = 320 * 1024;
  /* A page of a document is read, not looked at, so it keeps more detail. */
  var DOC_MAX_EDGE = 1800;
  var DOC_TARGET_BYTES = 420 * 1024;
  var MAX_TEXT = 200;
  var MAX_AREA = 3000;
  /* A ceiling on repeatable entries. It is generous for a real family and it
     stops a crafted progress file from building a million-row form. */
  var MAX_ENTRIES = 25;

  /* Read before decoding. A 40-megapixel photograph or a mistakenly chosen
     video will be reduced to a few hundred KB by the time it is attached, but
     FileReader has to hold the original in memory first, and on the sort of
     phone this form is actually filled in on that is what makes the tab die
     with no explanation. Refusing it with a sentence is kinder. */
  var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  /* Who a completed form may be sent to — the FALLBACK menu, used only until
     the console answers, or for good if it never does. This list is only a
     menu either way: the server holds the real allowlist and refuses anything
     that is not on it, so editing this list in the browser achieves nothing. */
  /* 'Admin Test' <richard@iftfc.com> was removed on 2026-09-29: iftfc.com has
     been retired, so it was a dead address sitting in a claimant-facing menu.
     This is the fallback menu only — the server holds the real allowlist and
     the console is the source of truth once wired. (STEVE-eco-002) */
  /* CARL-drplos-008. This list is what the page offers when the recipients
     endpoint does not answer, and in three of the four apps it held exactly one
     address: the OPERATOR's. So during an outage a claimant's completed form —
     accident details, medical particulars, a bereaved family's circumstances —
     was offered to IFTFC rather than to the instructing firm, and the server
     accepted it. That is a misdelivery by default, not a fallback.
     It is the firm's own intake address now. The console still governs the real
     list; this only ever applies while the console cannot be reached, and the
     RECIPIENT_DOMAINS floor on the form site still bounds it either way.
     Richard's own address is deliberately NOT here: he confirmed on
     29 September 2026 that he is only a recipient while the forms are being
     tested and that it falls away as each firm's addresses are added. */
  var RECIPIENTS = [
    { label: 'Dr Pretorius Inc — Admin', email: 'admin@drpretoriusinc.co.za' },
    { label: 'Dr Pretorius Inc — Richard H', email: 'richardh@drpretoriusinc.co.za' }
  ];

  var PHOTO_SLOTS = [
    { id: 'scene', label: 'The scene' },
    { id: 'vehicle', label: 'Vehicle involved' },
    { id: 'otherVehicle', label: 'Other vehicle' },
    { id: 'damage', label: 'Damage' },
    { id: 'documents', label: 'Documents' },
    { id: 'otherPhoto', label: 'Other' }
  ];

  /* Scanned or photographed paper, in named sets. Kept apart from the
     photographs because they are a different kind of thing: they are read, so
     they are compressed less and printed larger.

     A loss of support claim turns on documents the practice has to see, which is
     why there are two sets here where the accident form had one. Slot ids are
     unique across every set, because they share one store. */
  var DOC_SETS = {
    report: [
      { id: 'reportPage1', label: 'Page 1' },
      { id: 'reportPage2', label: 'Page 2' },
      { id: 'reportPage3', label: 'Page 3' },
      { id: 'reportPage4', label: 'Page 4' }
    ],
    certs: [
      { id: 'certDeath', label: 'Death certificate' },
      { id: 'certDeceasedId', label: 'Deceased’s ID' },
      { id: 'certMarriage', label: 'Marriage certificate' },
      { id: 'certBirth', label: 'Birth certificate' },
      { id: 'certFuneral', label: 'Funeral account' },
      { id: 'certOther', label: 'Other document' }
    ]
  };

  var TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Adv', 'Rev', 'Other'];
  var GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

  /* The Employment Equity Act / Statistics South Africa categories, which are
     the ones an actuary and the Fund both work from. Never required, and
     "Prefer not to say" is a real answer: race is SPECIAL personal information
     under section 26 of POPIA and may only be processed on a listed ground.
     See privacy.html, which states the ground and the purpose. */
  var RACES = ['Black African', 'Coloured', 'Indian or Asian', 'White', 'Other', 'Prefer not to say'];

  var MARITAL = ['Single', 'Married (civil)', 'Married (customary)', 'Married (religious rites)',
    'Life partner', 'Divorced', 'Widow or widower', 'Separated', 'Minor child'];

  var RELATIONSHIPS = ['Spouse', 'Customary spouse', 'Life partner', 'Son', 'Daughter',
    'Stepson', 'Stepdaughter', 'Mother', 'Father', 'Brother', 'Sister',
    'Grandchild', 'Grandparent', 'Other relative', 'Other'];

  var PROVINCES = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
    'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Outside South Africa'];

  /* The whole list rather than a short one plus "Other". A native select is
     a scrolling picker on a phone, so length costs nothing there, and it
     saves the practice having to interpret free text on a document that has to
     match a passport. South Africa and its neighbours are lifted to the top
     because that is who fills this form in. */
  var COUNTRIES = ['South Africa',
    'Botswana', 'Eswatini', 'Lesotho', 'Malawi', 'Mozambique', 'Namibia',
    'Zambia', 'Zimbabwe', '—',
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
    'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
    'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
    'Bolivia', 'Bosnia and Herzegovina', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
    'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Central African Republic',
    'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo (Brazzaville)',
    'Congo (Democratic Republic)', 'Costa Rica', 'Côte d’Ivoire', 'Croatia', 'Cuba',
    'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
    'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
    'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany',
    'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
    'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq',
    'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya',
    'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Liberia', 'Libya',
    'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malaysia', 'Maldives',
    'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico',
    'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Myanmar',
    'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria',
    'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine',
    'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
    'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis',
    'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
    'São Tomé and Príncipe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
    'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia',
    'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden',
    'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste',
    'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Türkiye', 'Turkmenistan',
    'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
    'United States of America', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City',
    'Venezuela', 'Vietnam', 'Yemen', 'Other country not listed'];

  /* ── The form itself ───────────────────────────────────────────────────
     Twenty sections in six groups, in this order, with this wording.

       t = text            a = long answer      s = select
       r = one choice      c = several choices
       m = repeatable entries (f.sub holds the fields inside one entry)
       p = photographs     d = document pages (f.set names the slot set)
       k = sketch          g = signature        h = a heading inside a section

     showIf: [key, value]  the field appears only when that answer is given
                           (value may be an array — any one of them shows it)
     reqIf:  [key, value]  the field is required only when that answer is given
     hint:   a line of guidance printed under the control
     alert:  a line at the top of a SECTION, drawn in capitals

     Headings and alerts are stored in sentence case and drawn in capitals by
     the stylesheet, so that a screen reader still reads them as words rather
     than spelling them out letter by letter. Do not "fix" this by typing the
     strings in capitals. */
  var GROUPS = ['About you', 'The deceased', 'The accident', 'Support and loss', 'Evidence', 'Declaration'];

  var SECTIONS = [

    /* ── 1 ─ the person filling the form in ────────────────────────────── */
    { id: 'claimant', g: 'About you', n: 'Your own details', h: 'About you — the person completing this form. Exactly as they appear on your identity document.', f: [
      { k: 'title', l: 'Title', t: 's', o: TITLES },
      { k: 'firstName', l: 'Name', t: 't', req: 1, ph: 'e.g. Nomsa' },
      { k: 'surname', l: 'Surname', t: 't', req: 1, ph: 'e.g. Dlamini' },
      { k: 'dateOfBirth', l: 'Date of birth', t: 't', req: 1, ph: 'YYYY/MM/DD', im: 'numeric', dateMask: 1, ns: 1 },
      { k: 'gender', l: 'Gender', t: 's', o: GENDERS },

      { k: 'hdrCitizen', l: 'Citizenship', t: 'h', wide: 1 },
      { k: 'citizenship', l: 'Are you a South African citizen?', t: 'r', req: 1, wide: 1, o: ['South African', 'Foreign national'] },
      { k: 'idNumber', l: 'South African ID number', t: 't', req: 1, reqIf: ['citizenship', 'South African'], showIf: ['citizenship', 'South African'], ph: '13 digits', im: 'numeric', ns: 1 },
      { k: 'nationality', l: 'Your nationality', t: 't', req: 1, reqIf: ['citizenship', 'Foreign national'], showIf: ['citizenship', 'Foreign national'], ph: 'e.g. Zimbabwean' },
      { k: 'passportNumber', l: 'Passport or permit number', t: 't', showIf: ['citizenship', 'Foreign national'], ns: 1 },

      { k: 'hdrCapacity', l: 'Your claim', t: 'h', wide: 1 },
      { k: 'relationToDeceased', l: 'Your relationship to the deceased', t: 's', req: 1, o: RELATIONSHIPS },
      { k: 'claimCapacity', l: 'In what capacity are you claiming?', t: 'r', req: 1, wide: 1,
        o: ['In my own right as a dependant', 'On behalf of a minor child', 'As executor of the estate', 'Other'],
        hint: 'If you are claiming both for yourself and for a child, choose the first and list the child as a dependant in section 3.' },
      { k: 'claimCapacityOther', l: 'Please explain the capacity', t: 't', wide: 1, showIf: ['claimCapacity', 'Other'] },

      { k: 'hdrContact', l: 'How we reach you', t: 'h', wide: 1 },
      { k: 'email', l: 'Email address', t: 't', req: 1, ph: 'name@example.co.za', im: 'email', ns: 1 },
      { k: 'cell', l: 'Cell phone number', t: 't', req: 1, ph: 'e.g. 082 123 4567', im: 'tel', ns: 1 },
      { k: 'altCell', l: 'Alternative cell phone number', t: 't', ph: 'e.g. 073 555 0198', im: 'tel', ns: 1, hint: 'Another number we can try if the first one does not answer. A family member’s number is fine.' },

      { k: 'hdrAddress', l: 'Your residential address', t: 'h', wide: 1 },
      { k: 'addrComplex', l: 'Complex, unit or farm name', t: 't', ph: 'e.g. Unit 12, Rosepark' },
      { k: 'addrStreet', l: 'Street number and name', t: 't', ph: 'e.g. 14 Rosslyn Street' },
      { k: 'addrTown', l: 'Town or city', t: 't', ph: 'e.g. Pretoria' },
      { k: 'addrProvince', l: 'Province', t: 's', o: PROVINCES },
      { k: 'addrPostal', l: 'Postal code', t: 't', ph: 'e.g. 0186', im: 'numeric', ns: 1 } ] },

    /* ── 2 ─ the deceased ──────────────────────────────────────────────── */
    { id: 'deceased', g: 'The deceased', n: 'Personal details of the deceased', h: 'The person who died. Please copy these details from the death certificate and identity document so that they match exactly.', f: [
      { k: 'decTitle', l: 'Title', t: 's', o: TITLES },
      { k: 'decFirstName', l: 'Name', t: 't', req: 1, ph: 'e.g. Sipho' },
      { k: 'decSurname', l: 'Surname', t: 't', req: 1, ph: 'e.g. Dlamini' },
      { k: 'decDateOfBirth', l: 'Date of birth', t: 't', req: 1, ph: 'YYYY/MM/DD', im: 'numeric', dateMask: 1, ns: 1 },
      { k: 'decDateOfDeath', l: 'Date of death', t: 't', req: 1, ph: 'YYYY/MM/DD', im: 'numeric', dateMask: 1, ns: 1 },
      { k: 'decTimeOfDeath', l: 'Time of death', t: 't', ph: 'e.g. 21:15', ns: 1,
        hint: 'As recorded on the death certificate. If you do not know it, leave it blank.' },
      { k: 'decIdNumber', l: 'ID number', t: 't', req: 1, ph: '13 digits, or the passport number', ns: 1 },
      { k: 'decGender', l: 'Gender', t: 's', o: GENDERS },
      { k: 'decCountryBirth', l: 'Country of birth', t: 's', o: COUNTRIES },
      { k: 'decCountryResidence', l: 'Country of residence', t: 's', o: COUNTRIES },

      { k: 'hdrDecAddress', l: 'Residential address of the deceased', t: 'h', wide: 1 },
      { k: 'decAddrComplex', l: 'Complex, unit or farm name', t: 't', ph: 'e.g. Unit 12, Rosepark' },
      { k: 'decAddrStreet', l: 'Street number and name', t: 't', ph: 'e.g. 14 Rosslyn Street' },
      { k: 'decAddrTown', l: 'Town', t: 't', ph: 'e.g. Pretoria' },
      { k: 'decAddrProvince', l: 'Province', t: 's', o: PROVINCES },
      { k: 'decAddrPostal', l: 'Postal code', t: 't', ph: 'e.g. 0186', im: 'numeric', ns: 1 } ] },

    /* ── 3 ─ the dependants ────────────────────────────────────────────── */
    { id: 'dependants', g: 'The deceased', n: 'Personal details of the dependants',
      alert: 'All dependants of the deceased must be filled in.',
      h: 'Everyone who depended on the deceased for support — a spouse, every child, and any other person the deceased kept. Leaving one out can mean their claim is never brought.', f: [
      { k: 'dependantList', l: 'Dependants', t: 'm', wide: 1, req: 1,
        itemLabel: 'Dependant', addLabel: 'Add another dependant',
        empty: 'No dependant added yet.',
        hint: 'Add one entry for each dependant, including yourself if the deceased supported you. Use “Add another dependant” for the next one.',
        sub: [
          { k: 'title', l: 'Title', t: 's', o: TITLES },
          { k: 'name', l: 'Name', t: 't', ph: 'e.g. Lindiwe' },
          { k: 'surname', l: 'Surname', t: 't', ph: 'e.g. Dlamini' },
          { k: 'dateOfBirth', l: 'Date of birth', t: 't', ph: 'YYYY/MM/DD', im: 'numeric', dateMask: 1, ns: 1 },
          { k: 'idNumber', l: 'ID number', t: 't', ph: '13 digits, or a birth certificate number', ns: 1 },
          { k: 'race', l: 'Ethnic group or race', t: 's', o: RACES },
          { k: 'countryBirth', l: 'Country of birth', t: 's', o: COUNTRIES },
          { k: 'countryResidence', l: 'Country of residence', t: 's', o: COUNTRIES },
          { k: 'gender', l: 'Gender', t: 's', o: GENDERS },
          { k: 'relationship', l: 'Relationship to the deceased', t: 's', o: RELATIONSHIPS },
          { k: 'maritalStatus', l: 'Marital status', t: 's', o: MARITAL },
          { k: 'reasonDependence', l: 'Reason for dependence', t: 't', wide: 1,
            ph: 'e.g. Minor child at school; the deceased paid all school fees and household costs' } ] } ] },

    /* ── 4 ─ how the deceased was involved ─────────────────────────────────
       Richard's third change. The branch itself is final; the questions
       INSIDE each branch are PROVISIONAL — they are the ones an RAF file
       usually needs, put here so the branch can be seen working, and they are
       meant to be replaced with the practice's own list. Replacing them is a
       matter of editing the two blocks below; nothing else refers to them. */
    { id: 'involvement', g: 'The accident', n: 'How the deceased was involved', h: 'How the person who was injured or died came to be in the accident. The questions that follow change with your answer.', f: [
      { k: 'roadUser', l: 'Was the person injured or deceased a pedestrian or cyclist, or a driver or motorcyclist?', t: 'r', req: 1, wide: 1,
        o: ['Pedestrian or cyclist', 'Driver or motorcyclist'] },

      /* ---- Branch 1 · pedestrian or cyclist — PROVISIONAL ------------- */
      { k: 'hdrPed', l: 'As a pedestrian or cyclist', t: 'h', wide: 1, showIf: ['roadUser', 'Pedestrian or cyclist'] },
      { k: 'pedMode', l: 'Was the person walking or cycling?', t: 'r', wide: 1, showIf: ['roadUser', 'Pedestrian or cyclist'],
        o: ['Walking', 'Cycling', 'Standing still', 'Other'] },
      { k: 'pedPosition', l: 'Where were they at the moment of impact?', t: 's', wide: 1, showIf: ['roadUser', 'Pedestrian or cyclist'],
        o: ['On the pavement', 'Crossing at a pedestrian crossing', 'Crossing away from a crossing',
          'Walking in the road', 'Walking on the shoulder of the road', 'In a cycle lane',
          'At a traffic light', 'Other'] },
      { k: 'pedCrossing', l: 'Was there a crossing, traffic light or footbridge nearby?', t: 't', wide: 1, showIf: ['roadUser', 'Pedestrian or cyclist'],
        ph: 'e.g. A pedestrian crossing about 30 metres further on' },
      { k: 'pedVisibility', l: 'Were they wearing anything reflective, or was there a light on the bicycle?', t: 'r', wide: 1, showIf: ['roadUser', 'Pedestrian or cyclist'],
        o: ['Yes', 'No', 'Unsure'] },

      /* ---- Branch 2 · driver or motorcyclist — PROVISIONAL ------------ */
      { k: 'hdrDrv', l: 'As a driver or motorcyclist', t: 'h', wide: 1, showIf: ['roadUser', 'Driver or motorcyclist'] },
      { k: 'drvMode', l: 'Were they driving a vehicle or riding a motorcycle?', t: 'r', wide: 1, showIf: ['roadUser', 'Driver or motorcyclist'],
        o: ['Driving a vehicle', 'Riding a motorcycle'] },
      { k: 'drvVehicle', l: 'Make and model', t: 't', showIf: ['roadUser', 'Driver or motorcyclist'], ph: 'e.g. Silver Toyota Corolla' },
      { k: 'drvReg', l: 'Registration number', t: 't', showIf: ['roadUser', 'Driver or motorcyclist'], ns: 1 },
      { k: 'drvOwner', l: 'Was the deceased the owner of that vehicle?', t: 'r', showIf: ['roadUser', 'Driver or motorcyclist'], o: ['Yes', 'No', 'Unsure'] },
      { k: 'drvLicence', l: 'Did they hold a valid driving licence?', t: 'r', showIf: ['roadUser', 'Driver or motorcyclist'], o: ['Yes', 'No', 'Unsure'] },
      { k: 'drvLicenceCode', l: 'Licence code, if known', t: 't', showIf: ['roadUser', 'Driver or motorcyclist'], ph: 'e.g. Code EB', ns: 1 },
      { k: 'drvRestraint', l: 'Was a seatbelt or a helmet being worn?', t: 'r', wide: 1, showIf: ['roadUser', 'Driver or motorcyclist'],
        o: ['Yes', 'No', 'Unsure'] },
      { k: 'drvPassengers', l: 'Was anyone else in or on the vehicle?', t: 'a', wide: 1, showIf: ['roadUser', 'Driver or motorcyclist'],
        ph: 'Their names and what happened to them, if you know' } ] },

    /* ── 5 ─ when ──────────────────────────────────────────────────────── */
    { id: 'when', g: 'The accident', n: 'Date and time of the accident', h: 'When the accident happened, and when the person died.', f: [
      { k: 'claimRef', l: 'Claim or reference number', t: 't', ph: 'e.g. RAF-2026-00456', ns: 1,
        hint: 'Only fill this in if applicable. Leave it blank if you have not been given a reference.' },
      { k: 'accidentDate', l: 'Date of accident', t: 't', req: 1, ph: 'YYYY/MM/DD', im: 'numeric', dateMask: 1, ns: 1 },
      { k: 'accidentTime', l: 'Approximate time', t: 't', ph: 'e.g. 17:40', ns: 1 },
      { k: 'diedAtScene', l: 'Did the deceased die at the scene?', t: 'r', req: 1, wide: 1, o: ['Yes', 'No', 'Unsure'] },
      { k: 'diedWhere', l: 'Where did they die?', t: 't', wide: 1, showIf: ['diedAtScene', ['No', 'Unsure']],
        ph: 'e.g. Steve Biko Academic Hospital, Pretoria' },
      { k: 'diedHowLater', l: 'How long after the accident did they die?', t: 't', wide: 1, showIf: ['diedAtScene', ['No', 'Unsure']],
        ph: 'e.g. Four days later' } ] },

    /* ── 6 ─ where ─────────────────────────────────────────────────────── */
    { id: 'location', g: 'The accident', n: 'Location and conditions', h: 'Where it happened, and what the road was like.', f: [
      { k: 'road', l: 'Road or street', t: 't', req: 1, ph: 'e.g. Lynnwood Road' },
      { k: 'suburb', l: 'Suburb or town', t: 't', req: 1 },
      { k: 'province', l: 'Province', t: 's', o: PROVINCES },
      { k: 'conditions', l: 'Conditions at the time', t: 'c', wide: 1, o: ['Daylight', 'Dark', 'Raining', 'Wet road', 'Fog', 'Roadworks'] } ] },

    /* ── 7 ─ how ───────────────────────────────────────────────────────── */
    { id: 'how', g: 'The accident', n: 'How it happened', h: 'In your own words. Include as much detail as you know, even if you were not there yourself.', f: [
      { k: 'description', l: 'Description of the accident', t: 'a', req: 1, wide: 1, ph: 'Describe how, when and where the accident happened…' },
      { k: 'informationFrom', l: 'Where does this account come from?', t: 'r', wide: 1,
        o: ['I saw it happen', 'From a witness', 'From the police', 'From the hospital', 'From family', 'Other'] },
      { k: 'direction', l: 'Direction the deceased was travelling', t: 't', ph: 'e.g. north on Lynnwood Road' },
      { k: 'speed', l: 'Approximate speed, if known', t: 't', ph: 'e.g. 60 km/h' } ] },

    /* ── 8 ─ the other driver ──────────────────────────────────────────── */
    { id: 'other', g: 'The accident', n: 'Other driver and vehicle', h: 'The driver who caused the accident, and anything that was recorded at the scene.', f: [
      { k: 'otherName', l: 'Driver’s name', t: 't' },
      { k: 'otherContact', l: 'Contact number', t: 't', im: 'tel', ns: 1 },
      { k: 'otherVehicleDesc', l: 'Make and model', t: 't', ph: 'e.g. white Toyota Hilux' },
      { k: 'otherReg', l: 'Registration number', t: 't', ns: 1 },
      { k: 'otherInsurer', l: 'Their insurer, if known', t: 't' },
      { k: 'otherOutcome', l: 'Was the other driver injured?', t: 'r', wide: 1,
        o: ['Severely injured', 'Partially injured', 'Not injured', 'Deceased', 'Unknown'] },
      { k: 'hitAndRun', l: 'Did the other driver stop at the scene?', t: 'r', wide: 1, o: ['Yes', 'No', 'Unsure'] } ] },

    /* ── 9 ─ the police ────────────────────────────────────────────────── */
    { id: 'police', g: 'The accident', n: 'Police, case number and inquest', h: 'The station that attended, the case reference, and the report itself if you have it.', f: [
      { k: 'station', l: 'Police station', t: 't' },
      { k: 'officer', l: 'Officer’s name', t: 't' },
      { k: 'caseNumber', l: 'Case number', t: 't', ph: 'e.g. 412/09/2026', ns: 1 },
      { k: 'inquestHeld', l: 'Has an inquest been opened?', t: 'r', wide: 1, o: ['Yes', 'No', 'Unsure'] },
      { k: 'inquestNumber', l: 'Inquest number', t: 't', showIf: ['inquestHeld', 'Yes'], ns: 1 },
      { k: 'chargesLaid', l: 'Has anyone been charged?', t: 'r', wide: 1, o: ['Yes', 'No', 'Unsure'] },
      { k: 'reportObtained', l: 'Have you obtained an accident report and case number?', t: 'r', wide: 1, o: ['Yes', 'No', 'Not yet'] },
      { k: 'reportPages', l: 'Upload the accident report', t: 'd', set: 'report', wide: 1, showIf: ['reportObtained', 'Yes'] } ] },

    /* ── 10 ─ witnesses ────────────────────────────────────────────────── */
    { id: 'witnesses', g: 'The accident', n: 'Witnesses', h: 'Anyone who saw the accident happen. Add as many as you can.', f: [
      { k: 'witnessList', l: 'Witnesses', t: 'm', wide: 1,
        itemLabel: 'Witness', addLabel: 'Add another witness',
        empty: 'No witness added yet.',
        sub: [
          { k: 'name', l: 'Name', t: 't' },
          { k: 'surname', l: 'Surname', t: 't' },
          { k: 'contact', l: 'Contact number', t: 't', im: 'tel', ns: 1 },
          { k: 'statement', l: 'Did they give a statement to the police?', t: 'r', wide: 1, o: ['Yes', 'No', 'Unsure'] } ] } ] },

    /* ── 11 ─ the deceased's schooling ─────────────────────────────────── */
    { id: 'education', g: 'Support and loss', n: 'Education of the deceased', h: 'What the deceased studied. This is part of what an actuary uses to work out what they would have gone on to earn.', f: [
      { k: 'decHighestGrade', l: 'Highest grade passed', t: 't', ph: 'e.g. Grade 12' },
      { k: 'decSchoolName', l: 'School name', t: 't' },
      { k: 'decYearLeft', l: 'Year they left school', t: 't', ph: 'e.g. 2009', im: 'numeric' },

      { k: 'hdrDecQuals', l: 'Post-school qualifications', t: 'h', wide: 1 },
      { k: 'decQualifications', l: 'Qualifications completed after school', t: 'm', wide: 1,
        itemLabel: 'Qualification', addLabel: 'Add another qualification',
        empty: 'Nothing added yet. If the deceased did not study after school, leave this empty.',
        hint: 'Add each certificate, diploma or degree separately.',
        sub: [
          { k: 'name', l: 'Qualification', t: 't', ph: 'e.g. National Diploma: Logistics' },
          { k: 'institution', l: 'Where they studied', t: 't', ph: 'e.g. Tshwane University of Technology' },
          { k: 'year', l: 'Year completed', t: 't', ph: 'e.g. 2013', im: 'numeric' } ] } ] },

    /* ── 12 ─ the deceased's work ──────────────────────────────────────── */
    { id: 'work', g: 'Support and loss', n: 'Employment and earnings of the deceased', h: 'Please list every employer the deceased worked for, the most recent one first. Give as much detail as you can — this is what shows the court what the family has lost.', f: [
      { k: 'decWorkStatus', l: 'What was the deceased doing at the time of death?', t: 'r', req: 1, wide: 1,
        o: ['Employed', 'Self-employed', 'Informally employed', 'Unemployed', 'Pensioner', 'Scholar or student', 'Other'] },
      { k: 'decWorkStatusOther', l: 'Please explain', t: 't', wide: 1, showIf: ['decWorkStatus', 'Other'] },
      { k: 'decEmployment', l: 'Employers', t: 'm', wide: 1,
        itemLabel: 'Employer', addLabel: 'Add another employer',
        empty: 'No employer added yet.',
        hint: 'Add every employer, including work done for a short time or paid for in cash.',
        sub: [
          { k: 'employer', l: 'Employer name', t: 't', ph: 'e.g. Bidvest Logistics' },
          { k: 'period', l: 'Years employed', t: 't', ph: 'e.g. 2019 – 2026' },
          { k: 'position', l: 'Position held', t: 't', ph: 'e.g. Warehouse supervisor' },
          { k: 'remuneration', l: 'Gross remuneration', t: 't', ph: 'e.g. R14 500 per month' },
          { k: 'reasonLeft', l: 'Reason for leaving', t: 't', wide: 1, ph: 'e.g. Still employed there at the time of death' } ] },

      { k: 'hdrOtherIncome', l: 'Any other income', t: 'h', wide: 1 },
      { k: 'decOtherIncome', l: 'Other income the deceased received', t: 'a', wide: 1,
        ph: 'e.g. A disability grant of R2 090 a month, and rent of R1 500 from a back room',
        hint: 'Grants, a pension, rent, piece work, a side business — anything that came into the household.' } ] },

    /* ── 13 ─ the support itself ───────────────────────────────────────── */
    { id: 'support', g: 'Support and loss', n: 'The support the deceased provided', h: 'What the deceased actually paid for, and what has happened to the household since. This is the heart of the claim.', f: [
      { k: 'breadwinner', l: 'Was the deceased the main breadwinner?', t: 'r', req: 1, wide: 1,
        o: ['Yes, the only income', 'Yes, the main income', 'Shared equally', 'No, a smaller part'] },
      { k: 'supportAmount', l: 'What did the deceased contribute to the household each month?', t: 't',
        ph: 'e.g. About R11 000 a month' },
      { k: 'supportHowPaid', l: 'How was that support given?', t: 'c', wide: 1,
        o: ['Cash', 'Bank transfer', 'Paid the accounts directly', 'Groceries and goods', 'Rent or bond', 'School fees', 'Other'] },
      { k: 'supportDetail', l: 'What did the deceased pay for?', t: 'a', req: 1, wide: 1,
        ph: 'e.g. The rent, the electricity, the school fees for both children, and the groceries every month…' },
      { k: 'sharedHome', l: 'Did the deceased live with the dependants?', t: 'r', wide: 1, o: ['Yes', 'No', 'Some of them'] },
      { k: 'incomeNow', l: 'What income does the household have now?', t: 'a', wide: 1,
        ph: 'e.g. A child support grant of R560 for each child, and nothing else' },
      { k: 'sinceDeath', l: 'How has the family managed since the death?', t: 'a', wide: 1,
        ph: 'e.g. We moved in with my mother in August because we could no longer pay the rent…',
        hint: 'Rent or school fees you can no longer pay, a home you had to leave, a child taken out of school — please say so plainly.' } ] },

    /* ── 14 ─ medical ──────────────────────────────────────────────────── */
    { id: 'medical', g: 'Support and loss', n: 'Medical treatment and cause of death', h: 'Where the deceased was taken, who treated them, and what the death certificate records.', f: [
      { k: 'transport', l: 'How was the deceased taken from the scene?', t: 'r', wide: 1,
        o: ['Ambulance', 'Airlifted', 'Police', 'Private vehicle', 'Not moved from the scene', 'Other', 'Unsure'] },
      { k: 'careList', l: 'Hospitals and doctors', t: 'm', wide: 1,
        itemLabel: 'Hospital or doctor', addLabel: 'Add another hospital or doctor',
        empty: 'No hospital or doctor added yet.',
        hint: 'Add an entry for each place the deceased was treated. If a doctor treated them at a hospital, put both on the same entry.',
        sub: [
          { k: 'hospital', l: 'Hospital, clinic or mortuary', t: 't', ph: 'e.g. Steve Biko Academic Hospital' },
          { k: 'doctor', l: 'Doctor’s name', t: 't', ph: 'e.g. Dr M. Radebe' } ] },

      { k: 'hdrCause', l: 'Cause of death', t: 'h', wide: 1 },
      { k: 'causeOfDeath', l: 'Cause of death as recorded on the certificate', t: 't', wide: 1, req: 1,
        ph: 'e.g. Multiple injuries sustained in a motor vehicle accident' },
      { k: 'postMortem', l: 'Was a post-mortem carried out?', t: 'r', wide: 1, o: ['Yes', 'No', 'Unsure'] },
      { k: 'postMortemRef', l: 'Post-mortem or DR number', t: 't', showIf: ['postMortem', 'Yes'], ns: 1 },
      { k: 'deathRegistered', l: 'Has the death been registered at Home Affairs?', t: 'r', wide: 1, o: ['Yes', 'No', 'In progress'] } ] },

    /* ── 15 ─ funeral ──────────────────────────────────────────────────── */
    { id: 'funeral', g: 'Support and loss', n: 'Funeral and related expenses', h: 'What the funeral cost and who paid for it. Keep the receipts — the practice will ask for them.', f: [
      { k: 'funeralParlour', l: 'Funeral parlour or undertaker', t: 't', ph: 'e.g. Doves, Pretoria North' },
      { k: 'funeralDate', l: 'Date of the funeral', t: 't', ph: 'YYYY/MM/DD', im: 'numeric', dateMask: 1, ns: 1 },
      { k: 'funeralType', l: 'Burial or cremation?', t: 'r', o: ['Burial', 'Cremation', 'Other'] },
      { k: 'funeralCost', l: 'Total cost of the funeral', t: 't', ph: 'e.g. R28 400' },
      { k: 'funeralPaidBy', l: 'Who paid for the funeral?', t: 't', wide: 1, ph: 'e.g. I did, with help from my brother' },
      { k: 'funeralPolicy', l: 'Was there a funeral policy?', t: 'r', wide: 1, o: ['Yes, it paid out', 'Yes, it has not paid out', 'No', 'Unsure'] },
      { k: 'funeralPolicyDetail', l: 'Which policy, and how much did it pay?', t: 't', wide: 1,
        showIf: ['funeralPolicy', ['Yes, it paid out', 'Yes, it has not paid out']],
        ph: 'e.g. Old Mutual funeral plan, R20 000' },
      { k: 'otherExpenses', l: 'Any other expenses caused by the death', t: 'a', wide: 1,
        ph: 'e.g. Travel to the mortuary, the tombstone, the memorial service' } ] },

    /* ── 16 ─ insurance and benefits ───────────────────────────────────── */
    { id: 'benefits', g: 'Support and loss', n: 'Insurance and other benefits', h: 'Anything already paid, or still expected, because of the death. Tell us even if you are not sure it counts.', f: [
      { k: 'rafClaimLodged', l: 'Has a claim already been lodged with the Road Accident Fund?', t: 'r', req: 1, wide: 1, o: ['Yes', 'No', 'Unsure'] },
      { k: 'rafClaimNumber', l: 'RAF claim number', t: 't', showIf: ['rafClaimLodged', 'Yes'], ns: 1 },
      { k: 'otherAttorney', l: 'Has any other attorney acted on this claim?', t: 'r', wide: 1, o: ['Yes', 'No'] },
      { k: 'otherAttorneyDetail', l: 'Which firm, and when?', t: 't', wide: 1, showIf: ['otherAttorney', 'Yes'] },

      { k: 'hdrBenefits', l: 'Policies and payouts', t: 'h', wide: 1 },
      { k: 'benefitsReceived', l: 'What has been paid out so far?', t: 'c', wide: 1,
        o: ['Life policy', 'Funeral policy', 'Pension or provident fund', 'UIF', 'Employer payment', 'Nothing yet', 'Other'] },
      { k: 'benefitsDetail', l: 'Details of those payments', t: 'a', wide: 1,
        ph: 'e.g. The provident fund paid R64 000 in October; the UIF claim is still in progress' },
      { k: 'estateReported', l: 'Has the estate been reported to the Master of the High Court?', t: 'r', wide: 1, o: ['Yes', 'No', 'Unsure'] },
      { k: 'executorName', l: 'Executor’s name, if one has been appointed', t: 't', wide: 1, showIf: ['estateReported', 'Yes'] } ] },

    /* ── 17 ─ certificates ─────────────────────────────────────────────── */
    { id: 'documents', g: 'Evidence', n: 'Supporting documents', h: 'Photograph or scan each document you already have. Anything you cannot find now can follow later — send what you have.', f: [
      { k: 'certificates', l: 'Documents', t: 'd', set: 'certs', wide: 1 },
      { k: 'documentsNote', l: 'Anything about these documents we should know', t: 'a', wide: 1,
        ph: 'e.g. The marriage was a customary one and there is no certificate; my aunt can confirm the lobola was paid' } ] },

    /* ── 18 ─ photographs ──────────────────────────────────────────────── */
    { id: 'photos', g: 'Evidence', n: 'Photographs', h: 'Any photographs of the scene or of the vehicles, if you have them.', f: [
      { k: 'photos', l: 'Photographs', t: 'p', wide: 1 } ] },

    /* ── 19 ─ sketch ───────────────────────────────────────────────────── */
    { id: 'sketch', g: 'Evidence', n: 'Sketch of the scene', h: 'A rough drawing often explains more than a paragraph. Only if you know how it happened.', f: [
      { k: 'sketch', l: 'Scene sketch', t: 'k', wide: 1 },
      { k: 'sketchNote', l: 'Notes on the sketch', t: 'a', wide: 1, ph: 'e.g. He was crossing towards the shops when the bakkie came around the corner',
        hint: 'If you would rather not draw, describe the positions here instead. Either is enough, and you may leave both blank.' } ] },

    /* ── 20 ─ declaration ──────────────────────────────────────────────── */
    { id: 'declaration', g: 'Declaration', n: 'Signature and consent', h: 'Your confirmation that the information above is correct.', f: [
      { k: 'signName', l: 'Full name', t: 't', req: 1 },
      { k: 'signCapacity', l: 'Signing as', t: 't', req: 1, ph: 'e.g. Widow of the deceased' },
      { k: 'signDate', l: 'Date', t: 't', req: 1, ph: 'YYYY/MM/DD', im: 'numeric', dateMask: 1, ns: 1 },
      { k: 'signature', l: 'Signature', t: 'g', req: 1, wide: 1 } ] }
  ];

  /* ── Derived maps ──────────────────────────────────────────────────────
     Keys a saved progress file is allowed to restore. A file that names
     anything else is ignored — a crafted file must not be able to reach
     parts of the page the form itself never writes to. */
  var RESTORABLE = {};     // plain key -> field type
  var REPEATERS = {};      // repeater key -> its field descriptor
  var FIELD_BY_KEY = {};
  var DOC_FIELDS = [];     // every t:'d' field descriptor
  var SIMPLE = ['t', 'a', 's', 'r', 'c'];

  SECTIONS.forEach(function (s) {
    s.f.forEach(function (f) {
      FIELD_BY_KEY[f.k] = f;
      if (SIMPLE.indexOf(f.t) !== -1) RESTORABLE[f.k] = f.t;
      if (f.t === 'm') REPEATERS[f.k] = f;
      if (f.t === 'd') DOC_FIELDS.push(f);
    });
  });

  /* Fields whose answer changes whether another field is shown or required.
     Answering one of these re-draws the section. */
  var GOVERNS = {};
  SECTIONS.forEach(function (s) {
    s.f.forEach(function (f) {
      if (f.reqIf) GOVERNS[f.reqIf[0]] = true;
      if (f.showIf) GOVERNS[f.showIf[0]] = true;
    });
  });

  var PHOTO_IDS = PHOTO_SLOTS.map(function (p) { return p.id; });
  var ALL_DOC_IDS = [];
  Object.keys(DOC_SETS).forEach(function (name) {
    DOC_SETS[name].forEach(function (slot) { ALL_DOC_IDS.push(slot.id); });
  });
  var IMAGE_DATA_RE = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

  /* ── State ─────────────────────────────────────────────────────────────
     Held in memory only. There is deliberately no persistence layer. */
  /* CARL-drplos-001. The restore used to clear state by ENUMERATING the keys
     it knew about, and it missed some — so after a failed send, claimant A's
     sendAck and recipient survived into claimant B's session, and B could
     press Send without ever ticking the box. Enumerating is the bug: every
     field added later is one more that a future restore forgets.
     One factory, used both to create the state and to reset it, so the two can
     never drift apart again. */
  function makeInitialState() {
    return {
    screen: 'welcome',
    active: null,
    consent: false,
    sendAck: false,
    sending: false,
    done: {},
    values: {},
    entries: {},        // repeater key -> array of entry objects
    photos: {},
    docs: {},           // slot id -> data URL, across every set
    sketch: null,
    signature: null,
    isExample: false,   /* ALLISON-forms-015 */
    signatureTyped: false,
    /* Chosen in the dialog each time, never restored from a progress file: a
       saved file must not be able to decide where a form is sent. */
    recipient: null,
    paused: false,
    pausedMessage: ''
  };
  }

  /* MOBILE KEYBOARD. inputmode="numeric" gives iOS a digits-only keypad with
     no punctuation and no letters — so a field asking for YYYY/MM/DD could not
     be filled in at all on a phone: there is no slash key. Found by Richard on
     a real iPhone, which is the only way this shows up; every emulator and
     desktop browser types it happily.
     Richard's call: KEEP the keypad on dates and insert the slashes as the
     claimant types (dateMask below), because on a phone the big keys are
     worth more than the punctuation. Removed only where the value needs
     LETTERS a keypad has not got: the identity fields that also accept a
     passport or birth certificate number, and the funeral cost (R, space).
     Deliberately KEPT on the fields whose value really is digits only — a
     South African ID, a postal code, a year — where the bigger keys are an
     improvement on a phone rather than an obstacle. */
  var state = makeInitialState();

  /* CARL-drplos-001, the serious half. lastPdf lives OUTSIDE state and held
     the previously built document. After a failed send the rescue button is
     deliberately armed so the claimant can still save their file — and it
     stayed armed across a restore. On a shared device in a practice waiting
     room, claimant B restoring their own progress file could press "Save the
     PDF to this device" and receive claimant A's complete submission: name,
     identity number, the deceased, dependants, income, document scans and
     signature. Reset alongside the state, never separately. */
  function resetForNewSubmission() {
    state = makeInitialState();
    lastPdf = null;
    savedFingerprint = null;   /* a new submission has saved nothing yet */
  }
  var lastPdf = null;
  var dialogReturn = null;

  /* ── Small helpers ─────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function isDesktop() { return window.matchMedia('(min-width: 900px)').matches; }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function announce(text) {
    var live = $('announcer');
    if (live) live.textContent = text;
  }

  function valueOf(key) {
    var v = state.values[key];
    if (Array.isArray(v)) return v.length ? v.join(', ') : '';
    return typeof v === 'string' ? v : '';
  }

  function entriesOf(key) {
    return Array.isArray(state.entries[key]) ? state.entries[key] : [];
  }

  function entryText(sub, entry) {
    var v = entry ? entry[sub.k] : '';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '';
    return typeof v === 'string' ? v : '';
  }

  function entryHasValue(f, entry) {
    return f.sub.some(function (sub) { return !!entryText(sub, entry); });
  }

  /* A field hidden by its showIf is not on the form at all: it is never
     required, never counted as missing, and never printed in the PDF.
     The wanted value may be a list, so that one field can be shown by any of
     several answers ("No" or "Unsure", say). */
  function isVisible(f) {
    if (!f.showIf) return true;
    var want = f.showIf[1];
    var have = valueOf(f.showIf[0]);
    return Array.isArray(want) ? want.indexOf(have) !== -1 : have === want;
  }

  /* Pages attached to a question the claimant has since answered differently
     are not part of the form any more. Without this the PDF reads "Have you
     obtained an accident report? No" on one page and attaches the report on
     the next — a contradiction in a legal file. The uploads are kept in
     memory, not deleted, so changing the answer back brings them straight
     back; they are simply excluded at every boundary that leaves the page.

     Every t:'d' field is covered, so a new document set inherits this without
     anyone having to remember it. */
  function slotsFor(f) { return DOC_SETS[f.set] || []; }

  function liveDocIds() {
    var ids = [];
    DOC_FIELDS.forEach(function (f) {
      if (!isVisible(f)) return;
      slotsFor(f).forEach(function (slot) { ids.push(slot.id); });
    });
    return ids;
  }

  function hasValue(f) {
    if (f.t === 'h') return false;
    if (f.t === 'p') return PHOTO_IDS.some(function (id) { return !!state.photos[id]; });
    if (f.t === 'd') {
      if (!isVisible(f)) return false;
      return slotsFor(f).some(function (slot) { return !!state.docs[slot.id]; });
    }
    if (f.t === 'k') return !!state.sketch;
    if (f.t === 'g') return !!state.signature;
    if (f.t === 'm') {
      return entriesOf(f.k).some(function (entry) { return entryHasValue(f, entry); });
    }
    /* ALLISON-forms-016. This was `!!valueOf(f.k)` — a string of spaces is
       truthy, so a required field containing "     " counted as answered. The
       review screen then omitted it from the outstanding list and rendered a
       blank row rather than the honest "Not answered". On this form that
       includes the cell phone number, which is how the firm calls the claimant
       back. */
    return !!valueOf(f.k).trim();
  }

  function isRequired(f) {
    if (!f.req) return false;
    if (!isVisible(f)) return false;
    if (f.reqIf) return valueOf(f.reqIf[0]) === f.reqIf[1];
    return true;
  }


  /* ALLISON-forms-017. `required` was presence-only: nothing in any of these
     forms validated the SHAPE of a claimant's answer. An ID number of
     "0000000000000000000abc", a date of birth of "3026/13/45" and an email of
     "not-an-email" were all accepted, stored and rendered into the review
     screen verbatim, with no error and no hint.

     These are RAF intake forms. The ID number and the accident date are the
     two fields the firm uses to open a file and to check prescription, and a
     mistyped one that nothing questions travels into the PDF and into the
     attorney's file as though it were checked.

     The rules below are deliberately forgiving — they reject what cannot be
     right, not what looks unusual — because a validator that rejects a real
     person's real details is worse than none. A badly-formatted answer is
     reported exactly like a missing one: named on the review screen, with a
     way back to its section.

     The ID check is a real Luhn check plus an embedded-date check, which is
     what makes it worth doing: a typo in any single digit fails it. */
  function luhnOk(digits) {
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = parseInt(digits.charAt(i), 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function saIdProblem(v) {
    var d = v.replace(/\s/g, '');
    if (!/^\d{13}$/.test(d)) return 'should be 13 digits';
    var yy = +d.slice(0, 2), mm = +d.slice(2, 4), dd = +d.slice(4, 6);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return 'the date inside it is not a real date';
    var full = new Date((yy > (new Date().getFullYear() % 100) ? 1900 + yy : 2000 + yy), mm - 1, dd);
    if (full.getMonth() !== mm - 1 || full.getDate() !== dd) return 'the date inside it is not a real date';
    if (!luhnOk(d)) return 'the check digit does not match — one of the digits is probably mistyped';
    return null;
  }

  function dateProblem(v) {
    var m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(v.trim());
    if (!m) return 'should be written as YYYY/MM/DD';
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return 'is not a real date';
    var now = new Date();
    if (dt > new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())) return 'is in the future';
    if (y < 1900) return 'looks too long ago';
    return null;
  }

  function formatProblem(f) {
    if (!f || f.t !== 't') return null;
    /* The example data is deliberately NOT valid — every demo ID number in
       these forms fails the Luhn check on purpose, because a Luhn-VALID South
       African ID number in fabricated demo data could belong to a real person.
       Whoever wrote that data got it right, and it must stay that way. So the
       example run is exempt from these checks rather than the data being
       "corrected" to satisfy them. (ALLISON-forms-015 / -017) */
    if (state.isExample) return null;
    var v = valueOf(f.k).trim();
    if (!v) return null;               /* empty is "missing", not "wrong" */
    var k = String(f.k);
    if (/idnumber/i.test(k)) return saIdProblem(v);
    if (/^(dateOfBirth|accidentDate|dateOfDeath|signDate|dod|dob)$/i.test(k) ||
        (f.ph === 'YYYY/MM/DD')) return dateProblem(v);
    if (f.im === 'email' || /email/i.test(k)) {
      return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v) ? null : 'does not look like an email address';
    }
    if (/postal/i.test(k)) return /^\d{4}$/.test(v) ? null : 'should be four digits';
    if (f.im === 'tel' || /^(cell|altCell|contact|tel|phone)/i.test(k)) {
      var digits = v.replace(/[^\d]/g, '');
      if (digits.length < 9 || digits.length > 13) return 'does not look like a telephone number';
    }
    return null;
  }

  function badFormatFields(s) {
    return s.f.filter(function (f) { return isVisible(f) && !!formatProblem(f); });
  }

  function sectionStarted(s) { return s.f.some(hasValue); }

  function missingFields(s) {
    /* ALLISON-forms-017. A required answer that is present but cannot be right
       is reported alongside the ones that are absent — same list, same way
       back to the section, with the reason named. */
    return s.f.filter(function (f) {
      return (isRequired(f) && !hasValue(f)) || (isVisible(f) && !!formatProblem(f));
    });
  }

  function missingIn(s) {
    return missingFields(s).length;
  }

  function sectionIndex(id) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return i;
    return -1;
  }

  function doneCount() {
    return SECTIONS.filter(function (s) { return state.done[s.id]; }).length;
  }

  function dataUrlBytes(url) {
    var i = url.indexOf(',');
    return Math.floor((url.length - i - 1) * 0.75);
  }

  /* ── Navigation ────────────────────────────────────────────────────── */
  function go(screen, sectionId) {
    state.screen = screen;
    if (sectionId !== undefined) state.active = sectionId;
    if (screen === 'review') $('sendError').hidden = true;
    render();
    window.scrollTo(0, 0);

    /* Moving the screen has to move the focus with it, or someone using a
       screen reader or a keyboard is left where the old screen used to be. */
    var heading = $('screen-' + state.screen).querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: true }); } catch (err) { heading.focus(); }
    }
    announce(headerTitle());
  }

  function firstUnfinished() {
    for (var i = 0; i < SECTIONS.length; i++) if (!state.done[SECTIONS[i].id]) return SECTIONS[i];
    return null;
  }

  function backFromSection() {
    if (isDesktop()) return;
    go('hub', null);
  }

  /* ── Render: header, progress, sidebar ─────────────────────────────── */
  function headerTitle() {
    if (state.screen === 'welcome') return 'Loss of support';
    if (state.screen === 'hub') return 'Your sections';
    if (state.screen === 'review') return 'Review and send';
    if (state.screen === 'sent') return 'Form sent';
    var s = SECTIONS[sectionIndex(state.active)];
    return s ? s.n : '';
  }

  function renderProgress() {
    var inForm = state.screen !== 'welcome' && state.screen !== 'sent';
    $('progress').hidden = !inForm;
    if (!inForm) return;
    var n = doneCount();
    $('progressLabel').textContent = n + ' of ' + SECTIONS.length;
    $('progressFill').style.width = Math.round((n / SECTIONS.length) * 100) + '%';
    var track = $('progressTrack');
    track.setAttribute('aria-valuemax', String(SECTIONS.length));
    track.setAttribute('aria-valuenow', String(n));
    track.setAttribute('aria-valuetext', n + ' of ' + SECTIONS.length + ' sections complete');
  }

  function renderSidebar() {
    var show = isDesktop() && state.screen !== 'welcome' && state.screen !== 'sent';
    var bar = $('sidebar');
    bar.hidden = !show;
    if (!show) return;

    var list = $('sidebarList');
    list.textContent = '';
    GROUPS.forEach(function (g) {
      list.appendChild(el('div', 'side-group', g));
      SECTIONS.forEach(function (s, i) {
        if (s.g !== g) return;
        var current = state.screen === 'section' && state.active === s.id;
        var row = el('button', 'side-row' + (current ? ' current' : ''));
        row.type = 'button';
        if (current) row.setAttribute('aria-current', 'true');
        row.appendChild(el('span', 'side-n', pad2(i + 1)));
        row.appendChild(el('span', 'side-name', s.n));
        if (state.done[s.id]) {
          var mark = el('span', 'side-done');
          mark.setAttribute('aria-label', 'complete');
          row.appendChild(mark);
        }
        row.addEventListener('click', function () { go('section', s.id); });
        list.appendChild(row);
      });
    });
  }

  /* ── Render: hub ───────────────────────────────────────────────────── */
  function renderHub() {
    var list = $('hubList');
    list.textContent = '';
    GROUPS.forEach(function (g) {
      list.appendChild(el('div', 'hub-group', g));
      SECTIONS.forEach(function (s, i) {
        if (s.g !== g) return;
        var row = el('button', 'hub-row');
        row.type = 'button';
        row.appendChild(el('span', 'hub-n', pad2(i + 1)));

        var body = el('span', 'hub-body');
        body.appendChild(el('span', 'hub-name', s.n));
        var asked = s.f.filter(function (f) { return f.t !== 'h'; }).length;
        var count = asked + (asked === 1 ? ' question' : ' questions');
        body.appendChild(el('span', 'hub-meta', count));
        row.appendChild(body);

        if (state.done[s.id]) row.appendChild(el('span', 'badge badge-done', 'Complete'));
        else if (sectionStarted(s)) row.appendChild(el('span', 'badge badge-started', 'In progress'));

        row.appendChild(el('span', 'hub-chev', '›'));
        row.addEventListener('click', function () { go('section', s.id); });
        list.appendChild(row);
      });
    });
  }

  /* ── Render: the controls ──────────────────────────────────────────────
     Every control reads and writes through a binding, so the same code draws
     a top-level answer and an answer inside a repeatable entry. */
  function makeBind(id, get, set) { return { id: id, get: get, set: set }; }

  function bindValue(key) {
    return makeBind('field-' + key,
      function () { return state.values[key]; },
      function (v) { state.values[key] = v; });
  }

  function bindEntry(repeatKey, index, sub) {
    return makeBind('field-' + repeatKey + '-' + index + '-' + sub.k,
      function () {
        var entry = entriesOf(repeatKey)[index];
        return entry ? entry[sub.k] : '';
      },
      function (v) {
        var arr = entriesOf(repeatKey);
        if (!arr[index]) return;
        arr[index][sub.k] = v;
      });
  }


  /* ── Dates on a phone ───────────────────────────────────────────────────
     Richard's call, after finding on a real iPhone that a date field could not
     be filled in at all: inputmode="numeric" gives iOS a keypad with no slash
     key, so YYYY/MM/DD was untypeable.

     Rather than give up the keypad — the big keys are genuinely better on a
     phone than a full keyboard — the slashes are inserted as the claimant
     types. They type eight digits; they get 1991/04/17.

     The cursor is preserved by counting DIGITS to the left of it rather than
     characters, because the character positions shift as separators appear.
     Deleting backwards over a slash removes the digit before it, which is what
     someone expects from a backspace; it does not fight them by putting the
     slash straight back.

     Applied only to fields carrying dateMask, never to a free-text field. */
  function applyDateMask(input) {
    var raw = input.value;
    var caret = input.selectionStart;
    if (caret === null || caret === undefined) caret = raw.length;
    var digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;

    var d = raw.replace(/\D/g, '').slice(0, 8);
    var out = d.slice(0, 4);
    if (d.length > 4) out += '/' + d.slice(4, 6);
    if (d.length > 6) out += '/' + d.slice(6, 8);
    if (out === raw) return;

    input.value = out;

    var pos = 0, seen = 0;
    while (pos < out.length && seen < digitsBeforeCaret) {
      if (/\d/.test(out.charAt(pos))) seen++;
      pos++;
    }
    /* Sit after a separator rather than before it, so the next digit typed
       lands where the claimant is looking. */
    if (out.charAt(pos) === '/') pos++;
    try { input.setSelectionRange(pos, pos); } catch (err) { /* not all inputs allow it */ }
  }

  function textControl(f, bind) {
    var input = document.createElement(f.t === 'a' ? 'textarea' : 'input');
    input.className = 'input';
    if (f.t === 'a') { input.rows = 6; input.maxLength = MAX_AREA; }
    else { input.type = 'text'; input.maxLength = MAX_TEXT; }
    if (f.ph) input.placeholder = f.ph;
    if (f.im) input.setAttribute('inputmode', f.im);
    if (f.ns) input.spellcheck = false;
    input.autocomplete = 'off';
    input.id = bind.id;
    input.value = String(bind.get() || '');
    input.addEventListener('input', function () {
      /* maxlength only constrains typing and pasting. A value that arrives any
         other way — autofill, dictation on a phone, an extension — can be
         longer than the cap the draft file, the PDF and the function all
         assume, so the cap is enforced here where every value passes. */
      var cap = f.t === 'a' ? MAX_AREA : MAX_TEXT;
      if (input.value.length > cap) {
        var at = input.selectionStart;
        input.value = input.value.slice(0, cap);
        try { input.setSelectionRange(Math.min(at, cap), Math.min(at, cap)); } catch (err) { /* not all inputs allow it */ }
      }
      if (f.dateMask) applyDateMask(input);
      bind.set(input.value);
      refreshSaveButtons();
    });
    return input;
  }

  function selectControl(f, bind, onGovern) {
    var wrap = el('div', 'select-wrap');
    var sel = el('select', 'input');
    sel.id = bind.id;
    var blank = el('option', null, 'Please select…');
    blank.value = '';
    sel.appendChild(blank);
    (f.o || []).forEach(function (label) {
      /* A bare em-dash in a list is a divider, not a country. */
      if (label === '—') {
        var rule = el('option', null, '──────────');
        rule.value = '';
        rule.disabled = true;
        sel.appendChild(rule);
        return;
      }
      var opt = el('option', null, label);
      opt.value = label;
      sel.appendChild(opt);
    });
    sel.value = String(bind.get() || '');
    sel.addEventListener('change', function () {
      bind.set(sel.value);
      if (onGovern) onGovern();
    });
    wrap.appendChild(sel);
    return wrap;
  }

  /* One choice is a real radio group: role="radio" children, a single tab
     stop, and the arrow keys moving between the options. Several choices is
     a group of toggle buttons, which is what aria-pressed is actually for. */
  function choiceControl(f, bind, labelId, onGovern) {
    var multi = f.t === 'c';
    var wrap = el('div', 'choices');
    wrap.setAttribute('role', multi ? 'group' : 'radiogroup');
    if (labelId) wrap.setAttribute('aria-labelledby', labelId);
    else wrap.setAttribute('aria-label', f.l);

    var chips = [];

    function selectedIndex() {
      var cur = String(bind.get() || '');
      return (f.o || []).indexOf(cur);
    }

    function repaint() {
      var cur = bind.get();
      chips.forEach(function (chip, i) {
        var label = f.o[i];
        var on = multi
          ? (Array.isArray(cur) ? cur : []).indexOf(label) !== -1
          : cur === label;
        chip.setAttribute(multi ? 'aria-pressed' : 'aria-checked', on ? 'true' : 'false');
        if (!multi) chip.tabIndex = on ? 0 : -1;
      });
      /* Nothing chosen yet: the first option holds the group's tab stop. */
      if (!multi && selectedIndex() === -1 && chips.length) chips[0].tabIndex = 0;
    }

    function choose(i) {
      var label = f.o[i];
      if (multi) {
        var cur = Array.isArray(bind.get()) ? bind.get().slice() : [];
        var at = cur.indexOf(label);
        if (at === -1) cur.push(label); else cur.splice(at, 1);
        bind.set(cur);
        repaint();
        return;
      }
      /* Choosing the answer already given clears it, so a mis-tap on an
         optional question can be undone without reloading the page. */
      bind.set(bind.get() === label ? '' : label);
      repaint();
      if (onGovern) onGovern(chips[i].id);
    }

    (f.o || []).forEach(function (label, i) {
      var chip = el('button', 'choice', label);
      chip.type = 'button';
      chip.id = bind.id + '-opt' + i;
      if (multi) {
        chip.setAttribute('aria-pressed', 'false');
      } else {
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', 'false');
        chip.tabIndex = -1;
      }
      chip.addEventListener('click', function () { choose(i); });
      if (!multi) {
        chip.addEventListener('keydown', function (ev) {
          var last = chips.length - 1;
          var to = -1;
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') to = i === last ? 0 : i + 1;
          else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') to = i === 0 ? last : i - 1;
          else if (ev.key === 'Home') to = 0;
          else if (ev.key === 'End') to = last;
          if (to === -1) return;
          ev.preventDefault();
          /* The arrow keys both move and choose, which is how a radio group
             behaves everywhere else. */
          bind.set(f.o[to]);
          repaint();
          if (onGovern) { onGovern(chips[to].id); return; }
          chips[to].focus();
        });
      }
      chips.push(chip);
      wrap.appendChild(chip);
    });

    repaint();
    return wrap;
  }

  /* ── Repeatable entries ────────────────────────────────────────────── */
  function ensureEntries(f) {
    if (!entriesOf(f.k).length) state.entries[f.k] = [{}];
  }

  function repeaterControl(f) {
    ensureEntries(f);
    var wrap = el('div', 'repeat');
    var list = el('div', 'repeat-list');
    var entries = entriesOf(f.k);

    entries.forEach(function (entry, index) {
      var item = el('div', 'repeat-item');

      var head = el('div', 'repeat-head');
      var title = el('div', 'repeat-n', f.itemLabel + ' ' + (index + 1));
      title.id = 'repeat-' + f.k + '-' + index + '-title';
      head.appendChild(title);

      /* One entry on its own is the form's starting state, so there is
         nothing to remove yet and no button offering to. */
      if (entries.length > 1) {
        var remove = el('button', 'repeat-remove', 'Remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + f.itemLabel.toLowerCase() + ' ' + (index + 1));
        remove.addEventListener('click', function () {
          var arr = entriesOf(f.k).slice();
          arr.splice(index, 1);
          state.entries[f.k] = arr;
          announce(f.itemLabel + ' ' + (index + 1) + ' removed. ' + arr.length + ' remaining.');
          renderSection('add-' + f.k);
        });
        head.appendChild(remove);
      }
      item.appendChild(head);

      var grid = el('div', 'field-grid');
      f.sub.forEach(function (sub) {
        var bind = bindEntry(f.k, index, sub);
        var wide = sub.wide || !isDesktop();
        var block = el('div', 'field' + (wide ? ' wide' : ''));
        var isControlLabel = ['r', 'c'].indexOf(sub.t) !== -1;
        var label = el(isControlLabel ? 'div' : 'label', isControlLabel ? 'field-label' : null, sub.l);
        if (isControlLabel) label.id = bind.id + '-label';
        else label.htmlFor = bind.id;
        block.appendChild(label);

        if (sub.t === 't' || sub.t === 'a') block.appendChild(textControl(sub, bind));
        else if (sub.t === 's') block.appendChild(selectControl(sub, bind));
        else block.appendChild(choiceControl(sub, bind, bind.id + '-label'));

        if (sub.hint) block.appendChild(el('p', 'field-hint', sub.hint));

        grid.appendChild(block);
      });
      item.appendChild(grid);
      list.appendChild(item);
    });

    wrap.appendChild(list);

    var add = el('button', 'repeat-add', '+  ' + f.addLabel);
    add.type = 'button';
    add.id = 'add-' + f.k;
    add.disabled = entries.length >= MAX_ENTRIES;
    add.addEventListener('click', function () {
      var arr = entriesOf(f.k).slice();
      if (arr.length >= MAX_ENTRIES) return;
      arr.push({});
      state.entries[f.k] = arr;
      announce(f.itemLabel + ' ' + arr.length + ' added.');
      renderSection('field-' + f.k + '-' + (arr.length - 1) + '-' + f.sub[0].k);
    });
    wrap.appendChild(add);

    if (entries.length >= MAX_ENTRIES) {
      wrap.appendChild(el('p', 'field-hint', 'That is as many as this form can carry. Please tell the office about any others.'));
    }
    return wrap;
  }

  /* ── Photographs and document pages ────────────────────────────────── */
  function imageSetControl(opts) {
    var wrap = el('div');
    var grid = el('div', opts.gridClass);
    var store = opts.store;

    opts.slots.forEach(function (slot) {
      /* The remove control is a sibling of the slot, not a child: a button
         inside a button is invalid, and a keyboard user could never reach it. */
      var wrapCell = el('div', 'photo-cell');
      var cell = el('button', 'photo-slot');
      cell.type = 'button';
      var remove = el('button', 'photo-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + opts.noun + ': ' + slot.label.toLowerCase());
      remove.addEventListener('click', function () {
        delete store[slot.id];
        paint();
        cell.focus();
      });

      function paint() {
        cell.textContent = '';
        var url = store[slot.id];
        remove.hidden = !url;
        if (url) {
          cell.className = 'photo-slot filled';
          var img = document.createElement('img');
          img.src = url;
          img.alt = slot.label;
          cell.appendChild(img);
          cell.appendChild(el('span', 'photo-caption', slot.label));
          cell.setAttribute('aria-label', 'Replace ' + opts.noun + ': ' + slot.label.toLowerCase());
        } else {
          cell.className = 'photo-slot';
          cell.appendChild(el('span', 'photo-plus', '+'));
          cell.appendChild(el('span', 'photo-label', slot.label));
          cell.setAttribute('aria-label', 'Add ' + opts.noun + ': ' + slot.label.toLowerCase());
        }
      }

      var picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'image/*';
      picker.className = 'visually-hidden';
      picker.tabIndex = -1;
      picker.addEventListener('change', function () {
        var file = picker.files && picker.files[0];
        picker.value = '';
        if (!file) return;
        cell.classList.add('busy');
        compressImage(file, opts.maxEdge, opts.target, function (err, dataUrl) {
          cell.classList.remove('busy');
          if (err) {
            window.alert(err.message === 'too large'
              ? 'That file is too large for this form to handle. Please choose a smaller '
                + 'picture, or take the photograph again at a lower quality.'
              : 'That file could not be read as a picture. Please try another.');
            return;
          }
          store[slot.id] = dataUrl;
          announce(slot.label + ' added.');
          paint();
        });
      });

      cell.addEventListener('click', function () { picker.click(); });
      paint();
      wrapCell.appendChild(cell);
      wrapCell.appendChild(remove);
      wrapCell.appendChild(picker);
      grid.appendChild(wrapCell);
    });

    wrap.appendChild(grid);
    wrap.appendChild(el('p', 'field-hint', opts.hint()));
    return wrap;
  }

  function photoControl() {
    return imageSetControl({
      slots: PHOTO_SLOTS, store: state.photos, gridClass: 'photo-grid',
      noun: 'a photograph', maxEdge: PHOTO_MAX_EDGE, target: PHOTO_TARGET_BYTES,
      hint: function () {
        return (isDesktop()
          ? 'Click a square to browse for a photograph. Six maximum, so that the file reaches the office. '
          : 'Tap a square to take or choose a photograph. Six maximum, so that the file reaches the office. ')
          + 'Video cannot be attached here — if you have any, please say so and the office will arrange to collect it.';
      }
    });
  }

  function docControl(f) {
    var slots = slotsFor(f);
    var isCerts = f.set === 'certs';
    return imageSetControl({
      slots: slots, store: state.docs, gridClass: isCerts ? 'photo-grid' : 'doc-grid',
      noun: isCerts ? 'a document' : 'a page of the report',
      maxEdge: DOC_MAX_EDGE, target: DOC_TARGET_BYTES,
      hint: function () {
        if (isCerts) {
          return (isDesktop()
            ? 'Click a square to browse for a scan or a photograph of that document. '
            : 'Tap a square to photograph that document. ')
            + 'Lay the page flat and fill the frame, so that the writing can be read. '
            + 'Send what you have — anything missing can follow later.';
        }
        return (isDesktop()
          ? 'Click a square to browse for a scan or a photograph of each page. '
          : 'Tap a square to photograph each page of the report. ')
          + 'Four pages maximum. Lay the page flat and fill the frame, so that the writing can be read.';
      }
    });
  }

  /* ── Freehand drawing, shared by the sketch and the signature ──────── */
  function drawingControl(kind) {
    var isSketch = kind === 'sketch';
    var wrap = el('div');
    var frame = el('div', 'draw-frame ' + (isSketch ? 'blueprint sketch-frame' : 'sign-frame'));

    if (isSketch) {
      ['tl', 'tr', 'bl', 'br'].forEach(function (c) { frame.appendChild(el('i', 'corner ' + c)); });
    }

    var canvas = el('canvas', 'draw-canvas');
    canvas.setAttribute('aria-label', isSketch ? 'Sketch of the scene' : 'Signature');
    frame.appendChild(canvas);

    var empty = null;
    if (isSketch) {
      empty = el('div', 'draw-empty');
      empty.appendChild(el('div', 'draw-empty-title', isDesktop() ? 'Click to draw' : 'Tap to draw'));
      empty.appendChild(el('div', 'draw-empty-sub', 'Position of the vehicles and of the deceased'));
      frame.appendChild(empty);
    } else {
      frame.appendChild(el('div', 'sign-line'));
      /* NINA-CALL-08. This said only how to operate the control — "sign above
         with your mouse" — and nothing about what counts as a signature, on the
         one screen that carries the indemnity. It also never mentioned the typed
         alternative, which exists directly below and was invisible from here. */
      frame.appendChild(el('div', 'sign-hint', isDesktop()
        ? 'Sign here with your mouse or stylus — or type your name instead.'
        : 'Sign here with your finger or stylus — or type your name instead.'));
      /* The message the minimum-ink test needs somewhere to say. Created here,
         inside the pad's own frame, because that is where the claimant is
         looking when the mark is rejected. */
      var tooSmallMsg = el('div', 'draw-too-small', 'That mark is too small to be a '
        + 'signature. Try again, or type your name instead.');
      tooSmallMsg.hidden = true;
      tooSmallMsg.setAttribute('role', 'status');
      frame.appendChild(tooSmallMsg);
    }

    wrap.appendChild(frame);

    var actions = el('div', 'draw-actions');
    var clear = el('button', 'btn btn-ghost btn-small', isSketch ? 'Clear the sketch' : 'Clear the signature');
    clear.type = 'button';
    actions.appendChild(clear);
    wrap.appendChild(actions);

    var ctx = null;
    var drawing = false;
    var dirty = false;
    /* ALLISON-forms-021 — how far the pointer has travelled in this mark, and
       the floor below which it is a tap rather than a signature. */
    var MIN_INK = 24;
    var inkDist = 0;
    var lastPt = { x: 0, y: 0 };
    var rectW = 0;
    var rectH = 0;

    function setEmptyVisible(show) {
      if (isSketch && empty) empty.hidden = !show;
    }

    /* ALLISON-forms-020. setup() sizes the backing store once per render and
       remembers rectW/rectH. The only thing that re-ran it was the
       matchMedia('(min-width: 900px)') listener, so ANY resize that did not
       cross 900px left the canvas scaled to the old size — the drawing landed
       somewhere other than the cursor, silently. Watch the frame itself. */
    var ro = null;
    function watchFrame() {
      if (ro || typeof window.ResizeObserver !== 'function') return;
      ro = new window.ResizeObserver(function () {
        var r = frame.getBoundingClientRect();
        if (!r.width || (Math.abs(r.width - rectW) < 1 && Math.abs(r.height - rectH) < 1)) return;
        var keep = isSketch ? state.sketch : state.signature;
        setup();
        /* Re-draw what was there. Without this a resize would wipe the mark,
           which is a worse bug than the one being fixed. */
        if (keep && ctx) {
          var img = new window.Image();
          img.onload = function () { if (ctx) ctx.drawImage(img, 0, 0, rectW, rectH); };
          img.src = keep;
          setEmptyVisible(false);
        }
      });
      ro.observe(frame);
    }

    function setup() {
      var rect = frame.getBoundingClientRect();
      if (!rect.width) { window.requestAnimationFrame(setup); return; }
      rectW = rect.width;
      rectH = rect.height;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineWidth = isSketch ? 2.2 : 2;
      watchFrame();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1d1f20';

      var saved = isSketch ? state.sketch : state.signature;
      if (saved) {
        var img = new Image();
        img.onload = function () { ctx.drawImage(img, 0, 0, rect.width, rect.height); };
        img.src = saved;
        setEmptyVisible(false);
      } else {
        setEmptyVisible(true);
      }
    }

    function pointAt(ev) {
      var rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', function (ev) {
      if (!ctx) return;
      ev.preventDefault();
      drawing = true;
      dirty = true;
      setEmptyVisible(false);
      canvas.setPointerCapture(ev.pointerId);
      var p = pointAt(ev);
      lastPt = p;
      inkDist = 0;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.01, p.y);
      ctx.stroke();
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (!drawing || !ctx) return;
      ev.preventDefault();
      var p = pointAt(ev);
      /* ALLISON-forms-021. Measure how far the pointer has actually travelled.
         pointerdown alone used to be enough to store a signature: one tap left
         a single dot in a section headed "Signature and consent", carrying the
         indemnity, and nothing on the review screen or in the PDF said the mark
         was empty. */
      inkDist += Math.abs(p.x - lastPt.x) + Math.abs(p.y - lastPt.y);
      lastPt = p;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });

    function finish() {
      if (!drawing) return;
      drawing = false;
      if (!dirty) return;
      /* ALLISON-forms-021. A signature needs ink, not a tap. MIN_INK is a
         deliberate floor, not a judgement of handwriting: it only rejects a
         mark with essentially no travel. A sketch is exempt — a single dot on
         a scene diagram can be meaningful. */
      /* NINA-CALL-08. This used to `return` in silence: the mark was discarded and
         the claimant was told nothing at all, so a dot looked accepted. Say what
         happened, in the pad's own space, and name the way out. */
      if (!isSketch && inkDist < MIN_INK) {
        var tooSmall = frame.querySelector('.draw-too-small');
        if (tooSmall) {
          tooSmall.hidden = false;
          window.setTimeout(function () { tooSmall.hidden = true; }, 6000);
        }
        /* Wipe the dot as well, so the pad does not keep a mark it has just
           refused to accept. Same three lines the Clear button uses — there is
           no clearCanvas() helper in these apps, and inventing a call to one
           is how a fix passes a syntax check and throws on first use. */
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        dirty = false;
        announce('That mark is too small to be a signature.');
        return;
      }
      var url = canvas.toDataURL('image/png');
      if (isSketch) {
        state.sketch = url;
      } else {
        state.signature = url;
        state.signatureTyped = false;
      }
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('pointerleave', finish);

    clear.addEventListener('click', function () {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty = false;
      if (isSketch) {
        state.sketch = null;
      } else {
        state.signature = null;
        state.signatureTyped = false;
      }
      setEmptyVisible(true);
      announce(isSketch ? 'Sketch cleared.' : 'Signature cleared.');
    });

    /* A signature drawn with a finger or a trackpad is out of reach for
       anyone working from the keyboard alone, and awkward for someone filling
       this in on a borrowed phone. Typing the name is accepted as an
       electronic signature, and the PDF says plainly that it was typed
       rather than drawn, so the practice knows which it got. */
    if (!isSketch) {
      var alt = el('div', 'sign-alt');
      alt.appendChild(el('div', 'sign-alt-label', 'Or type your full name instead of signing'));

      var row = el('div', 'sign-alt-row');
      var input = el('input', 'input');
      input.type = 'text';
      input.id = 'signTyped';
      input.maxLength = 60;
      input.autocomplete = 'off';
      input.placeholder = 'Your full name';
      var label = el('label', 'visually-hidden', 'Type your full name to use as your signature');
      label.htmlFor = 'signTyped';

      var use = el('button', 'btn btn-secondary btn-small', 'Use as my signature');
      use.type = 'button';
      use.addEventListener('click', function () {
        var name = input.value.trim();
        if (!name) { input.focus(); return; }
        var url = typedSignature(name, rectW || 520, rectH || 170);
        if (!url) return;
        state.signature = url;
        state.signatureTyped = true;
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          var img = new Image();
          img.onload = function () { ctx.drawImage(img, 0, 0, rectW, rectH); };
          img.src = url;
        }
        dirty = false;
        announce('Signature set from the name you typed.');
      });

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(use);
      alt.appendChild(row);
      wrap.appendChild(alt);
    }

    window.requestAnimationFrame(setup);
    return wrap;
  }

  /* The typed name, drawn once onto a transparent canvas so that the rest of
     the page, the review screen and the PDF all treat it as an image. */
  function typedSignature(name, w, h) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * 2);
      canvas.height = Math.round(h * 2);
      var ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.fillStyle = '#1d1f20';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var size = 42;
      ctx.font = 'italic 500 ' + size + 'px Barlow, Georgia, serif';
      while (ctx.measureText(name).width > w - 44 && size > 18) {
        size -= 2;
        ctx.font = 'italic 500 ' + size + 'px Barlow, Georgia, serif';
      }
      ctx.fillText(name, 22, h - 48);
      return canvas.toDataURL('image/png');
    } catch (err) {
      return null;
    }
  }

  /* ── Render: one section's fields ──────────────────────────────────── */
  function renderSection(focusId) {
    var idx = sectionIndex(state.active);
    var sec = SECTIONS[idx];
    if (!sec) return;

    $('sectionKicker').textContent = sec.g + ' · Section ' + pad2(idx + 1);
    $('sectionTitle').textContent = sec.n;
    $('sectionHelp').textContent = sec.h;

    /* This line is drawn in capitals. It is stored in sentence case
       and capitalised by the stylesheet, so a screen reader reads it as words
       rather than spelling it out. */
    var alert = $('sectionAlert');
    alert.hidden = !sec.alert;
    alert.textContent = sec.alert || '';

    var host = $('sectionFields');
    host.textContent = '';

    sec.f.forEach(function (f) {
      if (!isVisible(f)) return;

      if (f.t === 'h') {
        host.appendChild(el('div', 'field-heading wide', f.l));
        return;
      }

      var wide = f.wide || !isDesktop();
      var block = el('div', 'field' + (wide ? ' wide' : ''));
      var bind = bindValue(f.k);

      var isControlLabel = ['r', 'c', 'm', 'p', 'd', 'k', 'g'].indexOf(f.t) !== -1;
      var label = el(isControlLabel ? 'div' : 'label', isControlLabel ? 'field-label' : null);
      label.appendChild(document.createTextNode(f.l));
      if (isRequired(f)) {
        var star = el('span', 'req', ' *');
        star.setAttribute('aria-hidden', 'true');
        label.appendChild(star);
        label.appendChild(el('span', 'visually-hidden', ' (required)'));
      }
      if (isControlLabel) label.id = bind.id + '-label';
      else label.htmlFor = bind.id;
      block.appendChild(label);

      /* Answering a field that governs another one re-draws the section, so
         that the fields it controls appear or disappear at once. Selects do
         this as well as radios, because a select governs "Other" here. */
      var governs = GOVERNS[f.k]
        ? function (focus) { renderSection(focus || bind.id); }
        : null;

      if (f.t === 't' || f.t === 'a') block.appendChild(textControl(f, bind));
      else if (f.t === 's') block.appendChild(selectControl(f, bind, governs));
      else if (f.t === 'r' || f.t === 'c') block.appendChild(choiceControl(f, bind, bind.id + '-label', governs));
      else if (f.t === 'm') block.appendChild(repeaterControl(f));
      else if (f.t === 'p') block.appendChild(photoControl());
      else if (f.t === 'd') block.appendChild(docControl(f));
      else if (f.t === 'k') block.appendChild(drawingControl('sketch'));
      else if (f.t === 'g') block.appendChild(drawingControl('signature'));

      if (f.hint) block.appendChild(el('p', 'field-hint', f.hint));

      host.appendChild(block);
    });

    /* Adding or removing an entry rebuilds this screen, so the focus has to
       be put back deliberately or it falls to the top of the document. */
    if (focusId) {
      var target = $(focusId);
      if (target) {
        try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
        if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  /* ── Render: review ────────────────────────────────────────────────── */
  function attachmentNote(s) {
    if (s.id === 'photos') {
      var n = PHOTO_IDS.filter(function (id) { return !!state.photos[id]; }).length;
      return n ? n + (n === 1 ? ' photograph attached' : ' photographs attached') : 'No photographs attached';
    }
    if (s.id === 'police') {
      var d = countDocs('report');
      return d ? d + (d === 1 ? ' page of the accident report attached' : ' pages of the accident report attached') : '';
    }
    if (s.id === 'documents') {
      var c = countDocs('certs');
      return c ? c + (c === 1 ? ' document attached' : ' documents attached') : 'No documents attached';
    }
    if (s.id === 'sketch') return state.sketch ? 'Sketch attached' : 'No sketch attached';
    if (s.id === 'declaration') {
      if (!state.signature) return 'Signature not yet captured';
      return state.signatureTyped ? 'Signature captured (typed)' : 'Signature captured';
    }
    return '';
  }

  function countDocs(setName) {
    var live = liveDocIds();
    return (DOC_SETS[setName] || []).filter(function (slot) {
      return live.indexOf(slot.id) !== -1 && !!state.docs[slot.id];
    }).length;
  }

  function renderReview() {
    var host = $('reviewBody');
    host.textContent = '';
    var outstanding = 0;

    GROUPS.forEach(function (g) {
      host.appendChild(el('div', 'review-group', g));
      var cards = el('div', 'review-cards');

      SECTIONS.forEach(function (s) {
        if (s.g !== g) return;
        outstanding += missingIn(s);

        var card = el('div', 'review-card');
        var head = el('div', 'review-head');
        head.appendChild(el('div', 'review-name', s.n));
        var edit = el('button', 'review-edit', 'Edit');
        edit.type = 'button';
        edit.setAttribute('aria-label', 'Edit ' + s.n);
        edit.addEventListener('click', function () { go('section', s.id); });
        head.appendChild(edit);
        card.appendChild(head);

        s.f.forEach(function (f) {
          if (!isVisible(f)) return;

          if (f.t === 'm') {
            var entries = entriesOf(f.k).filter(function (entry) { return entryHasValue(f, entry); });
            if (!entries.length) {
              var none = el('div', 'review-row');
              none.appendChild(el('div', 'review-label', f.l));
              none.appendChild(el('div', 'review-empty', 'Not answered'));
              card.appendChild(none);
              return;
            }
            entries.forEach(function (entry, i) {
              card.appendChild(el('div', 'review-sub', f.itemLabel + ' ' + (i + 1)));
              f.sub.forEach(function (sub) {
                var text = entryText(sub, entry);
                if (!text) return;
                var r = el('div', 'review-row');
                r.appendChild(el('div', 'review-label', sub.l));
                r.appendChild(el('div', 'review-value', text));
                card.appendChild(r);
              });
            });
            return;
          }

          if (SIMPLE.indexOf(f.t) === -1) return;
          var row = el('div', 'review-row');
          row.appendChild(el('div', 'review-label', f.l));
          var v = valueOf(f.k);
          row.appendChild(v ? el('div', 'review-value', v) : el('div', 'review-empty', 'Not answered'));
          card.appendChild(row);
        });

        var note = attachmentNote(s);
        if (note) card.appendChild(el('div', 'review-attach', note));

        cards.appendChild(card);
      });

      host.appendChild(cards);
    });

    /* "2 answers outstanding" and nothing else is a dead end: it tells someone
       that they are not finished without telling them where to go. Naming the
       questions and making each one a way back to its section is the whole
       difference for someone who is not confident with a computer. */
    var notice = $('outstandingNotice');
    var list = $('outstandingList');
    list.textContent = '';
    notice.hidden = outstanding === 0;
    if (outstanding) {
      $('outstandingLabel').textContent = outstanding +
        (outstanding === 1 ? ' answer outstanding' : ' answers outstanding');

      SECTIONS.forEach(function (s) {
        var gaps = missingFields(s);
        if (!gaps.length) return;
        var names = gaps.map(function (f) {
          var why = formatProblem(f);
          return why ? f.l + ' (' + why + ')' : f.l;
        }).join(', ');
        var jump = el('button', 'outstanding-jump');
        jump.type = 'button';
        jump.appendChild(el('span', 'outstanding-where', s.n));
        jump.appendChild(el('span', 'outstanding-what', names));
        jump.setAttribute('aria-label', 'Go to ' + s.n + ' to answer: ' + names);
        jump.addEventListener('click', function () { go('section', s.id); });
        list.appendChild(jump);
      });
    }
  }

  /* ── Render: the action bar ────────────────────────────────────────── */
  function setButton(btn, label, onClick, disabled) {
    btn.hidden = !label;
    btn.textContent = label || '';
    btn.disabled = !!disabled;
    btn.onclick = onClick || null;
  }

  function renderActionBar() {
    var primary = $('btnPrimary');
    var secondary = $('btnSecondary');
    var desk = isDesktop();

    if (state.screen === 'welcome') {
      setButton(secondary, 'Load saved progress', function () { $('draftInput').click(); });
      setButton(primary, 'Agree & begin', function () {
        if (desk) go('section', state.active || SECTIONS[0].id);
        else go('hub', null);
      }, !state.consent);
      return;
    }

    if (state.screen === 'hub') {
      setButton(secondary, 'Review & send form', function () { go('review'); });
      var next = firstUnfinished();
      if (!next) setButton(primary, 'Review & send form', function () { go('review'); });
      else setButton(primary, 'Continue: ' + next.n, function () { go('section', next.id); });
      return;
    }

    if (state.screen === 'section') {
      var here = sectionIndex(state.active);
      if (desk) {
        var prev = SECTIONS[here - 1];
        setButton(secondary, prev ? 'Previous section' : '', function () { go('section', prev.id); });
      } else {
        setButton(secondary, 'Back to sections', backFromSection);
      }
      setButton(primary, desk ? 'Save section' : 'Save section & return', function () {
        state.done[state.active] = true;
        if (!desk) { go('hub', null); return; }
        var nxt = SECTIONS[here + 1];
        if (nxt) go('section', nxt.id); else go('review');
      });
      return;
    }

    if (state.screen === 'review') {
      setButton(secondary, desk ? 'Back to the form' : 'Back to sections', function () {
        if (desk) go('section', state.active || SECTIONS[0].id);
        else go('hub', null);
      });
      setButton(primary, 'Send the form', openRecipientDialog, !state.sendAck || state.sending);
      return;
    }

    if (state.screen === 'sent') {
      setButton(secondary, '', null);
      setButton(primary, 'Save a copy (PDF)', function () {
        if (lastPdf) lastPdf.doc.save(lastPdf.filename);
      }, !lastPdf);
    }
  }

  /* ── Render: everything ────────────────────────────────────────────── */
  function render() {
    var desk = isDesktop();

    /* On a laptop the sidebar replaces the hub, so the hub never shows. */
    if (desk && state.screen === 'hub') {
      state.screen = 'section';
      if (!state.active) state.active = SECTIONS[0].id;
    }
    if (!desk && state.screen === 'section' && !state.active) state.screen = 'hub';

    $('headerTitle').textContent = headerTitle();
    ['welcome', 'hub', 'section', 'review', 'sent'].forEach(function (name) {
      $('screen-' + name).hidden = state.screen !== name;
    });

    if (state.screen === 'sent') {
      var chosen = RECIPIENTS.filter(function (r) { return r.email === state.recipient; })[0];
      $('sentLede').textContent = chosen
        ? 'It has gone to ' + chosen.label + ' as a PDF. Nothing you entered is kept on this website.'
        : 'It has been delivered as a PDF. Nothing you entered is kept on this website.';
    }

    renderProgress();
    renderSidebar();
    if (state.screen === 'hub') renderHub();
    if (state.screen === 'section') renderSection();
    if (state.screen === 'review') renderReview();
    renderActionBar();

    $('consentRow').setAttribute('aria-checked', state.consent ? 'true' : 'false');
    $('sendAckRow').setAttribute('aria-checked', state.sendAck ? 'true' : 'false');
  }

  /* ── Pictures ──────────────────────────────────────────────────────── */
  function compressImage(file, maxEdge, targetBytes, cb) {
    if (!/^image\//.test(file.type || '')) { cb(new Error('not an image')); return; }
    if (file.size > MAX_UPLOAD_BYTES) { cb(new Error('too large')); return; }
    var reader = new FileReader();
    reader.onerror = function () { cb(new Error('unreadable')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(new Error('undecodable')); };
      img.onload = function () {
        var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        var q = 0.78;
        var out = canvas.toDataURL('image/jpeg', q);
        while (dataUrlBytes(out) > targetBytes && q > 0.38) {
          q -= 0.1;
          out = canvas.toDataURL('image/jpeg', q);
        }
        cb(null, out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  /* ── Save and resume, as a file on the claimant's own device ───────── */
  function saveDraft() {
    var draft = {
      app: DRAFT_APP_ID,
      version: DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      consent: !!state.consent,
      done: {},
      values: {},
      entries: {},
      photos: {},
      docs: {},
      sketch: state.sketch || null,
      signature: state.signature || null,
      signatureTyped: !!state.signatureTyped
    };
    SECTIONS.forEach(function (s) { if (state.done[s.id]) draft.done[s.id] = true; });
    Object.keys(RESTORABLE).forEach(function (k) {
      var v = state.values[k];
      if (Array.isArray(v)) { if (v.length) draft.values[k] = v.slice(); }
      else if (typeof v === 'string' && v) draft.values[k] = v;
    });
    Object.keys(REPEATERS).forEach(function (k) {
      var f = REPEATERS[k];
      var kept = entriesOf(k).filter(function (entry) { return entryHasValue(f, entry); });
      if (kept.length) draft.entries[k] = kept;
    });
    PHOTO_IDS.forEach(function (id) { if (state.photos[id]) draft.photos[id] = state.photos[id]; });
    liveDocIds().forEach(function (id) { if (state.docs[id]) draft.docs[id] = state.docs[id]; });

    var blob = new Blob([JSON.stringify(draft)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = DRAFT_FILENAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    /* Option C. Remember what was saved, so the button can stop shouting and
       say "Progress saved" until something changes again. The browser gives no
       callback for a download, so this is optimistic — if the claimant cancels
       the save dialog the button will wrongly read as saved until they type
       again. That is the better of the two errors: nagging someone who HAS
       saved teaches them to ignore the warning. */
    savedFingerprint = formFingerprint();
    refreshSaveButtons();
  }

  /* A saved file is untrusted input. Every value has to pass the same test
     the control itself would apply: a known key, the right type, a choice
     that is actually on the list, and a length the form could have produced. */
  function restoreEntries(f, raw) {
    if (!Array.isArray(raw)) return;
    var out = [];
    raw.slice(0, MAX_ENTRIES).forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      var entry = {};
      var any = false;
      f.sub.forEach(function (sub) {
        var v = item[sub.k];
        if (sub.t === 'c') {
          if (!Array.isArray(v)) return;
          var allowed = sub.o || [];
          var picked = v.filter(function (x) {
            return typeof x === 'string' && allowed.indexOf(x) !== -1;
          });
          if (picked.length) { entry[sub.k] = picked; any = true; }
          return;
        }
        if (typeof v !== 'string') return;
        if (sub.t === 'r' || sub.t === 's') {
          if ((sub.o || []).indexOf(v) === -1) return;
          entry[sub.k] = v;
          any = true;
          return;
        }
        var clipped = v.slice(0, sub.t === 'a' ? MAX_AREA : MAX_TEXT);
        if (clipped) { entry[sub.k] = clipped; any = true; }
      });
      if (any) out.push(entry);
    });
    if (out.length) state.entries[f.k] = out;
  }

  function restoreDraft(text) {
    var draft;
    try { draft = JSON.parse(text); } catch (e) { return 'notours'; }
    if (!draft || typeof draft !== 'object' || draft.app !== DRAFT_APP_ID) return 'notours';
    if (draft.version !== DRAFT_VERSION) return 'version';

    /* ALLISON-forms-018 / CARL-drplos-001. A progress file is a snapshot of a
       whole form, not a patch, and "whole" includes everything the previous
       claimant left behind — including the built PDF, which is not in state. */
    resetForNewSubmission();   /* the caller's go() sets the screen */

    var values = draft.values && typeof draft.values === 'object' ? draft.values : {};
    Object.keys(RESTORABLE).forEach(function (k) {
      var type = RESTORABLE[k];
      var v = values[k];
      if (type === 'c') {
        if (!Array.isArray(v)) return;
        var allowed = (FIELD_BY_KEY[k].o || []);
        state.values[k] = v.filter(function (x) {
          return typeof x === 'string' && allowed.indexOf(x) !== -1;
        });
      } else if (typeof v === 'string') {
        if (type === 'r' || type === 's') {
          if ((FIELD_BY_KEY[k].o || []).indexOf(v) === -1) return;
          state.values[k] = v;
        } else {
          state.values[k] = v.slice(0, type === 'a' ? MAX_AREA : MAX_TEXT);
        }
      }
    });

    var entries = draft.entries && typeof draft.entries === 'object' ? draft.entries : {};
    Object.keys(REPEATERS).forEach(function (k) { restoreEntries(REPEATERS[k], entries[k]); });

    var photos = draft.photos && typeof draft.photos === 'object' ? draft.photos : {};
    PHOTO_IDS.forEach(function (id) {
      var v = photos[id];
      if (typeof v === 'string' && IMAGE_DATA_RE.test(v)) state.photos[id] = v;
    });

    var docs = draft.docs && typeof draft.docs === 'object' ? draft.docs : {};
    ALL_DOC_IDS.forEach(function (id) {
      var v = docs[id];
      if (typeof v === 'string' && IMAGE_DATA_RE.test(v)) state.docs[id] = v;
    });

    state.sketch = typeof draft.sketch === 'string' && IMAGE_DATA_RE.test(draft.sketch) ? draft.sketch : null;
    state.signature = typeof draft.signature === 'string' && IMAGE_DATA_RE.test(draft.signature) ? draft.signature : null;
    state.signatureTyped = !!state.signature && draft.signatureTyped === true;

    var done = draft.done && typeof draft.done === 'object' ? draft.done : {};
    SECTIONS.forEach(function (s) { if (done[s.id] === true) state.done[s.id] = true; });

    /* ALLISON-forms-019. This was an unconditional `true`, so restoring ANY
       file satisfied the POPIA consent gate — including a file whose own
       record says consent was never given, and including a file somebody else
       supplied. The consent flag is the record that the indemnity was shown.
       Honour what the file actually says. */
    state.consent = draft.consent === true;
    return true;
  }

  /* ── Building and sending ──────────────────────────────────────────── */
  function buildRecord() {
    var values = {};
    Object.keys(RESTORABLE).forEach(function (k) { values[k] = valueOf(k); });

    var entries = {};
    Object.keys(REPEATERS).forEach(function (k) {
      var f = REPEATERS[k];
      entries[k] = entriesOf(k).filter(function (entry) { return entryHasValue(f, entry); });
    });

    /* A question the claimant was never shown must not appear in the PDF as
       an unanswered one, so the builder is told which keys are off the form. */
    var hidden = {};
    SECTIONS.forEach(function (s) {
      s.f.forEach(function (f) { if (!isVisible(f)) hidden[f.k] = true; });
    });

    var live = liveDocIds();
    function docsIn(setName) {
      return (DOC_SETS[setName] || [])
        .filter(function (slot) { return live.indexOf(slot.id) !== -1 && !!state.docs[slot.id]; })
        .map(function (slot) { return { label: slot.label, dataUrl: state.docs[slot.id] }; });
    }

    return {
      sections: SECTIONS,
      groups: GROUPS,
      values: values,
      entries: entries,
      hidden: hidden,
      photos: PHOTO_SLOTS.map(function (slot) {
        return { label: slot.label, dataUrl: state.photos[slot.id] || null };
      }).filter(function (p) { return !!p.dataUrl; }),
      reportDocs: docsIn('report'),
      certDocs: docsIn('certs'),
      sketch: state.sketch,
      signature: state.signature,
      signatureTyped: !!state.signatureTyped,
      isExample: !!state.isExample,   /* ALLISON-forms-015 */
      submittedAt: new Date()
    };
  }

  function pdfFilename(record) {
    /* ALLISON-forms-015. An example report was indistinguishable from a
       real one. Say so in the name as well as on the page. */
    var parts = [record.isExample ? 'EXAMPLE-NOT-A-REAL-SUBMISSION_Loss-of-Support-Form' : 'Loss-of-Support-Form'];
    if (record.values.claimRef) parts.push(record.values.claimRef);
    if (record.values.decSurname) parts.push(record.values.decSurname);
    return parts.join('_').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 110) + '.pdf';
  }

  function showBusy(title, body) {
    $('busyTitle').textContent = title;
    $('busyBody').textContent = body;
    $('busy').hidden = false;
  }

  function failSend(message) {
    state.sending = false;
    $('busy').hidden = true;
    $('sendErrorText').textContent = message;

    /* The PDF is built before the request goes out, so on a delivery failure
       the finished document is sitting right here while the claimant is told
       only that it could not be sent. Nothing is stored anywhere, so without
       this a server outage means an hour of typing on a phone is lost the
       moment they close the tab. Hidden when the failure was the PDF build
       itself, because then there is nothing to save. */
    $('sendRescue').hidden = !lastPdf;

    $('sendError').hidden = false;
    renderActionBar();
    $('sendError').scrollIntoView({ block: 'center' });
  }

  /* Ask this site's own function for the current menu. It talks to the console
     server-side, so no key is ever in the page and the content security policy
     stays connect-src 'self'.

     Every failure path ends the same way: keep the built-in list. A claimant
     must never see an empty dialog, and must never be held up because a
     console somewhere is slow. */
  function loadRecipientMenu() {
    if (!window.fetch) return;
    window.fetch(RECIPIENTS_ENDPOINT, { cache: 'no-store', credentials: 'omit' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (!body || !Array.isArray(body.recipients) || !body.recipients.length) return;

        var clean = body.recipients
          .map(function (r) {
            return {
              /* Drawn into the page, so it is constrained here as well as at
                 the console: a label must never be able to carry a claimant's
                 name or a file reference. */
              label: String((r && r.label) || '').replace(/[^A-Za-z0-9 .'&-]/g, '').slice(0, 40),
              email: String((r && r.email) || '').trim().toLowerCase()
            };
          })
          .filter(function (r) {
            return r.label && /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(r.email);
          });

        if (clean.length) RECIPIENTS = clean;

        if (body.paused) {
          state.paused = true;
          state.pausedMessage = String(body.pausedMessage || '').slice(0, 600);
        }
      })
      .catch(function () { /* keep the built-in list */ });
  }

  /* ── Dialogs ───────────────────────────────────────────────────────────
     A dialog that does not hold the focus is a dialog a screen-reader user
     is still standing outside of, reading the page behind it. */
  function openDialog(id, firstFocus) {
    dialogReturn = document.activeElement;
    $(id).hidden = false;
    var target = firstFocus || $(id).querySelector('button, input, select, textarea');
    if (target) target.focus();
  }

  function closeDialog(id) {
    $(id).hidden = true;
    if (dialogReturn && dialogReturn.focus) {
      try { dialogReturn.focus(); } catch (err) { /* it may have been redrawn */ }
    }
    dialogReturn = null;
  }

  function trapDialog(id) {
    $(id).addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closeDialog(id); return; }
      if (ev.key !== 'Tab') return;
      var focusable = $(id).querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
  }

  function openRecipientDialog() {
    if (state.sending || !state.sendAck) return;

    /* The form was paused while this page was open. Say so in the operator's own
       words rather than letting the claimant build a PDF and be refused. */
    if (state.paused) {
      failSend(state.pausedMessage
        || 'This form is temporarily unavailable. Please telephone the office.');
      return;
    }

    var list = $('recipientList');
    list.textContent = '';
    RECIPIENTS.forEach(function (r) {
      var row = el('button', 'recipient-option');
      row.type = 'button';
      row.appendChild(el('span', 'recipient-name', r.label));
      row.appendChild(el('span', 'recipient-email', r.email));
      row.addEventListener('click', function () {
        state.recipient = r.email;
        $('recipientDialog').hidden = true;
        dialogReturn = null;
        submit();
      });
      list.appendChild(row);
    });

    openDialog('recipientDialog', list.querySelector('.recipient-option'));
  }


  /* ALLISON-forms-022. The PDF uses jsPDF's standard-14 base fonts with
     WinAnsiEncoding and embeds no font file, so any character outside
     Windows-1252 is written into the document as something else entirely —
     silently. In a South African medico-legal file that means names: a
     claimant called Ncumisa Šefu or a street in Łódź reaches the firm mangled,
     and nobody finds out until the file is wrong.

     Silent corruption is worse than a visible refusal, so we refuse. The
     honest fix is to embed a Unicode subset font (addFileToVFS + addFont);
     that is a separate, larger change that needs testing on all four forms.
     Until then this tells the claimant exactly which answer to change rather
     than printing rubbish into a legal document. */
  var WINANSI_OK = /^[\x09\x0A\x0D\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;

  function unsupportedCharsIn(record) {
    var bad = [];
    function check(label, text) {
      var v = String(text == null ? '' : text);
      if (!v) return;
      /* Q-S2. This used to test WinAnsi — the standard-14 encoding — and block
         anything outside it, which meant a claimant named Łukasz could not
         submit at all. The document can now embed DejaVu Sans, so the real
         question is no longer "can helvetica print this" but "can the PDF print
         this by any means available". pdf-builder owns that answer because it
         owns the font, and its COVERAGE table was extracted from the font file
         rather than assumed. Only characters DejaVu cannot print either — an
         emoji, which lives outside the BMP — still stop a send. */
      var PDF = window.DrPretoriusLossOfSupportPDF;
      if (PDF && typeof PDF.unprintable === 'function') {
        var bad2 = PDF.unprintable(v);
        if (!bad2.length) return;
        bad.push({ label: label, chars: bad2.join(' ') });
        return;
      }
      /* pdf-builder absent or older than this check: fall back to the strict
         WinAnsi test. Refusing too much is survivable; printing the wrong
         character into a legal document is not. */
      if (WINANSI_OK.test(v)) return;
      /* NINA-CALL-10. This walked the string one UTF-16 CODE UNIT at a time, so
         every emoji and every character outside the BMP was split into two lone
         surrogates and reported to the claimant as two replacement blobs. The
         message named nothing findable. Walk code POINTS. */
      var chars = [];
      var cps = v.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) || [];
      cps.forEach(function (ch) {
        if (!WINANSI_OK.test(ch) && chars.indexOf(ch) === -1) chars.push(ch);
      });
      bad.push({ label: label, chars: chars.join(' ') });
    }
    (record.sections || []).forEach(function (sec) {
      /* ALLISON-forms-022, REOPENED by Allison and she was right: this read
         sec.fields. Sections carry their fields in `f` (SECTIONS[n].f), so
         the list was always empty and unsupportedCharsIn() always returned
         nothing. The check has never executed since the day it was written —
         `Zoë 🙂 مُحَمَّد` sent clean on two apps. A guard that silently does
         nothing is worse than no guard, because the finding reads as closed. */
      (sec.f || []).forEach(function (f) {
        if (!f || !f.k) return;
        if (record.values && record.values[f.k] != null) check(f.l || f.k, record.values[f.k]);
        var rows = (record.entries && record.entries[f.k]) || [];
        rows.forEach(function (row, n) {
          Object.keys(row || {}).forEach(function (kk) {
            check((f.l || f.k) + ' — entry ' + (n + 1), row[kk]);
          });
        });
      });
    });
    return bad;
  }

  /* Q-S2. Does anything the claimant typed need the embedded font? Scans the
     answers as one blob rather than field by field: this only decides WHETHER to
     spend 1.4 MB, and unsupportedCharsIn() does the precise per-field work
     afterwards. WINANSI_OK is anchored and carries no /g, so it is safe to
     reuse here without lastIndex surprises. */
  function needsEmbeddedFont() {
    var blob;
    try {
      blob = JSON.stringify(state.values || {}) + JSON.stringify(state.entries || {});
    } catch (e) {
      return true;   /* cannot tell: load it, rather than block a valid name */
    }
    return !WINANSI_OK.test(blob);
  }

  function submit() {
    if (state.sending || !state.sendAck || !state.recipient) return;
    state.sending = true;
    renderActionBar();
    $('sendError').hidden = true;
    showBusy('Preparing your form', 'This takes a few seconds. Please keep this page open.');

    /* The font is fetched BEFORE the build, because build() is synchronous by
       design and must stay that way. Nothing is fetched at all unless an answer
       actually needs it, so the overwhelming majority of claimants pay nothing.
       build() then picks up whichever family is registered. */
    var PDFNS = window.DrPretoriusLossOfSupportPDF;
    var wantFont = needsEmbeddedFont();
    var fontReady = (wantFont && PDFNS && typeof PDFNS.ensureUnicodeFont === 'function')
      ? PDFNS.ensureUnicodeFont()
      : Promise.resolve(!wantFont);

    fontReady.then(function (ok) {
      if (wantFont && !ok) {
        /* The font could not be fetched. Refuse rather than print the wrong
           characters — the same failure as before this change, reached only when
           the embedded font was needed and unavailable. */
        failSend('Your answers contain characters that need an extra font, and it could '
          + 'not be loaded just now. Check your connection and try again, or telephone '
          + 'the office and they will take the details down as you say them.');
        return;
      }
      submitAfterFont();
    });
  }

  function submitAfterFont() {
    /* Let the overlay paint before the PDF work blocks the main thread. */
    window.setTimeout(function () {
      var record = buildRecord();

      /* ALLISON-forms-022 — refuse rather than corrupt.
         CARL-drplos-003: this runs with the busy overlay already up and
         outside the try that guards the PDF build, so an unexpected throw here
         would lock the form with no route back and nothing persisted. Any
         catch that routes through failSend is enough — failSend clears
         state.sending and hides the overlay. */
      var unsupported;
      try {
        unsupported = unsupportedCharsIn(record);
      } catch (err) {
        failSend('The form could not be checked on this device. Please try again, '
          + 'or telephone the office.');
        return;
      }
      if (unsupported.length) {
        /* NINA-CALL-10. "Some answers contain characters" sends a claimant hunting
           through fifteen sections. Name the characters, and put the fault on the
           document — it is the PDF that cannot print them, not the claimant who
           spelled their own name wrong. */
        var allChars = [];
        unsupported.forEach(function (u) {
          u.chars.split(' ').forEach(function (c) {
            if (c && allChars.indexOf(c) === -1) allChars.push(c);
          });
        });
        var heading = allChars.length === 1
          ? 'One character in your answers cannot be printed in the PDF: ' + allChars[0]
          : 'Some characters in your answers cannot be printed in the PDF: ' + allChars.join('  ');
        var names = unsupported.slice(0, 4).map(function (u) {
          return '\u2022 ' + u.label + '  (' + u.chars + ')';
        }).join('\n');
        failSend(heading + '\n\n'
          + 'They appear in:\n' + names
          + (unsupported.length > 4 ? '\n\u2026 and ' + (unsupported.length - 4) + ' more' : '')
          + '\n\nYou can change them here and send again. If the spelling matters and you '
          + 'cannot change it, telephone the office and they will take it down as you say it.');
        return;
      }
      var doc, base64;
      try {
        doc = window.DrPretoriusLossOfSupportPDF.build(record);
        base64 = doc.output('datauristring').split(',')[1];
      } catch (err) {
        failSend('The PDF could not be created on this device. Please try again, or use a different browser.');
        return;
      }

      var bytes = Math.floor(base64.length * 0.75);
      if (bytes > MAX_PDF_BYTES) {
        failSend('The form is too large to send, most likely because of the photographs or the documents you attached. Please remove one or two and try again.');
        return;
      }

      lastPdf = { doc: doc, filename: pdfFilename(record) };
      showBusy('Sending to Dr Pretorius Inc', 'Please keep this page open until it is done.');

      var payload = {
        firstName: record.values.firstName,
        surname: record.values.surname,
        deceasedFirstName: record.values.decFirstName,
        deceasedSurname: record.values.decSurname,
        claimRef: record.values.claimRef,
        email: record.values.email,
        recipientEmail: state.recipient,
        pdfFilename: lastPdf.filename,
        pdfBase64: base64,
        website: $('website').value
      };

      window.fetch(SEND_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          return { ok: res.ok, body: body };
        });
      }).then(function (result) {
        if (!result.ok) {
          failSend(result.body && result.body.error
            ? result.body.error
            : 'The form could not be sent just now. Please check your connection and try again.');
          return;
        }
        state.sending = false;
        $('busy').hidden = true;
        go('sent');
      }).catch(function () {
        failSend('The form could not be sent just now. Please check your connection and try again.');
      });
    }, 60);
  }

  /* ── Example data, for testing only ──────────────────────────────────
     EVERY identity number below must FAIL the South African Luhn check
     digit. The demo button is on in production, so these numbers sit in the
     page source of a live client site and are printed into any demo PDF; a
     number that PASSES the check is a syntactically valid South African ID
     and may belong to a real living person. `8802110854081` did, and was
     changed to `...080` on 2026-09-22. Check any new one first:

         def ok(n):
             t, dbl = 0, False
             for ch in reversed(n):
                 d = int(ch)
                 if dbl:
                     d *= 2
                     if d > 9: d -= 9
                 t += d
                 dbl = not dbl
             return t % 10 == 0        # True means DO NOT USE
  */
  /* ALLISON-forms-014/015. Does the claimant have anything in the form? */
  function hasAnyEntry() {
    var k;
    for (k in state.values) { if (valueOf(k).trim()) return true; }
    for (k in state.entries) {
      if ((state.entries[k] || []).some(function (e) {
        return Object.keys(e || {}).some(function (kk) { return String(e[kk] || '').trim(); });
      })) return true;
    }
    for (k in state.photos) { if (state.photos[k]) return true; }
    for (k in state.docs) { if (state.docs[k]) return true; }
    return !!(state.sketch || state.signature);
  }

  /* NINA-CALL-09. Stays until dismissed, because a claimant who restores and then
     answers three more questions still needs to know which answers came from the
     file. Built as a real node with textContent only — never innerHTML. */
  function showRestoredBanner(savedAt) {
    var old = document.getElementById('restoredBanner');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var when = '';
    if (savedAt) {
      var d = new Date(savedAt);
      if (!isNaN(d.getTime())) {
        var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                      'August', 'September', 'October', 'November', 'December'];
        when = ' — saved ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
      }
    }

    var bar = el('div', 'notice notice-ok');
    bar.id = 'restoredBanner';
    var body = el('div', 'notice-body', 'Restored from your saved file' + when + '.');
    bar.appendChild(body);
    var dismiss = el('button', 'btn btn-secondary btn-small', 'Hide this');
    dismiss.type = 'button';
    dismiss.addEventListener('click', function () {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    bar.appendChild(dismiss);

    var host = document.getElementById('screen-hub') || document.body;
    host.insertBefore(bar, host.firstChild);
  }

  function fillExample() {
    /* ALLISON-forms-014. This used to overwrite whatever was on the form with
       no warning at all. These apps deliberately store nothing — that is the
       whole design — so there is no undo and no draft to fall back on: a
       claimant part-way through a long medico-legal form lost the lot. The
       passcode gate does not help; it protects the FEATURE, not their work. */
    if (hasAnyEntry() && !window.confirm(
        'This will erase the answers you have already entered and replace them '
        + 'with example data. They cannot be recovered.\n\n'
        + 'If you want to keep them, press Cancel and use "Save progress" first.')) {
      return;
    }
    var v = {
      title: 'Mrs', firstName: 'Nomsa', surname: 'Dlamini', dateOfBirth: '1988/02/11',
      gender: 'Female', citizenship: 'South African', idNumber: '8802110854080',
      relationToDeceased: 'Spouse', claimCapacity: 'In my own right as a dependant',
      email: 'nomsa.dlamini@example.co.za', cell: '082 461 9053', altCell: '073 555 0198',
      addrComplex: 'Unit 12, Rosepark', addrStreet: '14 Rosslyn Street',
      addrTown: 'Pretoria', addrProvince: 'Gauteng', addrPostal: '0186',

      decTitle: 'Mr', decFirstName: 'Sipho', decSurname: 'Dlamini',
      decDateOfBirth: '1985/07/03', decDateOfDeath: '2026/03/08', decTimeOfDeath: '21:15',
      decIdNumber: '8507035800089', decGender: 'Male',
      decCountryBirth: 'South Africa', decCountryResidence: 'South Africa',
      decAddrComplex: 'Unit 12, Rosepark', decAddrStreet: '14 Rosslyn Street',
      decAddrTown: 'Pretoria', decAddrProvince: 'Gauteng', decAddrPostal: '0186',

      roadUser: 'Pedestrian or cyclist', pedMode: 'Walking',
      pedPosition: 'Crossing away from a crossing',
      pedCrossing: 'A pedestrian crossing about 40 metres further along',
      pedVisibility: 'No',

      claimRef: 'RAF-2026-00456', accidentDate: '2026/03/08', accidentTime: '20:40',
      diedAtScene: 'No', diedWhere: 'Steve Biko Academic Hospital, Pretoria',
      diedHowLater: 'About thirty-five minutes later',

      road: 'Lynnwood Road', suburb: 'Lynnwood, Pretoria', province: 'Gauteng',
      conditions: ['Dark', 'Wet road'],
      description: 'My husband was walking home from the taxi rank and was crossing Lynnwood Road when a bakkie came around the bend at speed and struck him. The driver did not stop. A witness telephoned the ambulance and he died at the hospital the same evening.',
      informationFrom: 'From a witness',
      direction: 'Crossing from the north side towards the shops', speed: 'The witness said it was very fast',

      otherName: 'Unknown', otherContact: '', otherVehicleDesc: 'White bakkie, possibly a Toyota Hilux',
      otherReg: 'Not recorded', otherInsurer: '', otherOutcome: 'Unknown', hitAndRun: 'No',

      station: 'Brooklyn SAPS', officer: 'Const. L. Mabaso',
      caseNumber: '412/03/2026', inquestHeld: 'Yes', inquestNumber: 'INQ 88/2026',
      chargesLaid: 'No', reportObtained: 'Yes',

      decHighestGrade: 'Grade 12', decSchoolName: 'Mamelodi High School', decYearLeft: '2003',
      decWorkStatus: 'Employed',
      decOtherIncome: 'He rented out the back room for R1 500 a month.',

      breadwinner: 'Yes, the main income', supportAmount: 'About R11 000 a month',
      supportHowPaid: ['Cash', 'Paid the accounts directly', 'School fees'],
      supportDetail: 'He paid the rent, the electricity and the water, the school fees for both children, and he bought the groceries every month. He also sent R800 to his mother in Mpumalanga.',
      sharedHome: 'Yes',
      incomeNow: 'I work part-time at a crèche and earn R3 200 a month. We receive a child support grant for each child.',
      sinceDeath: 'We could not pay the rent from June and moved in with my mother in August. My eldest had to leave the school she was at because the fees were too much.',

      transport: 'Ambulance',
      causeOfDeath: 'Multiple injuries sustained in a motor vehicle accident',
      postMortem: 'Yes', postMortemRef: 'DR 1147/2026', deathRegistered: 'Yes',

      funeralParlour: 'Doves, Pretoria North', funeralDate: '2026/03/21',
      funeralType: 'Burial', funeralCost: '28400',
      funeralPaidBy: 'I paid, with help from my brother',
      funeralPolicy: 'Yes, it paid out',
      funeralPolicyDetail: 'Old Mutual funeral plan, R20 000',
      otherExpenses: 'Travel to the mortuary in Pretoria twice, and the memorial service at the church.',

      rafClaimLodged: 'No', otherAttorney: 'No',
      benefitsReceived: ['Funeral policy', 'Pension or provident fund'],
      benefitsDetail: 'The provident fund paid R64 000 in October. The UIF claim has been lodged but nothing has been paid.',
      estateReported: 'Yes', executorName: 'Nomsa Dlamini',

      documentsNote: 'We were married by customary rites in 2009 and there is a marriage certificate.',
      sketchNote: 'He was crossing from the north side of Lynnwood Road towards the shops when the bakkie came around the bend.',
      signName: 'Nomsa Dlamini', signCapacity: 'Widow of the deceased', signDate: '2026/03/28'
    };
    Object.keys(v).forEach(function (k) { if (RESTORABLE[k]) state.values[k] = v[k]; });

    state.entries.dependantList = [
      { title: 'Mrs', name: 'Nomsa', surname: 'Dlamini', dateOfBirth: '1988/02/11',
        idNumber: '8802110854080', race: 'Black African', countryBirth: 'South Africa',
        countryResidence: 'South Africa', gender: 'Female', relationship: 'Spouse',
        maritalStatus: 'Widow or widower',
        reasonDependence: 'Wife of the deceased; he paid the rent and all the household costs' },
      { title: 'Miss', name: 'Lindiwe', surname: 'Dlamini', dateOfBirth: '2012/09/04',
        idNumber: '1209044811082', race: 'Black African', countryBirth: 'South Africa',
        countryResidence: 'South Africa', gender: 'Female', relationship: 'Daughter',
        maritalStatus: 'Minor child',
        reasonDependence: 'Minor child at school; the deceased paid her school fees' },
      { title: 'Mr', name: 'Thabo', surname: 'Dlamini', dateOfBirth: '2016/11/22',
        idNumber: '1611225802088', race: 'Black African', countryBirth: 'South Africa',
        countryResidence: 'South Africa', gender: 'Male', relationship: 'Son',
        maritalStatus: 'Minor child',
        reasonDependence: 'Minor child at primary school, wholly supported by the deceased' },
      { title: 'Mrs', name: 'Agnes', surname: 'Dlamini', dateOfBirth: '1958/05/17',
        idNumber: '5805170821085', race: 'Black African', countryBirth: 'South Africa',
        countryResidence: 'South Africa', gender: 'Female', relationship: 'Mother',
        maritalStatus: 'Widow or widower',
        reasonDependence: 'The deceased sent her R800 every month towards her keep' }
    ];
    state.entries.decQualifications = [
      { name: 'National Certificate: Motor Mechanics', institution: 'Tshwane North TVET College', year: '2006' }
    ];
    state.entries.witnessList = [
      { name: 'Sipho', surname: 'Petersen', contact: '072 118 4407', statement: 'Yes' },
      { name: 'Anna', surname: 'de Bruyn', contact: '084 662 3319', statement: 'No' }
    ];
    state.entries.decEmployment = [
      { employer: 'Bidvest Logistics', period: '2019 – 2026', position: 'Workshop foreman',
        remuneration: 'R16 800 per month', reasonLeft: 'Still employed there at the time of death' },
      { employer: 'Cargo Carriers', period: '2011 – 2019', position: 'Diesel mechanic',
        remuneration: 'R11 400 per month', reasonLeft: 'Resigned for a better position' }
    ];
    state.entries.careList = [
      { hospital: 'Steve Biko Academic Hospital', doctor: 'Dr M. Radebe' },
      { hospital: 'Pretoria Government Mortuary', doctor: 'Dr S. Naidoo (pathologist)' }
    ];

    state.sketch = exampleDrawing(560, 320, function (ctx) {
      ctx.strokeStyle = '#1d1f20';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(40, 150); ctx.lineTo(520, 150); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(40, 200); ctx.lineTo(520, 200); ctx.stroke();
      ctx.strokeRect(300, 155, 70, 36);
      ctx.beginPath(); ctx.arc(200, 175, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(200, 184); ctx.lineTo(200, 205); ctx.stroke();
    });
    state.signature = exampleDrawing(520, 170, function (ctx) {
      ctx.strokeStyle = '#1d1f20';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(60, 100);
      ctx.bezierCurveTo(120, 30, 150, 130, 210, 80);
      ctx.bezierCurveTo(260, 40, 300, 120, 360, 70);
      ctx.stroke();
    });
    state.signatureTyped = false;

    /* Stand-in pictures so the attachment pages can be seen in a test run. */
    state.photos.scene = examplePhoto('The intersection', '#4a6a5a');
    state.photos.vehicle = examplePhoto('The bicycle', '#4a5a6a');
    state.photos.damage = examplePhoto('Damage to the front', '#6a5a4a');
    state.docs.reportPage1 = exampleDocPage('Accident report', 1, 2);
    state.docs.reportPage2 = exampleDocPage('Accident report', 2, 2);
    state.docs.certDeath = exampleDocPage('Death certificate', 1, 1);
    state.docs.certDeceasedId = exampleDocPage('Identity document', 1, 1);
    state.docs.certMarriage = exampleDocPage('Marriage certificate', 1, 1);

    SECTIONS.forEach(function (s) { state.done[s.id] = true; });
    state.consent = true;
    state.sendAck = false;
    /* ALLISON-forms-015. The record carried no marker of any kind, so an
       example report was indistinguishable from a real submission in the
       record and in the PDF. */
    state.isExample = true;
    /* And it used to land on "Review and send", every section showing complete
       and consent already given — one checkbox and one button from sending
       fabricated data to the firm. Land on the first section instead: this is
       a filled-in form to look at, not a form ready to send. */
    /* ALLISON-forms-024. This was go(SECTIONS[0].id), which passes a SECTION
       id where go() expects a SCREEN — state.screen became 'personal', which
       renders nothing, and the example run ended on a blank form with an
       uncaught TypeError. Mirror how the rest of the app navigates. */
    go(isDesktop() ? 'section' : 'hub', isDesktop() ? SECTIONS[0].id : null);
  }

  function examplePhoto(caption, tone) {
    var canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 750;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = tone;
    ctx.fillRect(0, 0, 1000, 750);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (var i = 0; i < 10; i++) ctx.fillRect(0, i * 150, 1000, 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 44px Barlow, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXAMPLE PHOTOGRAPH', 500, 350);
    ctx.font = '400 32px Barlow, sans-serif';
    ctx.fillText(caption, 500, 410);
    return canvas.toDataURL('image/jpeg', 0.75);
  }

  function exampleDocPage(title, n, of) {
    var canvas = document.createElement('canvas');
    canvas.width = 850;
    canvas.height = 1200;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4f3ef';
    ctx.fillRect(0, 0, 850, 1200);
    ctx.fillStyle = '#1d1f20';
    ctx.font = '600 34px Barlow, sans-serif';
    ctx.fillText(title.toUpperCase() + ' — EXAMPLE', 60, 110);
    ctx.font = '400 24px Barlow, sans-serif';
    ctx.fillText('Page ' + n + ' of ' + of, 60, 152);
    ctx.fillStyle = 'rgba(29,31,32,0.30)';
    for (var i = 0; i < 26; i++) {
      var w = 480 + ((i * 97) % 240);
      ctx.fillRect(60, 210 + i * 36, w, 9);
    }
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  function exampleDrawing(w, h, paint) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paint(ctx);
    return canvas.toDataURL('image/png');
  }


  /* ── The safety net, made visible ───────────────────────────────────────
     Richard's option C. Reloading this page discards everything, on purpose:
     nothing is written to localStorage, sessionStorage, cookies or IndexedDB,
     and the privacy notice publishes that to the claimant as the strongest
     promise these forms make. Keeping the promise means keeping the loss.

     So the fix is not persistence, it is making the escape hatch impossible to
     miss. "Save progress to this device" was a quiet ghost button that read
     the same whether or not there was anything to lose. It now says how much
     is at stake, and the form says plainly what a reload costs.

     The fingerprint is deliberately cheap and approximate — a count and a
     length, not a hash of the answers. It only ever has to answer "has
     anything changed since the last save", and it must never become a second
     copy of the claimant's data sitting in memory. */
  var savedFingerprint = null;
  /* Option C. The form deliberately does not re-render on every keystroke —
     rebuilding the DOM mid-word would take the cursor with it. So the save
     button is updated IN PLACE instead: it is the one thing on screen that has
     to react to typing, because its whole job is to say how much is at risk
     right now. */
  var saveButtons = [];

  function refreshSaveButtons() {
    var unsaved = hasUnsavedWork();
    var count = answeredCount();
    saveButtons = saveButtons.filter(function (b) { return b.btn && b.btn.isConnected; });
    saveButtons.forEach(function (b) {
      b.btn.textContent = unsaved
        ? 'Save progress \u2014 ' + count + (count === 1 ? ' answer' : ' answers') + ' not yet saved'
        : (savedFingerprint === null ? 'Save progress to this device' : 'Progress saved \u2713');
      b.btn.className = 'btn btn-small ' + (unsaved ? 'btn-primary' : 'btn-ghost');
      if (b.note) b.note.hidden = !(unsaved && count >= 3);
    });
  }


  function formFingerprint() {
    var n = 0, len = 0;
    Object.keys(state.values).forEach(function (k) {
      var v = valueOf(k);
      if (v) { n++; len += v.length; }
    });
    Object.keys(state.entries).forEach(function (k) {
      (state.entries[k] || []).forEach(function (e) {
        Object.keys(e || {}).forEach(function (kk) {
          var v = String(e[kk] || ''); if (v) { n++; len += v.length; }
        });
      });
    });
    Object.keys(state.photos).forEach(function (k) { if (state.photos[k]) { n++; len += 1; } });
    Object.keys(state.docs).forEach(function (k) { if (state.docs[k]) { n++; len += 1; } });
    if (state.sketch) { n++; len += 1; }
    if (state.signature) { n++; len += 1; }
    return n + ':' + len;
  }

  function answeredCount() {
    return parseInt(String(formFingerprint()).split(':')[0], 10) || 0;
  }

  function hasUnsavedWork() {
    return answeredCount() > 0 && formFingerprint() !== savedFingerprint;
  }

  /* ── Wiring ────────────────────────────────────────────────────────── */
  /* The warning belongs HERE, not only in the terms of use. On the accident
     form the saved file held one person's answers. On this one it holds the
     identity numbers of the deceased and of every dependant — minors
     included — and the scanned death certificate, identity document and
     marriage certificate as images: a quarter of a megabyte of a whole
     family's identity, in plain JSON, on whatever device is to hand. That is
     frequently a borrowed or shared phone. Someone who has read clause 5 of
     the terms is not who we are protecting; someone who taps a button that
     says only "save" is. */
  function addSaveButton(host) {
    var unsaved = hasUnsavedWork();
    var count = answeredCount();
    var btn = el('button', 'btn btn-small ' + (unsaved ? 'btn-primary' : 'btn-ghost'),
      unsaved
        ? 'Save progress \u2014 ' + count + (count === 1 ? ' answer' : ' answers') + ' not yet saved'
        : (savedFingerprint === null ? 'Save progress to this device' : 'Progress saved \u2713'));
    btn.type = 'button';
    btn.addEventListener('click', saveDraft);
    host.appendChild(btn);
    var note = el('p', 'field-hint');
    note.textContent = 'Nothing is stored on this website, so closing or reloading this page '
      + 'will lose these answers. Saving puts a file on your own device that you can load '
      + 'back in later.';
    note.hidden = !(unsaved && count >= 3);
    host.appendChild(note);
    saveButtons.push({ btn: btn, note: note });
    host.appendChild(el('p', 'field-hint save-warning',
      'The saved file holds everything you have typed, including identity '
      + 'numbers and any document you have photographed. Keep it safe, and do '
      + 'not use this on a shared or public computer.'));
    return btn;
  }

  function init() {
    $('consentRow').addEventListener('click', function () {
      state.consent = !state.consent;
      $('consentRow').setAttribute('aria-checked', state.consent ? 'true' : 'false');
      renderActionBar();
    });

    $('sendAckRow').addEventListener('click', function () {
      state.sendAck = !state.sendAck;
      $('sendAckRow').setAttribute('aria-checked', state.sendAck ? 'true' : 'false');
      renderActionBar();
    });

    $('sidebarReview').addEventListener('click', function () { go('review'); });

    $('rescuePdf').addEventListener('click', function () {
      if (lastPdf) lastPdf.doc.save(lastPdf.filename);
    });

    $('recipientCancel').addEventListener('click', function () { closeDialog('recipientDialog'); });
    trapDialog('recipientDialog');

    $('draftInput').addEventListener('change', function () {
      var file = $('draftInput').files && $('draftInput').files[0];
      $('draftInput').value = '';
      if (!file) return;
      /* NINA-CALL-09, first half. Nina asked for a three-way choice — replace,
         fill only the blanks, or cancel — on the premise that a restore MERGES.
         It no longer does: ALLISON-forms-018 / CARL-drplos-001 made restoreDraft
         call resetForNewSubmission(), so it is a clean replace. Building a
         merge mode now would undo that fix, so the choice is the honest two:
         replace, or cancel. The third option is recorded as not built, and why.
         What the replace made newly dangerous is that it destroys whatever is on
         the form in silence — the same defect ALLISON-forms-014 fixed for the
         example fill, on a path that never got the same treatment. */
      if (hasAnyEntry() && !window.confirm(
          'This will replace every answer on this form with the ones in your saved file. '
          + 'Anything you have typed since you saved cannot be recovered.\n\n'
          + 'Press Cancel to keep what is on the form.')) {
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var savedAt = null;
        try { savedAt = JSON.parse(String(reader.result)).savedAt; } catch (e) { savedAt = null; }
        var result = restoreDraft(String(reader.result));
        if (result === 'version') {
          window.alert('That progress file was saved before the questions on this form changed, '
            + 'so it cannot be loaded into this version. Please telephone the office if you would '
            + 'rather not fill the form in again.');
          return;
        }
        if (result !== true) {
          window.alert('That file is not a saved progress file for this form. A file saved on the '
            + 'accident information form cannot be loaded here — the questions are different.');
          return;
        }
        /* NINA-CALL-09, second half. One claimant, one form, possibly weeks
           apart — the DATE is the whole value of the sentence, and there was
           nothing anywhere on screen saying a restore had happened at all. */
        showRestoredBanner(savedAt);
        go(isDesktop() ? 'section' : 'hub', isDesktop() ? SECTIONS[0].id : null);
      };
      reader.onerror = function () { window.alert('That file could not be read.'); };
      reader.readAsText(file);
    });

    /* "Save progress" sits outside the action bar so the two designed
       buttons stay exactly where the claimant expects them. */
    var hubSave = el('div', 'hub-save');
    addSaveButton(hubSave);
    $('screen-hub').appendChild(hubSave);

    var sideSave = el('div', 'side-save');
    addSaveButton(sideSave);
    $('sidebar').querySelector('.sidebar-sticky').appendChild(sideSave);

    /* Crossing the phone/laptop breakpoint changes the whole navigation
       model, so re-render rather than leaving a half-adapted screen. */
    var mq = window.matchMedia('(min-width: 900px)');
    var onChange = function () { render(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);

    /* Nothing is stored, so leaving mid-form loses the answers. Warn once. */
    window.addEventListener('beforeunload', function (ev) {
      var started = SECTIONS.some(sectionStarted);
      if (!started || state.screen === 'sent') return;
      ev.preventDefault();
      ev.returnValue = '';
    });

    loadRecipientMenu();

    if (demoAllowed()) {
      /* The dock is fixed over the right-hand edge of the page, where the
         Remove buttons of a repeatable entry live. Tell the stylesheet it is
         there so the content can move out from under it on a phone. */
      document.body.classList.add('has-demo');
      $('demoDock').hidden = false;
      $('demoDock').addEventListener('click', function () {
        $('demoError').hidden = true;
        $('demoCode').value = '';
        openDialog('demoDialog', $('demoCode'));
      });
      $('demoCancel').addEventListener('click', function () { closeDialog('demoDialog'); });
      $('demoConfirm').addEventListener('click', function () {
        if ($('demoCode').value !== DEMO_PASSCODE) { $('demoError').hidden = false; return; }
        $('demoDialog').hidden = true;
        dialogReturn = null;
        fillExample();
      });
      $('demoCode').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') $('demoConfirm').click();
      });
      trapDialog('demoDialog');
    }

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
