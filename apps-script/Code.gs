/**
 * When&Where Drone Light Shows — inquiry form backend
 * (same setup as the main site's inquiry form)
 *
 * Paste this whole file into a PRIVATE Sheet:
 *   1. Create a new Google Sheet, e.g. "When&Where Drone Inquiries".
 *   2. Extensions → Apps Script, replace the default Code.gs contents
 *      with this file.
 *
 * 3. Change NOTIFY_EMAIL at the top below to the personal email you
 *    want new-inquiry notifications sent to. SEND_CONFIRMATION (just
 *    below it) is on by default — it also sends the visitor a short
 *    confirmation email styled like the notification. Those two are
 *    the only settings in this file — everything else stays as it is.
 * 4. Deploy → New deployment → Web app
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Copy the Web app URL and paste it as INQUIRY_ENDPOINT in
 *    config.js (WHENWHERE_CONFIG, at the top of the file), then rebuild
 *    (python3 tools/build.py) and push.
 * 6. Push the site once. From then on the form saves straight to the
 *    private Sheet and emails you. Reply from that personal Gmail.
 *
 * The script creates an 'Inquiries' tab on first submit if it does
 * not exist yet. The first row is a header row, written when the tab
 * is still empty. It appends one row per inquiry, in this order:
 *   Submitted Date | Name | Email | Phone | Event Type | Event Date |
 *   Venue/Town | Expected guests | Budget Estimate | Package | Stage |
 *   isSurprise | Would love to see
 *
 * The notification email is sent twice over: a plain-text body for
 * clients that can't render HTML, and an htmlBody laid out like the
 * form itself (Night & Gold, one labelled row per field). Reply-To is
 * the visitor's email, so Reply in Gmail goes straight to them.
 *
 * If you change this code after deploying, Deploy → Manage deployments
 * → edit the deployment and pick the new version — otherwise the live
 * Web app URL keeps running the old code.
 *
 * Spam guard: one inquiry per email + event date per 5 minutes. A
 * repeat inside that window gets {"ok":true,"duplicate":true} back,
 * but no second row and no second email — the page treats that as
 * success, because the inquiry is already in. The form itself also
 * blocks a re-send from the same browser for 5 minutes — the server
 * check is the one that can't be bypassed by posting straight at the
 * endpoint.
 *
 * Answers are JSON ({"ok":true} / {"ok":false,"error":...}) because
 * Apps Script always returns HTTP 200 — the page reads the body, not
 * the status. Values are sanitized before appendRow so a leading =,
 * + - or @ can't run as a formula in the Sheet.
 */
/* ---- Settings: change this one line, nothing else ----
   To notify more than one person, list addresses separated by
   commas, e.g. 'you@gmail.com, partner@example.com'. Everyone
   listed gets the same email, and Reply-To is still the visitor. */
var NOTIFY_EMAIL = 'your-personal-email@example.com';

/** On = each NEW inquiry also gets a short confirmation email (see
 * buildConfirmEmail), styled like the notification — same Night &
 * Gold wrapper, same field rows, no Sheet link (that stays
 * owner-only). Off = notify only. Either way the row is saved first
 * and mail is best-effort; a mail failure never fails a saved inquiry. */
var SEND_CONFIRMATION = true;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* JSON answer — Apps Script always returns HTTP 200, even when doPost
   rejects the submission, so the body is the verdict, not the status.
   The page parses this and only shows "thank you" when ok is true. */
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Sheets formula injection: a value starting with =, +, - or @ (or a
   tab / carriage return) is read as a formula when the Sheet is opened.
   Prefix such values with a single quote so a hostile dream or name
   field can't run code in the leads Sheet. The quote is a display
   marker, not part of the value. */
