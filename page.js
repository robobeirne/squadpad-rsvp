(function () {
  'use strict';
  var TOKEN = /^scprsvp1\.[a-f0-9]{64}$/;
  var UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  var form = document.getElementById('reply');
  var confirmButton = document.getElementById('confirm');
  var status = document.getElementById('status');
  var openApp = document.getElementById('open-app');
  var radios = Array.prototype.slice.call(form.querySelectorAll('input[name="answer"]'));
  var params = new URLSearchParams(location.hash.slice(1));
  var token = params.get('t') || '';
  var answer = params.get('a') === 'no' ? 'no' : 'yes';
  // The reminder names the club's Supabase project; only the club's own projects are accepted.
  var REFS = ["ygncvcnuedematspfnyy","cksibelhbijkzsoryffk"];
  var ref = params.get('r') || '';
  var ENDPOINT = REFS.indexOf(ref) >= 0 ? 'https://' + ref + '.supabase.co/functions/v1/club-rsvp' : '';
  var busy = false;
  var pending = null;
  var storageKey = null;

  function say(text, isError) { status.textContent = text; status.className = isError ? 'error' : ''; }
  function chosen() { var r = radios.filter(function (x) { return x.checked; })[0]; return r ? r.value : answer; }
  function choose(value) { radios.forEach(function (x) { x.checked = x.value === value; }); }
  function appLink(value) {
    var url = new URL('stpauls://rsvp');
    url.searchParams.set('rsvp', token);
    url.searchParams.set('a', value);
    return url.toString();
  }
  function refresh() {
    var locked = !!pending || busy;
    radios.forEach(function (x) { x.disabled = locked; });
    confirmButton.disabled = busy;
    confirmButton.textContent = busy ? 'Sending…' : pending ? 'Retry reply' : 'Confirm';
    openApp.href = appLink(chosen());
  }
  async function keyFor(value) {
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.origin + '/club-rsvp:' + value));
    return 'club-rsvp-pending:' + Array.from(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function readPending() {
    var raw = sessionStorage.getItem(storageKey);
    if (raw === null) return null;
    var value = JSON.parse(raw);
    if (!value || value.token !== token || ['yes', 'no'].indexOf(value.answer) < 0 || typeof value.operationID !== 'string' || !UUID.test(value.operationID)) throw Error('unreadable');
    return value;
  }
  function clearPending(operationID) {
    try { var raw = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (raw && raw.operationID === operationID) sessionStorage.removeItem(storageKey); } catch (e) { /* keep */ }
    pending = null;
  }
  function confirmation(current) {
    var name = current && typeof current.childName === 'string' && current.childName ? current.childName : 'Your player';
    var label = current && current.answer === 'yes' ? 'available' : current && current.answer === 'no' ? 'not available'
      : current && current.answer === 'maybe' ? 'maybe available' : 'without a current reply';
    var opponent = current && typeof current.opponent === 'string' && current.opponent ? 'the match against ' + current.opponent : 'the match';
    return 'Reply confirmed. ' + name + ' is currently ' + label + ' for ' + opponent + '.';
  }
  var failures = {
    400: 'Check the reply and try again.',
    401: 'This reply link is no longer available. Open the latest reminder email, or reply in the app.',
    403: 'This reply link is no longer available. Open the latest reminder email, or reply in the app.',
    404: 'This reply link is no longer available. Open the latest reminder email, or reply in the app.',
    409: 'That game has already been played.',
    413: 'Check the reply and try again.',
    422: 'Check the reply and try again.',
    429: 'Too many replies. Wait a moment, then retry the same reply.'
  };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    var value = chosen();
    if (pending && pending.answer !== value) { say('Retry your previous reply before changing it.', true); return; }
    if (!pending) {
      pending = { token: token, answer: value, operationID: crypto.randomUUID() };
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
      catch (e) { pending = null; say('This browser cannot keep a safe retry. Please reply in the app.', true); return; }
    }
    busy = true; refresh(); say('Sending…', false);
    var sent = pending, response, data;
    try {
      response = await fetch(ENDPOINT, { method: 'POST', credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent) });
      data = await response.json();
    } catch (e) {
      busy = false; refresh(); say('Your reply is uncertain. Retry the same reply.', true); return;
    }
    busy = false;
    if (response.ok) {
      var receipt = data && data.receipt;
      if (!data || data.ok !== true || !receipt || receipt.operationID !== sent.operationID.toLowerCase() || receipt.authorisationMode !== 'rsvpCapability'
        || receipt.answer !== sent.answer || !data.current || [null, undefined, '', 'yes', 'no', 'maybe'].indexOf(data.current.answer) < 0) {
        refresh(); say('Your reply could not be verified. Retry the same reply.', true); return;
      }
      clearPending(sent.operationID);
      form.hidden = true;
      openApp.href = appLink(sent.answer);
      say(confirmation(data.current), false);
      status.className = 'done';
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
      return;
    }
    if (failures[response.status] && response.status !== 429) {
      clearPending(sent.operationID);
      form.hidden = response.status === 401 || response.status === 403 || response.status === 404 || response.status === 409;
    }
    refresh();
    say(failures[response.status] || 'Your reply could not be confirmed. Retry the same reply.', true);
  }

  async function start() {
    if (!TOKEN.test(token) || !ENDPOINT) { say('This reply link is incomplete. Open the reminder email again, or reply in the app.', true); return; }
    try {
      storageKey = await keyFor(token);
      pending = readPending();
    } catch (e) { say('The previous reply cannot be read safely. Please reply in the app.', true); return; }
    if (pending) answer = pending.answer;
    choose(answer);
    radios.forEach(function (x) { x.addEventListener('change', refresh); });
    form.addEventListener('submit', submit);
    form.hidden = false;
    openApp.hidden = false;
    refresh();
    say(pending ? 'Your last reply was not confirmed. Retry it to be sure it reached the coach.' : 'Choose an answer, then tap Confirm to send it to the coach.', false);
  }
  start();
})();
