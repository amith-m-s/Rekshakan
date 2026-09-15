// Control UI for the phone simulator. Plain DOM; server state arrives over Server-Sent Events.
// Everything from the server (names, alert text) is inserted as text, never as HTML.

const KINDS = ['fire', 'smoke', 'blocked_road', 'needs_help', 'other'];
const $ = id => document.getElementById(id);

let state = null;
let spotsKey = '';
let pendingPhoneRender = false;
const drafts = new Map(); // per-phone form values that survive re-renders

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function flash(message) {
  const box = $('flash');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => (box.hidden = true), 6000);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // 429 (local throttle) and 502 (dashboard rejected) are shown in the log, not as errors here.
  if (!res.ok && res.status !== 429 && res.status !== 502) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const act = promise => promise.catch(e => flash(e.message));

function formValues(form) {
  const values = Object.fromEntries(new FormData(form));
  for (const input of form.querySelectorAll('input[type=number]')) values[input.name] = Number(input.value);
  return values;
}

function spotOptions() {
  const { presets, live } = state.spots;
  return [
    live.length ? el('optgroup', { label: 'Live evacuation zones' }, live.map(s => el('option', { value: s.id }, s.label))) : null,
    el('optgroup', { label: 'Preset places' }, presets.map(s => el('option', { value: s.id }, s.label))),
  ];
}

// Only rebuild place dropdowns when the list of places changes, so open dropdowns aren't reset.
function renderSpotSelects() {
  const key = [...state.spots.live, ...state.spots.presets].map(s => s.id).join();
  if (key === spotsKey) return;
  spotsKey = key;
  for (const select of document.querySelectorAll('select.spot-select')) {
    const current = select.value || select.dataset.default || '';
    select.replaceChildren(...spotOptions().filter(Boolean));
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }
  pendingPhoneRender = true;
}

function phoneCard(phone) {
  const draft = drafts.get(phone.id) ?? { kind: 'fire', message: '', spotId: '' };
  drafts.set(phone.id, draft);

  const kind = el(
    'select',
    { onchange: e => (draft.kind = e.target.value), 'aria-label': 'Report type' },
    KINDS.map(k => el('option', { value: k }, k.replace('_', ' ')))
  );
  kind.value = draft.kind;

  const place = el(
    'select',
    { onchange: e => (draft.spotId = e.target.value), 'aria-label': 'Place' },
    el('option', { value: '' }, 'Choose a place…'),
    spotOptions()
  );
  place.value = draft.spotId;

  const moveTo = mode => () =>
    draft.spotId
      ? act(api('POST', `/api/phones/${phone.id}/move`, mode === 'drive' ? { destinationSpotId: draft.spotId } : { spotId: draft.spotId }))
      : flash('Choose a place first');

  return el(
    'article',
    { class: 'phone' },
    el('div', { class: 'status-bar' }, el('span', {}, phone.model), el('span', {}, `battery ${phone.battery}%`)),
    el('h3', {}, phone.name, el('small', { class: 'muted' }, ` #${phone.id}`)),
    el('p', { class: 'where' }, phone.destination ? `Driving to ${phone.destination.label}` : `Near ${phone.near}`),
    el('p', { class: 'muted mono' }, `${phone.lat.toFixed(4)}, ${phone.lng.toFixed(4)}`),
    el('p', { class: 'muted' }, `sent ${phone.sent} · failed ${phone.failed} · ${phone.lastStatus}`),
    el(
      'div',
      { class: 'row' },
      kind,
      el('button', { onclick: () => act(api('POST', `/api/phones/${phone.id}/report`, { kind: draft.kind, message: draft.message, scatterMeters: 300 })) }, 'Send report')
    ),
    el('input', { placeholder: 'Message (optional)', maxlength: 500, value: draft.message, oninput: e => (draft.message = e.target.value) }),
    el('div', { class: 'row' }, place, el('button', { class: 'secondary', onclick: moveTo('teleport') }, 'Teleport'), el('button', { class: 'secondary', onclick: moveTo('drive') }, 'Drive')),
    el(
      'div',
      { class: 'inbox' },
      el('h4', {}, `Inbox (${phone.inbox.length})`),
      phone.inbox.length
        ? phone.inbox.map(n =>
            el('div', { class: 'notification' }, el('strong', {}, n.title), n.body ? el('p', {}, n.body) : null, el('small', { class: 'muted' }, `${n.source} · ${new Date(n.at).toLocaleTimeString()}`))
          )
        : el('p', { class: 'muted' }, 'No notifications yet')
    ),
    el('button', { class: 'link', onclick: () => act(api('DELETE', `/api/phones/${phone.id}`)) }, 'Remove phone')
  );
}