function safeCell(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/**
 * Builds the confirmation email to the visitor (plain text + HTML).
 * Pure, like the notify bodies — no SpreadsheetApp/MailApp calls — so
 * the wording and the escaping can be tested without a live Sheet.
 *
 * Same Night & Gold inline styling as the notification email, same
 * labelled field rows, but no Sheet link: that stays owner-only. The
 * copy promises only what the site already promises (a personal reply,
 * usually within two working days — the pipeline doc's stated aim) and
 * says plainly that nothing else is coming unless they ask — the
 * confirmation is a receipt, not the start of a mailing list. Replies
 * go to NOTIFY_EMAIL when it is set (see doPostInner); otherwise they
 * go to the script owner's Gmail, which is the same inbox.
 *
 * @param {string} email The visitor's address.
 * @param {Array<Array<string>>} fields Label/value pairs, as built in
 *   doPostInner — only non-empty values are shown.
 * @param {string} dream The visitor's free-text note, may be empty.
 * @return {{subject: string, body: string, htmlBody: string}} The three
 *   parts MailApp.sendEmail takes.
 */
function buildConfirmEmail(email, fields, dream) {
  var subject = 'Thanks \u2014 your drone light show inquiry is in';
  var lines = ['Thanks \u2014 your inquiry is in.', ''];
  var rows = '';
  for (var i = 0; i < fields.length; i++) {
    var v = (fields[i][1] || '').trim();
    if (!v) continue;
    lines.push(fields[i][0] + ': ' + v);
    rows += '<tr><td style="padding:9px 14px 9px 0;vertical-align:top;width:150px;'
      + 'font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#d9a441;'
      + 'font-weight:700;">' + esc(fields[i][0]) + '</td>'
      + '<td style="padding:9px 0;vertical-align:top;font-size:15px;color:#ffffff;">'
      + esc(v) + '</td></tr>';
  }
  dream = (dream || '').trim();
  if (dream) {
    lines.push('', 'In the sky:', dream);
  }
  lines.push('', 'Justin will reply personally to confirm your date, usually within two working days.',
    '', 'This email was sent to ' + email + ' because someone submitted an inquiry with that address.',
    'If that wasn\u2019t you, just ignore it \u2014 nothing else is coming unless you ask.',
    '', '\u2014 When&Where', 'whenwhere.biz');
  var body = lines.join('\n');
  var dreamHtml = dream
    ? '<p style="margin:18px 0 0;padding:14px 16px;background:#141a3d;border-radius:8px;'
      + 'font-size:15px;line-height:1.6;color:#e8ecff;">' + esc(dream).replace(/\r?\n/g, '<br>') + '</p>'
    : '';
  var htmlBody =
    '<div style="background:#060a1a;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" '
    + 'style="width:100%;max-width:600px;background:#0d1230;border:1px solid #d9a441;'
    + 'border-radius:12px;padding:28px 30px;">'
    + '<tr><td style="font-size:11px;letter-spacing:.3em;color:#d9a441;font-weight:700;">'
    + 'WHEN&amp;WHERE.BIZ</td></tr>'
    + '<tr><td style="padding:8px 0 4px;font-family:Georgia,serif;font-size:26px;color:#ffffff;">'
    + 'Thanks \u2014 your inquiry is in</td></tr>'
    + '<tr><td style="padding:0 0 14px;font-size:13px;color:#aab3d6;">'
    + 'We\u2019ve got it, and Justin will reply personally to confirm your date, '
    + 'usually within two working days.</td></tr>'
    + '<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" '
    + 'style="width:100%;border-top:1px solid #2a3263;">' + rows + '</table></td></tr>'
    + (dream ? '<tr><td style="padding:16px 0 0;font-size:11px;letter-spacing:.14em;'
      + 'text-transform:uppercase;color:#d9a441;font-weight:700;">In the sky</td></tr>'
      + '<tr><td>' + dreamHtml + '</td></tr>' : '')
    + '<tr><td style="padding:18px 0 0;font-size:13px;line-height:1.6;color:#aab3d6;">'
    + 'This email was sent to ' + esc(email) + ' because someone submitted an inquiry '
    + 'with that address. If that wasn\u2019t you, just ignore it \u2014 nothing else is '
    + 'coming unless you ask.</td></tr>'
    + '</table></div>';
  return { subject: subject, body: body, htmlBody: htmlBody };
}

function doPost(e) {
  try {
    return doPostInner(e);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function doPostInner(e) {
  var p = (e && e.parameter) || {};

  /* Spam guard — drop a repeat of the same email + event date inside
     5 minutes. The lock keeps two simultaneous posts from both
     slipping through; if the lock can't be had, check the cache
     anyway and carry on (fail open, never drop a real inquiry). */
  if (p.email) {
    var throttleKey = 'inq:' + String(p.email).trim().toLowerCase()
      + '|' + String(p.date || '').trim();
    var cache = CacheService.getScriptCache();
    var lock = LockService.getScriptLock();
    var haveLock = false;
    try { haveLock = lock.tryLock(5000); } catch (err) { haveLock = false; }
    try {
      if (cache.get(throttleKey)) return jsonOut({ ok: true, duplicate: true });
      cache.put(throttleKey, '1', 300);
    } finally {
      if (haveLock) { try { lock.releaseLock(); } catch (err2) {} }
    }
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Inquiries') || ss.insertSheet('Inquiries');
  /* First row is the header. It is written once, when the tab is still
     empty — a sheet that already has rows keeps whatever headers it
     has, so this never duplicates them. If you are adding headers to
     an existing sheet by hand, insert a row at the top instead of
     typing over row 1. */
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Submitted Date', 'Name', 'Email', 'Phone', 'Event Type',
      'Event Date', 'Venue/Town', 'Expected guests', 'Budget Estimate',
      'Package', 'Stage', 'isSurprise', 'Would love to see']);
  }
  sheet.appendRow([new Date(), safeCell(p.name), safeCell(p.email),
    safeCell(p.phone), safeCell(p.type), safeCell(p.date),
    safeCell(p.venue), safeCell(p.guests), safeCell(p.budget),
    safeCell(p.pkg), safeCell(p.stage), safeCell(p.surprise),
    safeCell(p.dream)]);

  /* Link back to the Inquiries tab, for the full history — it goes in
     the notification email (plain text + HTML) so one click opens the
     Sheet at the row this inquiry just landed in. */
  var sheetUrl = ss.getUrl().split('#')[0] + '#gid=' + sheet.getSheetId();

  var fields = [
    ['Name', p.name], ['Email', p.email], ['Phone', p.phone],
    ['Event type', p.type], ['Event date', p.date],
    ['Venue / town', p.venue], ['Expected guests', p.guests],
    ['Rough budget', p.budget], ['Package of interest', p.pkg],
    ['Planning stage', p.stage], ['Surprise', p.surprise]
  ];

  /* Plain-text body — also the fallback for clients without HTML. */
  var textLines = ['New drone light show inquiry — ' + (p.type || 'event'), ''];
  for (var i = 0; i < fields.length; i++) {
    var v = (fields[i][1] || '').trim();
    if (v) textLines.push(fields[i][0] + ': ' + v);
  }
  var dream = (p.dream || '').trim();
  if (dream) textLines.push('', 'In the sky, we would love to see:', dream);
  textLines.push('', 'View all inquiries in the Sheet: ' + sheetUrl);
  var text = textLines.join('\n');

  /* HTML body — same fields, laid out like the form. */
  var rows = '';
  for (var j = 0; j < fields.length; j++) {
    var val = (fields[j][1] || '').trim();
    if (!val) continue;
    rows += '<tr><td style="padding:9px 14px 9px 0;vertical-align:top;width:150px;'
      + 'font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#d9a441;'
      + 'font-weight:700;">' + esc(fields[j][0]) + '</td>'
      + '<td style="padding:9px 0;vertical-align:top;font-size:15px;color:#ffffff;">'
      + esc(val) + '</td></tr>';
  }
  var dreamHtml = dream
    ? '<p style="margin:18px 0 0;padding:14px 16px;background:#141a3d;border-radius:8px;'
      + 'font-size:15px;line-height:1.6;color:#e8ecff;">' + esc(dream).replace(/\n/g, '<br>') + '</p>'
    : '';
  var html =
    '<div style="background:#060a1a;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" '
    + 'style="width:100%;max-width:600px;background:#0d1230;border:1px solid #d9a441;'
    + 'border-radius:12px;padding:28px 30px;">'
    + '<tr><td style="font-size:11px;letter-spacing:.3em;color:#d9a441;font-weight:700;">'
    + 'WHEN&amp;WHERE.BIZ</td></tr>'
    + '<tr><td style="padding:8px 0 4px;font-family:Georgia,serif;font-size:26px;color:#ffffff;">'
    + 'New drone inquiry — ' + esc(p.type || 'event') + '</td></tr>'
    + '<tr><td style="padding:0 0 14px;font-size:13px;color:#aab3d6;">'
    + 'Saved to your private Sheet &middot; Inquiries tab. Reply from your personal Gmail.</td></tr>'
    + '<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" '
    + 'style="width:100%;border-top:1px solid #2a3263;">' + rows + '</table></td></tr>'
    + (dream ? '<tr><td style="padding:16px 0 0;font-size:11px;letter-spacing:.14em;'
      + 'text-transform:uppercase;color:#d9a441;font-weight:700;">In the sky</td></tr>'
      + '<tr><td>' + dreamHtml + '</td></tr>' : '')
    + '<tr><td style="padding:18px 0 0;font-size:14px;">'
      + '<a href="' + esc(sheetUrl) + '" style="color:#d9a441;">View all inquiries in the private Sheet &rarr;</a></td></tr>'
    + '</table></div>';

  /* The visitor's confirmation goes FIRST, then the owner
     notification — if the daily MailApp quota runs out mid-send, the
     person waiting on proof their inquiry landed gets the email, not
     just the owner. Both are best-effort; neither can fail the save.
     Deduped repeats never reach here (they return 'ok' above), so
     nobody gets a second confirmation. A leftover placeholder
     NOTIFY_EMAIL is never mailed to — the notify is skipped and the
     confirmation's replies go to the script owner's Gmail. */
  var email = (p.email || '').trim();
  var notifyOk = !!NOTIFY_EMAIL && NOTIFY_EMAIL !== 'your-personal-email@example.com';
  if (SEND_CONFIRMATION && email) {
    try {
      var confirm = buildConfirmEmail(email, fields, dream);
      var confirmOpts = { htmlBody: confirm.htmlBody, name: 'When&Where.biz' };
      if (notifyOk) confirmOpts.replyTo = NOTIFY_EMAIL;
      MailApp.sendEmail(email, confirm.subject, confirm.body, confirmOpts);
    } catch (confirmErr) {
      Logger.log('Drone inquiry saved but confirmation email failed: ' + confirmErr);
    }
  }
  /* Notification is best-effort: the row above is already saved, so a
     mail failure (bad NOTIFY_EMAIL, daily MailApp quota) must not
     report a saved inquiry as failed. */
  if (notifyOk) {
    try {
      MailApp.sendEmail(NOTIFY_EMAIL,
        'New drone light show inquiry — ' + (p.type || 'event'), text,
        { htmlBody: html, replyTo: email, name: 'When&Where.biz' });
    } catch (mailErr) {
      Logger.log('Drone inquiry saved but notification email failed: ' + mailErr);
    }
  }
  return jsonOut({ ok: true });
}