function renderPhones() {
  const container = $('phones');
  // Don't rebuild cards while someone is typing or choosing in one; catch up when focus leaves.
  if (container.contains(document.activeElement) && document.activeElement !== document.body) {
    pendingPhoneRender = true;
    return;
  }
  pendingPhoneRender = false;
  for (const id of drafts.keys()) if (!state.phones.some(p => p.id === id)) drafts.delete(id);
  container.replaceChildren(
    ...(state.phones.length ? state.phones.map(phoneCard) : [el('p', { class: 'muted empty' }, 'No phones. Add one or start a scenario.')])
  );
}

function render() {
  $('target').textContent = `Sending as phones to ${state.config.target}`;
  $('rate').textContent = `${state.sentLastMinute}/${state.config.maxPerMinute} reports in the last minute`;
  $('scenario-status').textContent = state.scenario
    ? `Running: ${state.scenario.name} (since ${new Date(state.scenario.startedAt).toLocaleTimeString()})`
    : 'No scenario running.';
  renderSpotSelects();
  renderPhones();
}

function addLog(entry) {
  const list = $('log');
  list.prepend(
    el('li', { class: entry.level }, el('span', { class: 'muted' }, new Date(entry.at).toLocaleTimeString()), ' ', entry.phone ? el('b', {}, `${entry.phone}: `) : null, entry.message)
  );
  while (list.children.length > 150) list.lastChild.remove();
}

function setConnected(ok) {
  const badge = $('conn');
  badge.textContent = ok ? 'live' : 'reconnecting…';
  badge.className = `badge ${ok ? 'on' : 'off'}`;
}

function onSubmit(id, handler) {
  $(id).addEventListener('submit', e => {
    e.preventDefault();
    act(handler(formValues(e.target), e.target));
  });
}

async function start() {
  for (const select of document.querySelectorAll('select.kind-select')) {
    select.append(...KINDS.map(k => el('option', { value: k }, k.replace('_', ' '))));
  }

  onSubmit('add-phone', values => api('POST', '/api/phones', values));
  onSubmit('burst', values => api('POST', '/api/scenarios/burst', values));
  onSubmit('stream', values => api('POST', '/api/scenarios/stream', values));
  onSubmit('evacuation', values => api('POST', '/api/scenarios/evacuation', values));
  onSubmit('notify', (values, form) => api('POST', '/api/inbox', { ...values, source: 'simulator UI' }).then(() => form.reset()));
  $('stop').addEventListener('click', () => act(api('POST', '/api/scenarios/stop')));
  $('refresh-spots').addEventListener('click', () => act(api('POST', '/api/spots/refresh')));
  $('phones').addEventListener('focusout', () => setTimeout(() => pendingPhoneRender && state && renderPhones(), 0));

  const initial = await api('GET', '/api/state');
  state = initial;
  initial.log.slice().reverse().forEach(addLog);
  render();

  const events = new EventSource('/api/events');
  events.addEventListener('open', () => setConnected(true));
  events.addEventListener('error', () => setConnected(false));
  events.addEventListener('state', e => {
    state = JSON.parse(e.data);
    render();
  });
  events.addEventListener('log', e => addLog(JSON.parse(e.data)));
}

start().catch(e => flash(`Could not load simulator state: ${e.message}`));
