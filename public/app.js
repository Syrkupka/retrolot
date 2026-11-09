'use strict';
// Клієнт RetroLot: невеликий SPA на History API. Кожен екран з даними має стани завантаження / порожньо / помилка.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const state = { lang: 'uk', me: null, config: {}, skew: 0, cats: null, flash: null };
try { state.lang = localStorage.getItem('lang') === 'en' ? 'en' : 'uk'; } catch { /* сховище заблоковане: лишаємо мову за замовчуванням */ }

const t = (k, p = {}) => String(I18N[state.lang][k] ?? k).replace(/\{(\w+)\}/g, (_, x) => p[x] ?? '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const locale = () => (state.lang === 'uk' ? 'uk-UA' : 'en-GB');
const money = (n) => `${Number(n).toLocaleString(locale())} ${t('grn')}`;
const fmtDate = (ms) => new Date(ms).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const now = () => Date.now() + state.skew;
const pad = (n) => String(n).padStart(2, '0');

function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d ? `${d} ${t('days')} ${hms}` : hms;
}

// ---------- запити до сервера (API) ----------
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw Object.assign(new Error(t('err_network')), { code: 'network' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.detail || res.statusText), { status: res.status, code: data?.title, data });
  return data;
}

function errText(e) {
  if (e.code === 'bid_too_low') return t('err_bid_too_low', { min: Number(e.data.min_bid).toLocaleString(locale()) });
  const k = `err_${e.code}`;
  return I18N[state.lang][k] ? t(k) : e.message;
}

// Показує помилки полів від сервера поруч із відповідними полями.
function showFieldErrors(form, e) {
  $$('.field-error', form).forEach((x) => x.remove());
  $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
  for (const er of e.data?.errors || []) {
    const name = er.field.replace(/\[\d+\]$/, '');
    const input = form.elements[name] || $(`[data-field="${name}"]`, form);
    if (!input) continue;
    const msg = document.createElement('span');
    msg.className = 'field-error';
    msg.textContent = t(`rule_${er.rule}`, er);
    if (input.setAttribute) input.setAttribute('aria-invalid', 'true');
    (input.closest('label') || input).after(msg);
  }
  $('[aria-invalid]', form)?.focus();
}

// ---------- допоміжна функція трьох станів ----------
async function loadInto(el, fetcher, draw) {
  el.innerHTML = `<p class="state" role="status">${t('loading')}</p>`;
  try {
    draw(await fetcher());
  } catch (e) {
    el.innerHTML = `<div class="state state-error" role="alert"><p>${t('error')}. ${esc(errText(e))}</p><button class="btn" type="button">${t('retry')}</button></div>`;
    $('button', el).onclick = () => loadInto(el, fetcher, draw);
  }
}
const emptyHtml = (hint = t('empty_hint')) => `<div class="state state-empty"><p><strong>${t('empty')}</strong></p><p>${hint}</p></div>`;

function pager(el, data, go) {
  if (data.pages <= 1) return;
  const nav = document.createElement('nav');
  nav.className = 'pager';
  nav.setAttribute('aria-label', 'pagination');
  nav.innerHTML = `<button class="btn" type="button" ${data.page <= 1 ? 'disabled' : ''}>${t('prev')}</button>
    <span>${t('page', { n: data.page, of: data.pages })}</span>
    <button class="btn" type="button" ${data.page >= data.pages ? 'disabled' : ''}>${t('next')}</button>`;
  const [prev, next] = $$('button', nav);
  prev.onclick = () => go(data.page - 1);
  next.onclick = () => go(data.page + 1);
  el.append(nav);
}

function lotPhase(l) {
  const n = now();
  if (l.status !== 'active') return l.status;
  if (l.starts_at > n) return 'upcoming';
  return l.ends_at > n ? 'live' : 'ended';
}

// eager: перші картки вантажаться одразу, бо це найбільший елемент першого екрана (Lighthouse LCP)
function card(l, extra = '', eager = false) {
  const ph = lotPhase(l);
  const badge = { live: ['live', t('live')], upcoming: ['soon', t('upcoming')], ended: ['', t('ended')] }[ph];
  return `<a class="card${ph === 'live' ? ' is-live' : ''}" href="/lot/${l.id}" data-link>
    <img src="${esc(l.image)}" alt="" loading="${eager ? 'eager' : 'lazy'}" width="300" height="300">
    <span class="card-body">
      <span class="card-title">${esc(l.title)}</span>
      <span class="card-price${ph === 'live' ? ' live' : ''}"><small>${l.bid_count > 0 ? t('current_bid') : t('start_price')}</small>${money(l.current_price)}</span>
      <span class="card-date">${ph === 'upcoming' ? `${t('starts')}: ${fmtDate(l.starts_at)}` : `${t('ends')}: ${fmtDate(l.ends_at)}`}</span>
      ${badge ? `<span class="badge ${badge[0]}">${badge[1]}</span>` : ''}${extra}
    </span></a>`;
}

async function categories() {
  if (!state.cats) state.cats = await api('/categories');
  return state.cats;
}
const catName = (c) => (state.lang === 'uk' ? c.name_uk : c.name_en);

// ---------- каталог (головна + історія) ----------
async function catalogPage(app, kind) {
  const isHistory = kind === 'history';
  if (isHistory && !state.me) return go('/login?next=/history');
  const q = new URLSearchParams(location.search);
  const cats = isHistory ? [] : await categories().catch(() => []);
  const sel = (name, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${q.get(name) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const sortOpts = ['ends', 'starts', 'new', 'price_asc', 'price_desc'].map((s) => [s, t(`sort_${s}`)]);
  if (isHistory) sortOpts.unshift(['', '-']);
  app.innerHTML = `
    <h1 class="${isHistory ? '' : 'sr-only'}">${isHistory ? t('history_title') : t('lots_title')}</h1>
    <form class="searchbar" role="search">
      <label class="sr-only" for="q">${t('search')}</label>
      <input id="q" name="q" type="search" placeholder="${t('search')}" value="${esc(q.get('q'))}" maxlength="100">
      <button class="btn" type="button" id="filter-toggle" aria-expanded="false" aria-controls="filters">${t('filter')}</button>
    </form>
    <form class="filters" id="filters" hidden>
      ${isHistory ? `<label>${t('h_filter')}${sel('filter', ['all', 'bought', 'sold', 'bid'].map((f) => [f, t(`h_${f}`)]))}</label>` : ''}
      <label>${t('sort')}${sel('sort', sortOpts)}</label>
      ${isHistory ? '' : `
      <label>${t('state')}${sel('state', ['all', 'live', 'upcoming'].map((s) => [s, t(`state_${s}`)]))}</label>
      <label>${t('category')}${sel('category', [['', t('any')], ...cats.map((c) => [String(c.id), esc(catName(c))])])}</label>
      <label>${t('price_from')}<input name="min" type="number" min="0" inputmode="numeric" value="${esc(q.get('min'))}"></label>
      <label>${t('price_to')}<input name="max" type="number" min="0" inputmode="numeric" value="${esc(q.get('max'))}"></label>`}
      <div class="filter-actions"><button class="btn primary" type="submit">${t('apply')}</button><button class="btn" type="reset">${t('reset')}</button></div>
    </form>
    <p class="count" id="count" aria-live="polite"></p>
    <section id="list" aria-label="${t('lots_title')}"></section>`;

  const filters = $('#filters', app);
  const toggle = $('#filter-toggle', app);
  toggle.onclick = () => {
    filters.hidden = !filters.hidden;
    toggle.setAttribute('aria-expanded', String(!filters.hidden));
  };
  const params = () => {
    const p = new URLSearchParams();
    const qv = $('#q', app).value.trim();
    if (qv) p.set('q', qv);
    for (const el of filters.elements) if (el.name && el.value && el.value !== 'all') p.set(el.name, el.value);
    return p;
  };
  const load = (page = 1) => {
    const p = params();
    if (page > 1) p.set('page', page);
    history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}`);
    p.set('size', '20');
    const list = $('#list', app);
    loadInto(list, () => api(`${isHistory ? '/history' : '/lots'}?${p}`), (data) => {
      $('#count', app).textContent = data.total ? t('found', { n: data.total }) : '';
      if (data.now) state.skew = data.now - Date.now();
      if (!data.items.length) { list.innerHTML = emptyHtml(); return; }
      list.innerHTML = `<div class="grid">${data.items.map((l, i) => card(l, isHistory ? relation(l) : '', i < 4)).join('')}</div>`;
      pager(list, data, (n) => { load(n); window.scrollTo(0, 0); });
    });
  };
  $('.searchbar', app).onsubmit = (e) => { e.preventDefault(); load(); };
  let debounce;
  // пошук запускається через 400 мс після останньої натиснутої клавіші
  $('#q', app).oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 400);
  };
  filters.onsubmit = (e) => { e.preventDefault(); load(); };
  filters.onreset = () => {
    // після скидання повертаємо кожне поле до першого варіанта і перезавантажуємо список
    setTimeout(() => {
      for (const field of filters.elements) {
        if (!field.name) continue;
        if (field.tagName === 'SELECT') {
          field.value = field.options[0].value;
        } else {
          field.value = '';
        }
      }
      load();
    });
  };
  load(Number(q.get('page')) || 1);
  return () => clearTimeout(debounce);
}

function relation(l) {
  if (l.relation === 'bought') {
    const key = l.payment_status === 'paid' ? 'rel_bought' : 'rel_won_unpaid';
    return `<span class="rel rel-bought">${t(key)}</span>`;
  }
  if (l.relation === 'sold' && l.status === 'ended') return `<span class="rel rel-sold">${t('rel_sold')}</span>`;
  return `<span class="rel">${t('rel_bid')}</span>`;
}

// ---------- сторінка лота ----------
async function lotPage(app, id) {
  let lot;
  let idx = 0;
  let timer;
  app.innerHTML = `<p class="state" role="status">${t('loading')}</p>`;
  try {
    lot = await api(`/lots/${id}`);
  } catch (e) {
    app.innerHTML = e.status === 404 ? notFoundHtml() : `<div class="state state-error" role="alert"><p>${t('error')}. ${esc(errText(e))}</p></div>`;
    return;
  }
  state.skew = lot.now - Date.now();
  document.title = `${lot.title} | RetroLot`;
  app.innerHTML = `
    <div class="lot">
      <section class="gallery" aria-label="${t('photo', { n: 1, of: lot.images.length })}">
        <div class="frame">
          <img id="main-img" alt="">
          <button class="arrow prev" type="button" aria-label="${t('prev_photo')}">&lsaquo;</button>
          <button class="arrow next" type="button" aria-label="${t('next_photo')}">&rsaquo;</button>
        </div>
        <div class="thumbs">${lot.images.map((src, i) => `<button type="button" data-i="${i}" aria-label="${t('photo', { n: i + 1, of: lot.images.length })}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>
      </section>
      <section class="info" id="info"></section>
    </div>
    <div class="timebar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="${t('time_left')}"><div class="fill" id="fill"></div></div>
    <div class="timeinfo" id="timeinfo"></div>
    <div class="panel" id="extra"></div>
    <section class="panel"><h2>${t('bid_history')}</h2><div id="bids"></div></section>
    <dialog id="bid-dialog" aria-labelledby="bid-title"></dialog>`;

  let slideTimer;
  let paused = false; // поки мишка або фокус клавіатури в галереї
  const restartSlides = () => {
    clearInterval(slideTimer);
    slideTimer = setInterval(() => { if (!paused && !document.hidden) show(idx + 1, true); }, 5000);
  };
  const show = (i, auto = false) => {
    idx = (i + lot.images.length) % lot.images.length;
    const img = $('#main-img', app);
    img.src = lot.images[idx];
    img.alt = `${lot.title}: ${t('photo', { n: idx + 1, of: lot.images.length })}`;
    $$('.thumbs button', app).forEach((b, j) => {
      b.setAttribute('aria-current', String(j === idx));
      // поточна мініатюра має бути видна в смузі прокрутки, сама сторінка при цьому не прокручується
      if (j === idx) b.parentElement.scrollTo({ left: b.offsetLeft - (b.parentElement.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
    });
    if (!auto) restartSlides(); // після ручного вибору наступне фото з'явиться через повні 5 секунд
  };
  $('.prev', app).onclick = () => show(idx - 1);
  $('.next', app).onclick = () => show(idx + 1);
  $('.thumbs', app).onclick = (e) => {
    const thumb = e.target.closest('button');
    if (thumb) show(Number(thumb.dataset.i));
  };
  const gallery = $('.gallery', app);
  gallery.onkeydown = (e) => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  };
  gallery.onmouseenter = gallery.onfocusin = () => { paused = true; };
  gallery.onmouseleave = () => { paused = gallery.contains(document.activeElement); };
  gallery.onfocusout = (e) => { if (!gallery.contains(e.relatedTarget)) paused = gallery.matches(':hover'); };

  // приближення при наведенні: фото збільшується в 2,5 раза навколо точки під курсором
  const frame = $('.frame', app);
  const zoomImg = $('#main-img', app);
  frame.onmousemove = (e) => {
    if (e.target.closest('.arrow')) { zoomImg.style.transform = ''; return; } // не приближуємо, поки курсор на стрілці
    const r = frame.getBoundingClientRect();
    zoomImg.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    zoomImg.style.transform = 'scale(2.5)';
  };
  frame.onmouseleave = () => { zoomImg.style.transform = ''; };
  show(0);

  const drawInfo = () => {
    const ph = lotPhase(lot);
    const priceLabel = lot.bid_count > 0 ? t('current_bid') : t('start_price');
    let actions = '';
    if (ph === 'live' && !lot.is_owner) {
      if (!state.me) actions = `<a class="btn primary wide" href="/login?next=/lot/${lot.id}" data-link>${t('login_to_bid')}</a>`;
      else actions = `<button class="btn primary wide" type="button" id="bid-btn">${t('place_bid')}</button>`;
    }
    if (lot.my_payment) {
      const p = lot.my_payment;
      if (p.status === 'pending') actions += `<a class="btn primary wide" href="/pay/${p.id}" data-link>${t('pay')} ${money(p.amount)}</a><p class="note">${t('pay_until', { d: fmtDate(p.due_at) })}</p>`;
      if (p.status === 'paid') actions += `<p class="note ok">${t('paid')}: ${money(p.amount)}</p>`;
      if (p.status === 'expired') actions += `<p class="note warn">${t('payment_expired')}</p>`;
    }
    $('#info', app).innerHTML = `
      <h1>${esc(lot.title)}</h1>
      <p class="muted">${esc(state.lang === 'uk' ? lot.category_uk : lot.category_en)} · #${lot.id}</p>
      ${['pending', 'rejected', 'cancelled', 'withdrawn'].includes(lot.status) ? `<p class="note warn">${t(`st_${lot.status}`)}${lot.admin_note ? `. ${t('admin_note')}: ${esc(lot.admin_note)}` : ''}</p>` : ''}
      ${lot.tags.length ? `<p class="tags">${lot.tags.map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : ''}
      <div class="desc" tabindex="0" role="region" aria-label="${t('description')}">${esc(lot.description)}</div>
      <dl class="facts">
        <div><dt>${priceLabel}</dt><dd class="price${ph === 'live' ? ' live' : ''}">${money(lot.current_price)}</dd></div>
        <div><dt>${t('min_step')}</dt><dd>${money(lot.min_step)}</dd></div>
        <div><dt>${t('bids_count')}</dt><dd>${lot.bid_count}</dd></div>
      </dl>
      ${lot.leading && ph === 'live' ? `<p class="note ok">${t('you_lead')}</p>` : ''}
      ${lot.my_auto && ph === 'live' ? `<p class="note">${t('my_auto', { n: lot.my_auto.toLocaleString(locale()) })} <button class="link" type="button" id="auto-off">${t('auto_off')}</button></p>` : ''}
      <div class="actions">${actions}</div>
      ${state.me && ['active', 'ended'].includes(lot.status) ? `<button class="btn wide" type="button" id="watch" aria-pressed="${lot.watching}">${lot.watching ? t('unwatch') : t('watch')}</button>` : ''}
      ${lot.can_edit ? `<div class="row"><a class="btn" href="/lot/${lot.id}/edit" data-link>${t('edit')}</a><button class="btn" type="button" id="withdraw">${t('withdraw')}</button></div>` : ''}
      <p class="msg" id="lot-msg" role="status"></p>`;
    $('#bid-btn', app)?.addEventListener('click', openBid);
    $('#watch', app)?.addEventListener('click', async () => {
      await api(`/lots/${lot.id}/watch`, { method: lot.watching ? 'DELETE' : 'PUT' }).catch(() => {});
      await refresh();
    });
    $('#auto-off', app)?.addEventListener('click', async () => {
      await api(`/lots/${lot.id}/auto-bid`, { method: 'PUT', body: { max_amount: 0 } }).catch(() => {});
      await refresh();
    });
    $('#withdraw', app)?.addEventListener('click', async () => {
      if (!confirm(t('confirm_withdraw'))) return;
      try { await api(`/lots/${lot.id}/withdraw`, { method: 'POST' }); await refresh(); } catch (e) { $('#lot-msg', app).textContent = errText(e); }
    });
  };

  const drawExtra = () => {
    let html = '';
    if (lot.winner) {
      const w = lot.winner;
      html += `<h2>${t('winner')}: ${esc(w.name || `${w.first_name} ${w.last_name}`)} · ${money(w.amount)}</h2>`;
      html += w.status === 'paid'
        ? `<p>${t('winner_paid')}</p><p>${esc(w.first_name)} ${esc(w.last_name)}, ${esc(w.phone)}, ${esc(w.email)}<br>${esc(w.address)}</p>`
        : `<p>${w.status === 'pending' ? t('winner_waiting', { d: fmtDate(w.due_at) }) : t('payment_expired')}</p>`;
    }
    if (lot.seller) {
      const s = lot.seller;
      html += `<h2>${t('seller_info')}</h2><p>${esc(s.first_name)} ${esc(s.last_name)} (${esc(s.name)}), ${esc(s.email)}, ${esc(s.phone)}<br>${esc(s.address)}<br>${t('payout_card')}: **** ${esc(s.payout_card_last4)}</p>`;
      if (['active', 'ended'].includes(lot.status)) {
        html += `<form id="cancel-form" class="inline-form"><label>${t('cancel_reason')}<input name="note" required minlength="3" maxlength="500"></label><button class="btn danger" type="submit">${t('cancel_auction')}</button></form>`;
      }
    }
    const extra = $('#extra', app);
    extra.hidden = !html;
    extra.innerHTML = html;
    $('#cancel-form', app)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/admin/lots/${lot.id}/cancel`, { method: 'POST', body: { note: e.target.note.value } }); await refresh(); } catch (er) { showFieldErrors(e.target, er); }
    });
  };

  const drawBids = () => {
    const el = $('#bids', app);
    if (!lot.bids.length) { el.innerHTML = `<p class="state state-empty">${t('no_bids')}</p>`; return; }
    el.innerHTML = `<table class="bids"><thead><tr><th scope="col">${t('bidder', { n: '' }).trim()}</th><th scope="col">${t('amount')}</th><th scope="col">${t('date')}</th></tr></thead><tbody>
      ${lot.bids.map((b) => `<tr class="${b.mine ? 'mine' : ''}"><td>${b.mine ? t('you') : t('bidder', { n: b.bidder })}${b.is_auto ? ` <small>(${t('auto')})</small>` : ''}</td><td>${money(b.amount)}</td><td>${fmtDate(b.created_at)}</td></tr>`).join('')}
    </tbody></table>`;
  };

  const tick = () => {
    const ph = lotPhase(lot);
    const n = now();
    const fill = $('#fill', app);
    const info = $('#timeinfo', app);
    if (!fill) return;
    let p;
    if (ph === 'live') {
      p = (n - lot.starts_at) / (lot.ends_at - lot.starts_at);
      fill.style.background = `hsl(${Math.round(120 * (1 - p))} 70% 45%)`; // зелений -> жовтий -> червоний
      info.innerHTML = `<span>${t('ends')}: ${fmtDate(lot.ends_at)}</span><span class="sep" aria-hidden="true"></span><span>${t('time_left')}: <strong>${dur(lot.ends_at - n)}</strong></span>`;
    } else if (ph === 'upcoming') {
      p = (n - lot.created_at) / (lot.starts_at - lot.created_at);
      fill.style.background = 'var(--blue)';
      info.innerHTML = `<span class="center">${t('starts_in', { t: `<strong>${dur(lot.starts_at - n)}</strong>` })} (${fmtDate(lot.starts_at)})</span>`;
    } else {
      p = 1;
      fill.style.background = 'var(--muted)';
      info.innerHTML = `<span class="center">${t('ended_at', { d: fmtDate(lot.ends_at) })}</span>`;
    }
    p = Math.min(1, Math.max(0, p));
    fill.style.width = `${(p * 100).toFixed(2)}%`;
    fill.parentElement.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (ph !== lot._ph) { lot._ph = ph; if (lot._drawn) drawInfo(); }
  };

  async function refresh() {
    try {
      const fresh = await api(`/lots/${id}`);
      state.skew = fresh.now - Date.now();
      lot = fresh;
      if (!$('#bid-dialog', app)?.open) drawInfo();
      drawExtra();
      drawBids();
    } catch { /* якщо оновлення не вдалося, лишаємо останні дані */ }
  }

  function openBid() {
    const dlg = $('#bid-dialog', app);
    const key = crypto.randomUUID(); // той самий ключ для всіх спроб у цьому вікні, тож повторне надсилання не створить другу ставку
    dlg.innerHTML = `<form method="dialog" class="bid-form" novalidate>
      <h2 id="bid-title">${t('place_bid')}</h2>
      <p>${t('current_bid')}: <strong>${money(lot.current_price)}</strong></p>
      <label>${t('your_bid')}<input name="amount" type="number" inputmode="numeric" min="${lot.min_bid}" max="${lot.min_bid * 10}" step="1" value="${lot.min_bid}" required></label>
      <small id="min-hint">${t('min_bid', { n: lot.min_bid.toLocaleString(locale()) })}</small>
      <label class="check"><input name="auto" type="checkbox"> ${t('auto_bid')}</label>
      <label id="auto-wrap" hidden>${t('auto_max')}<input name="auto_max" type="number" inputmode="numeric" min="${lot.min_bid}" step="1"></label>
      <p class="msg" role="alert" id="bid-err"></p>
      <div class="row"><button class="btn" type="button" value="cancel" id="bid-cancel">${t('cancel')}</button><button class="btn primary" type="submit">${t('confirm_bid')}</button></div>
    </form>`;
    const form = $('form', dlg);
    form.auto.onchange = () => { $('#auto-wrap', dlg).hidden = !form.auto.checked; };
    $('#bid-cancel', dlg).onclick = () => dlg.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = { amount: Number(form.amount.value) };
      if (form.auto.checked && form.auto_max.value) body.auto_max = Number(form.auto_max.value);
      const btn = $('[type=submit]', form);
      btn.disabled = true;
      try {
        const r = await api(`/lots/${lot.id}/bids`, { method: 'POST', body, headers: { 'Idempotency-Key': key } });
        dlg.close();
        await refresh();
        $('#lot-msg', app).textContent = r.leading ? `${t('bid_ok')}. ${t('you_lead')}` : t('bid_outbid_auto');
      } catch (er) {
        $('#bid-err', dlg).textContent = errText(er);
        if (er.data?.min_bid) {
          form.amount.min = er.data.min_bid;
          form.amount.value = er.data.min_bid;
          $('#min-hint', dlg).textContent = t('min_bid', { n: er.data.min_bid.toLocaleString(locale()) });
        }
        showFieldErrors(form, er);
      } finally {
        btn.disabled = false;
      }
    };
    dlg.showModal();
    form.amount.focus();
  }

  drawInfo();
  drawExtra();
  drawBids();
  lot._drawn = true;
  tick();
  const clock = setInterval(tick, 1000);
  timer = setInterval(() => { if (['active'].includes(lot.status) && !document.hidden) refresh(); }, 4000);
  return () => { clearInterval(clock); clearInterval(timer); clearInterval(slideTimer); };
}

// ---------- створення / редагування лота ----------
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

async function lotFormPage(app, id) {
  if (!state.me) return go(`/login?next=${location.pathname}`);
  const editing = Boolean(id);
  app.innerHTML = `<p class="state" role="status">${t('loading')}</p>`;
  let lot, me, cats;
  try {
    [cats, me, lot] = await Promise.all([categories(), api('/auth/me'), editing ? api(`/lots/${id}`) : null]);
  } catch (e) {
    app.innerHTML = e.status === 404 ? notFoundHtml() : `<div class="state state-error" role="alert"><p>${t('error')}. ${esc(errText(e))}</p></div>`;
    return;
  }
  if (editing && !lot.can_edit) {
    app.innerHTML = `<div class="state state-error" role="alert"><p>${t('err_edit_locked')}</p><a class="btn" href="/lot/${id}" data-link>${esc(lot.title)}</a></div>`;
    return;
  }
  const images = editing ? [...lot.images] : [];
  const start = lot?.starts_at ?? Math.ceil((Date.now() + 15 * 60000) / 300000) * 300000;
  const end = lot?.ends_at ?? start + 3 * 86400000;
  app.innerHTML = `
    <h1>${editing ? t('edit_title') : t('create_title')}</h1>
    ${state.me.role === 'admin' && !editing ? `<p><button class="btn" type="button" id="test-fill">${t('test_fill')}</button></p>` : ''}
    <form class="lot-form" novalidate>
      <label>${t('title')}<input name="title" required minlength="3" maxlength="120" value="${esc(lot?.title)}"></label>
      <label>${t('description')}<textarea name="description" required minlength="10" maxlength="5000" rows="6">${esc(lot?.description)}</textarea></label>
      <div class="cols">
        <label>${t('category')}<select name="category_id" required><option value="">-</option>${cats.map((c) => `<option value="${c.id}"${lot?.category_id === c.id ? ' selected' : ''}>${esc(catName(c))}</option>`).join('')}</select></label>
        <label>${t('tags')}<input name="tags" placeholder="${t('tags_hint')}" value="${esc(lot?.tags.join(', '))}"></label>
        <label>${t('start_price')}, ${t('grn')}<input name="start_price" type="number" min="1" inputmode="numeric" required value="${lot?.start_price ?? ''}"></label>
        <label>${t('min_step')}, ${t('grn')}<input name="min_step" type="number" min="1" inputmode="numeric" required value="${lot?.min_step ?? ''}"></label>
        <label>${t('start_at')}<input name="starts_at" type="datetime-local" required value="${toLocalInput(start)}"></label>
        <label>${t('end_at')}<input name="ends_at" type="datetime-local" required value="${toLocalInput(end)}"></label>
      </div>
      <fieldset data-field="images"><legend>${t('photos')}</legend>
        <div class="drop" id="drop" tabindex="0" role="button">${t('drop')}</div>
        <input type="file" id="files" accept="image/jpeg,image/png,image/webp" multiple hidden>
        <div class="previews" id="previews"></div>
      </fieldset>
      ${editing ? '' : `
      <fieldset class="author"><legend>${t('author')}</legend>
        <p class="muted">${t('author_hint')}</p>
        <div class="cols">
          <label>${t('first_name')}<input name="first_name" required autocomplete="given-name" value="${esc(me.first_name)}"></label>
          <label>${t('last_name')}<input name="last_name" required autocomplete="family-name" value="${esc(me.last_name)}"></label>
          <label>${t('phone')}<input name="phone" type="tel" required autocomplete="tel" value="${esc(me.phone)}"></label>
          <label>${t('email')}<input name="email" type="email" readonly value="${esc(me.email)}"></label>
          <label class="span2">${t('address')}<input name="address" required autocomplete="address-line1" value="${esc(me.address)}"></label>
          <label class="span2">${t('payout_card')}<input name="card_number" required inputmode="numeric" autocomplete="off" maxlength="23"><small>${t('payout_hint')}</small></label>
        </div>
      </fieldset>`}
      <p class="msg" id="form-msg" role="alert"></p>
      <button class="btn primary" type="submit">${editing ? t('save') : t('submit_lot')}</button>
    </form>`;

  const form = $('form', app);
  const drop = $('#drop', app);
  const fileInput = $('#files', app);
  const drawPreviews = () => {
    $('#previews', app).innerHTML = images.map((src, i) => `<figure><img src="${esc(src)}" alt="${t('photo', { n: i + 1, of: images.length })}"><button type="button" class="btn small" data-i="${i}">${t('remove')}</button></figure>`).join('');
  };
  const addFiles = async (files) => {
    for (const f of [...files].filter((x) => /^image\/(jpeg|png|webp)$/.test(x.type)).slice(0, 10 - images.length)) {
      try { images.push(await resizeImage(f)); } catch { /* файл, який не вдалося прочитати, пропускаємо */ }
    }
    drawPreviews();
  };
  // кнопка "Прибрати" під фото
  $('#previews', app).onclick = (e) => {
    const removeButton = e.target.closest('button');
    if (!removeButton) return;
    images.splice(Number(removeButton.dataset.i), 1);
    drawPreviews();
  };
  drop.onclick = () => fileInput.click();
  drop.onkeydown = (e) => {
    // з клавіатури блок відкривається клавішею Enter або пробілом
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  };
  fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  };
  drawPreviews();

  // лише для адміна, для демонстрації: заповнює всі поля і додає фото однієї демо-речі
  $('#test-fill', app)?.addEventListener('click', async (e) => {
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const f = form.elements;
    const n = rnd(100, 999);
    f.title.value = `${t('test_lot')} ${n}`;
    f.description.value = t('test_desc');
    const cat = cats[rnd(0, cats.length - 1)];
    f.category_id.value = String(cat.id);
    f.tags.value = t('test_tags');
    f.start_price.value = rnd(2, 100) * 50;
    f.min_step.value = 50;
    const startAt = Math.ceil((Date.now() + 15 * 60000) / 300000) * 300000;
    f.starts_at.value = toLocalInput(startAt);
    f.ends_at.value = toLocalInput(startAt + 3 * 86400000);
    // дані автора підставляємо лише в порожні поля
    if (!f.first_name.value) f.first_name.value = 'Тест';
    if (!f.last_name.value) f.last_name.value = 'Адміністратор';
    if (!f.phone.value) f.phone.value = '+380 50 123 45 67';
    if (!f.address.value) f.address.value = 'м. Одеса, вул. Тестова, 1';
    f.card_number.value = '4242 4242 4242 4242';
    e.target.disabled = true;
    // фото однієї речі з демо-набору тієї ж категорії: /img/seed/<категорія>-<річ>-<номер>.jpg
    const item = rnd(1, 5);
    images.length = 0;
    for (let k = 1; k <= 4; k++) {
      const src = `/img/seed/${cat.id}-${item}-${k}.jpg`;
      try { images.push(await resizeImage(await (await fetch(src)).blob())); } catch { /* пропускаємо файл, якого немає */ }
    }
    drawPreviews();
    e.target.disabled = false;
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements;
    const body = {
      title: f.title.value, description: f.description.value, category_id: Number(f.category_id.value) || null,
      tags: f.tags.value.split(',').map((x) => x.trim()).filter(Boolean),
      start_price: Number(f.start_price.value) || null, min_step: Number(f.min_step.value) || null,
      starts_at: new Date(f.starts_at.value).getTime() || null, ends_at: new Date(f.ends_at.value).getTime() || null,
      images,
    };
    if (!editing) {
      body.seller = { first_name: f.first_name.value, last_name: f.last_name.value, phone: f.phone.value, address: f.address.value, card_number: f.card_number.value };
    }
    const btn = $('[type=submit]', form);
    btn.disabled = true;
    try {
      const r = editing ? await api(`/lots/${id}`, { method: 'PUT', body }) : await api('/lots', { method: 'POST', body });
      state.flash = t('lot_sent');
      go(`/lot/${r.id}`);
    } catch (er) {
      $('#form-msg', app).textContent = errText(er);
      showFieldErrors(form, er);
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- оплата ----------
async function payPage(app, id) {
  if (!state.me) return go(`/login?next=${location.pathname}`);
  app.innerHTML = `<h1>${t('pay_title')}</h1><div id="pay"></div>`;
  const box = $('#pay', app);
  loadInto(box, () => Promise.all([api(`/payments/${id}`), api('/auth/me')]), ([p, me]) => {
    const head = `<div class="pay-head"><img src="${esc(p.image)}" alt=""><div><a href="/lot/${p.lot_id}" data-link>${esc(p.title)}</a><p>${t('amount')}: <strong>${money(p.amount)}</strong></p></div></div>`;
    if (p.status === 'paid') { box.innerHTML = `${head}<p class="note ok">${t('paid')}: **** ${esc(p.card_last4)}, ${fmtDate(p.paid_at)}</p>`; return; }
    if (p.status === 'expired') { box.innerHTML = `${head}<p class="note warn">${t('payment_expired')}</p>`; return; }
    box.innerHTML = `${head}
      <p class="note">${t('pay_until', { d: fmtDate(p.due_at) })}</p>
      <form class="lot-form" novalidate>
        <fieldset><legend>${t('buyer')}</legend><div class="cols">
          <label>${t('first_name')}<input name="first_name" required autocomplete="given-name" value="${esc(me.first_name)}"></label>
          <label>${t('last_name')}<input name="last_name" required autocomplete="family-name" value="${esc(me.last_name)}"></label>
          <label>${t('phone')}<input name="phone" type="tel" required autocomplete="tel" value="${esc(me.phone)}"></label>
          <label>${t('email')}<input name="email" type="email" required autocomplete="email" value="${esc(me.email)}"></label>
          <label class="span2">${t('address')}<input name="address" required autocomplete="address-line1" value="${esc(me.address)}"></label>
        </div></fieldset>
        <fieldset><legend>${t('card_number')}</legend><div class="cols">
          <label class="span2">${t('card_number')}<input name="card_number" required inputmode="numeric" autocomplete="cc-number" maxlength="23"></label>
          <label>${t('card_exp')}<input name="card_exp" required placeholder="MM/YY" autocomplete="cc-exp" maxlength="5"></label>
          <label>${t('card_cvv')}<input name="card_cvv" required inputmode="numeric" autocomplete="cc-csc" maxlength="4"></label>
        </div></fieldset>
        <p class="muted">${t('pay_demo')}</p>
        <p class="msg" id="pay-msg" role="alert"></p>
        <button class="btn primary" type="submit">${t('pay_btn', { n: p.amount.toLocaleString(locale()) })}</button>
      </form>`;
    const form = $('form', box);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(['first_name', 'last_name', 'phone', 'email', 'address', 'card_number', 'card_exp', 'card_cvv'].map((k) => [k, form.elements[k].value]));
      const btn = $('[type=submit]', form);
      btn.disabled = true;
      try {
        await api(`/payments/${id}/pay`, { method: 'POST', body });
        box.innerHTML = `${head}<p class="note ok">${t('receipt_sent', { e: esc(body.email) })}</p>`;
      } catch (er) {
        $('#pay-msg', box).textContent = errText(er);
        showFieldErrors(form, er);
        btn.disabled = false;
      }
    };
  });
}

// ---------- профіль ----------
async function profilePage(app) {
  if (!state.me) return go('/login?next=/profile');
  app.innerHTML = `<h1>${t('profile_title')}</h1>
    <div class="panel" id="p-form"></div>
    <section class="panel"><div class="row between"><h2>${t('notifications')}</h2><button class="btn small" type="button" id="read-all">${t('mark_read')}</button></div><div id="p-notes"></div></section>
    <section class="panel"><h2>${t('watchlist')}</h2><div id="p-watch"></div></section>
    <section class="panel"><h2>${t('my_bids')}</h2><div id="p-bids"></div></section>`;

  loadInto($('#p-form', app), () => api('/auth/me'), (me) => {
    $('#p-form', app).innerHTML = `
      ${me.blocked ? `<p class="note warn">${t('blocked_note', { r: esc(me.block_reason) })}</p>` : ''}
      <p class="muted">${esc(me.email)} · ${t(`role_${me.role}`)}</p>
      <form class="lot-form" novalidate><div class="cols">
        <label>${t('name')}<input name="name" value="${esc(me.name)}" required minlength="2"></label>
        <label>${t('phone')}<input name="phone" type="tel" value="${esc(me.phone)}"></label>
        <label>${t('first_name')}<input name="first_name" value="${esc(me.first_name)}"></label>
        <label>${t('last_name')}<input name="last_name" value="${esc(me.last_name)}"></label>
        <label class="span2">${t('address')}<input name="address" value="${esc(me.address)}"></label>
      </div><p class="msg" role="status" id="p-msg"></p><button class="btn primary" type="submit">${t('save')}</button></form>`;
    const form = $('form', $('#p-form', app));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(['name', 'phone', 'first_name', 'last_name', 'address'].map((k) => [k, form.elements[k].value]));
      try { await api('/auth/me', { method: 'PATCH', body }); $('#p-msg', app).textContent = t('saved'); await loadMe(); } catch (er) { showFieldErrors(form, er); }
    };
  });

  const notes = (page = 1) => loadInto($('#p-notes', app), () => api(`/notifications?page=${page}`), (d) => {
    const el = $('#p-notes', app);
    if (!d.items.length) { el.innerHTML = `<p class="state state-empty">${t('no_notifications')}</p>`; return; }
    el.innerHTML = `<ul class="notes">${d.items.map((n) => `<li class="${n.is_read ? '' : 'unread'}">
      <span>${n.lot_id ? `<a href="/lot/${n.lot_id}" data-link>${esc(t(`n_${n.type}`, n.data))}</a>` : esc(t(`n_${n.type}`, n.data))}</span>
      <time>${fmtDate(n.created_at)}</time></li>`).join('')}</ul>`;
    pager(el, d, notes);
  });
  notes();
  $('#read-all', app).onclick = async () => { await api('/notifications/read', { method: 'POST' }).catch(() => {}); notes(); updateHeader(); };

  const watch = (page = 1) => loadInto($('#p-watch', app), () => api(`/watchlist?page=${page}&size=12`), (d) => {
    const el = $('#p-watch', app);
    el.innerHTML = d.items.length ? `<div class="grid">${d.items.map((l) => card(l)).join('')}</div>` : emptyHtml('');
    pager(el, d, watch);
  });
  watch();

  const myBids = (page = 1) => loadInto($('#p-bids', app), () => api(`/bids/mine?page=${page}`), (d) => {
    const el = $('#p-bids', app);
    if (!d.items.length) { el.innerHTML = emptyHtml(''); return; }
    el.innerHTML = `<table class="bids"><tbody>${d.items.map((b) => `<tr><td><a href="/lot/${b.lot_id}" data-link>${esc(b.title)}</a>${b.leading && b.status === 'active' ? ` <span class="badge live">${t('leading')}</span>` : ''}</td><td>${money(b.amount)}${b.is_auto ? ` <small>(${t('auto')})</small>` : ''}</td><td>${fmtDate(b.created_at)}</td></tr>`).join('')}</tbody></table>`;
    pager(el, d, myBids);
  });
  myBids();
}

async function myLotsPage(app) {
  if (!state.me) return go('/login?next=/my-lots');
  app.innerHTML = `<h1>${t('my_lots')}</h1>
    <div class="row between"><label class="inline">${t('status')} <select id="st"><option value="">${t('all_statuses')}</option>${['pending', 'rejected', 'active', 'ended', 'cancelled', 'withdrawn'].map((s) => `<option value="${s}">${t(`st_${s}`)}</option>`).join('')}</select></label>
    <a class="btn primary" href="/create" data-link>${t('create')}</a></div>
    <div id="mine"></div>`;
  const load = (page = 1) => {
    const st = $('#st', app).value;
    loadInto($('#mine', app), () => api(`/lots/mine?page=${page}${st ? `&status=${st}` : ''}`), (d) => {
      const el = $('#mine', app);
      if (!d.items.length) { el.innerHTML = emptyHtml(''); return; }
      el.innerHTML = `<div class="grid">${d.items.map((l) => card(l, `<span class="rel">${t(`st_${l.status}`)}</span>${l.admin_note ? `<span class="muted small">${esc(l.admin_note)}</span>` : ''}`)).join('')}</div>`;
      pager(el, d, load);
    });
  };
  $('#st', app).onchange = () => load();
  load();
}

// ---------- адмін-панель ----------
async function adminPage(app) {
  if (state.me?.role !== 'admin') { app.innerHTML = notFoundHtml(); return; }
  app.innerHTML = `<h1>${t('admin_title')}</h1>
    <section class="panel"><h2>${t('moderation')}</h2><div id="mod"></div></section>
    <section class="panel"><h2>${t('users')}</h2>
      <form class="row" id="user-search"><label class="sr-only" for="uq">${t('search')}</label><input id="uq" type="search" placeholder="Email"><label class="check"><input type="checkbox" id="ub"> ${t('only_blocked')}</label><button class="btn" type="submit">${t('search_btn')}</button></form>
      <div id="users"></div></section>`;
  const mod = (page = 1) => loadInto($('#mod', app), () => api(`/admin/lots?page=${page}`), (d) => {
    const el = $('#mod', app);
    if (!d.items.length) { el.innerHTML = emptyHtml(''); return; }
    el.innerHTML = `<ul class="mod">${d.items.map((l) => `<li data-id="${l.id}">
      <img src="${esc(l.image)}" alt="" width="64" height="64"><div><a href="/lot/${l.id}" data-link>${esc(l.title)}</a><br><small>${esc(l.seller_email)} · ${money(l.start_price)} · ${fmtDate(l.starts_at)}</small></div>
      <div class="row"><button class="btn primary small" type="button" data-act="approve">${t('approve')}</button>
      <input aria-label="${t('reject_reason')}" placeholder="${t('reject_reason')}" maxlength="500"><button class="btn small" type="button" data-act="reject">${t('reject')}</button></div></li>`).join('')}</ul>`;
    pager(el, d, mod);
    el.onclick = async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const li = b.closest('li');
      await api(`/admin/lots/${li.dataset.id}/moderate`, { method: 'POST', body: { decision: b.dataset.act, note: $('input', li).value || undefined } }).catch((er) => alert(errText(er)));
      mod(page);
    };
  });
  mod();
  const users = (page = 1) => {
    const q = $('#uq', app).value.trim();
    loadInto($('#users', app), () => api(`/admin/users?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}${$('#ub', app).checked ? '&blocked=1' : ''}`), (d) => {
      const el = $('#users', app);
      if (!d.items.length) { el.innerHTML = emptyHtml(''); return; }
      el.innerHTML = `<table class="bids"><tbody>${d.items.map((u) => `<tr><td>${esc(u.email)}<br><small>${esc(u.name)} · ${t(`role_${u.role}`)}</small></td>
        <td>${u.blocked ? `<span class="badge">${t('blocked')}: ${esc(u.block_reason)}</span>` : ''}</td>
        <td>${u.role === 'admin' ? '' : `<button class="btn small" type="button" data-id="${u.id}" data-b="${u.blocked ? 0 : 1}">${u.blocked ? t('unblock') : t('block')}</button>`}</td></tr>`).join('')}</tbody></table>`;
      pager(el, d, users);
      el.onclick = async (e) => {
        const b = e.target.closest('button[data-id]');
        if (!b) return;
        await api(`/admin/users/${b.dataset.id}/blocked`, { method: 'PUT', body: { blocked: b.dataset.b === '1' } }).catch((er) => alert(errText(er)));
        users(page);
      };
    });
  };
  $('#user-search', app).onsubmit = (e) => { e.preventDefault(); users(); };
  users();
}

// ---------- вхід і реєстрація ----------
function authPage(mode) {
  return async (app) => {
    const reg = mode === 'register';
    const next = new URLSearchParams(location.search).get('next') || '/';
    app.innerHTML = `<div class="auth panel">
      <h1>${reg ? t('register_title') : t('login_title')}</h1>
      ${state.config.google ? `<a class="btn wide" href="/api/auth/google">${t('google')}</a><p class="or">${t('or')}</p>` : ''}
      <form class="lot-form" novalidate>
        ${reg ? `<label>${t('name')}<input name="name" required minlength="2" autocomplete="nickname"></label>` : ''}
        <label>${t('email')}<input name="email" type="email" required autocomplete="email"></label>
        <label>${t('password')}<input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}">${reg ? `<small>${t('password_hint')}</small>` : ''}</label>
        <label class="check"><input type="checkbox" id="show-pass"> ${t('show_password')}</label>
        <p class="msg" role="alert" id="auth-msg"></p>
        <button class="btn primary wide" type="submit">${reg ? t('register') : t('login')}</button>
      </form>
      <p>${reg ? t('have_account') : t('no_account')} <a href="/${reg ? 'login' : 'register'}?next=${encodeURIComponent(next)}" data-link>${reg ? t('login') : t('register')}</a></p>
    </div>`;
    const form = $('form', app);
    $('#show-pass', app).onchange = (e) => { form.password.type = e.target.checked ? 'text' : 'password'; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = { email: form.email.value, password: form.password.value };
      if (reg) body.name = form.elements.name.value;
      try {
        await api(`/auth/${mode}`, { method: 'POST', body });
        await loadMe();
        go(next.startsWith('/') && !next.startsWith('//') ? next : '/');
      } catch (er) {
        $('#auth-msg', app).textContent = errText(er);
        showFieldErrors(form, er);
      }
    };
  };
}

// ---------- статичні сторінки ----------
const STATIC = {
  support: () => `<h1>${t('support_title')}</h1><div class="panel prose"><p>${t('support_text')}</p>
    <p><a href="mailto:${esc(state.config.support_email)}">${esc(state.config.support_email)}</a></p>
    <p>${t('support_faq')}</p><p>${t('support_faq2', { h: state.config.pay_window_hours })}</p></div>`,
  privacy: () => (state.lang === 'uk'
    ? `<h1>Політика конфіденційності</h1><div class="panel prose">
      <p>Ми зберігаємо лише дані, потрібні для роботи аукціону: email, ім'я, пароль у вигляді хешу (Argon2id), ставки, сповіщення.</p>
      <p>Дані продавця (ПІБ, телефон, адреса, останні 4 цифри картки для виплати) бачить лише адміністрація. Дані покупця передаються продавцю тільки після оплати, щоб він міг відправити річ.</p>
      <p>Повні номери карток і CVV не зберігаються. Сесія тримається в cookie, недоступному для JavaScript. Сторонніх трекерів і реклами на сайті немає.</p>
      <p>Щоб видалити акаунт або отримати копію своїх даних, напишіть у підтримку.</p></div>`
    : `<h1>Privacy policy</h1><div class="panel prose">
      <p>We keep only what the auction needs: email, name, a password hash (Argon2id), bids and notifications.</p>
      <p>Seller details (name, phone, address, last 4 digits of the payout card) are visible to administrators only. Buyer details are shared with the seller only after payment so the item can be shipped.</p>
      <p>Full card numbers and CVV codes are never stored. The session lives in a cookie that JavaScript cannot read. There are no third-party trackers or ads.</p>
      <p>To delete your account or get a copy of your data, contact support.</p></div>`),
  terms: () => (state.lang === 'uk'
    ? `<h1>Умови користування</h1><div class="panel prose">
      <p>Ставка є зобов'язанням купити лот за названу ціну, якщо вона виявиться найвищою на момент завершення торгів. Ставки не можна змінити чи відкликати.</p>
      <p>Переможець має ${state.config.pay_window_hours} год на оплату. Якщо оплати немає, лот пропонується наступному учаснику, а акаунт блокується до звернення в підтримку.</p>
      <p>Продавець відповідає за правдивість опису та фото. Редагувати лот можна лише до першої ставки, зняти з торгів теж лише без ставок.</p>
      <p>Адміністрація може відхилити лот або скасувати торги з порушенням правил.</p>
      <p>Це навчальний проєкт: оплата імітується, реальні гроші не списуються.</p></div>`
    : `<h1>Terms of use</h1><div class="panel prose">
      <p>A bid is a commitment to buy the lot at that price if it is the highest when the auction ends. Bids cannot be changed or withdrawn.</p>
      <p>The winner has ${state.config.pay_window_hours} hours to pay. Otherwise the lot is offered to the next bidder and the account is blocked until you contact support.</p>
      <p>The seller is responsible for an accurate description and photos. A lot can be edited or withdrawn only before the first bid.</p>
      <p>Administrators may reject a lot or cancel an auction that breaks the rules.</p>
      <p>This is a student project: payments are simulated and no real money is charged.</p></div>`),
};
const notFoundHtml = () => `<div class="state"><h1>${t('not_found')}</h1><a class="btn" href="/" data-link>${t('to_home')}</a></div>`;

// ---------- каркас: маршрути, шапка, меню ----------
const ROUTES = [
  [/^\/$/, (a) => catalogPage(a, 'main')],
  [/^\/history$/, (a) => catalogPage(a, 'history')],
  [/^\/lot\/(\d+)$/, lotPage],
  [/^\/lot\/(\d+)\/edit$/, lotFormPage],
  [/^\/create$/, (a) => lotFormPage(a)],
  [/^\/pay\/(\d+)$/, payPage],
  [/^\/profile$/, profilePage],
  [/^\/my-lots$/, myLotsPage],
  [/^\/admin$/, adminPage],
  [/^\/login$/, authPage('login')],
  [/^\/register$/, authPage('register')],
  [/^\/(support|privacy|terms)$/, (a, k) => { a.innerHTML = STATIC[k](); }],
];

let cleanup = null;
async function render() {
  if (cleanup) cleanup();
  cleanup = null;
  const app = $('#app');
  const path = location.pathname;
  document.title = 'RetroLot';
  $('#nav-history').hidden = path === '/create' || path.endsWith('/edit');
  closeMenu();
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) { app.innerHTML = notFoundHtml(); return; }
  const result = await route[1](app, ...path.match(route[0]).slice(1));
  if (typeof result === 'function') cleanup = result;
  if (state.flash) {
    const p = document.createElement('p');
    p.className = 'note ok flash';
    p.setAttribute('role', 'status');
    p.textContent = state.flash;
    app.prepend(p);
    state.flash = null;
  }
}

function go(url) {
  history.pushState(null, '', url);
  render();
  window.scrollTo(0, 0);
}

function closeMenu() {
  $('#menu').hidden = true;
  $('#avatar').setAttribute('aria-expanded', 'false');
}

async function updateHeader() {
  const me = state.me;
  $('#login-link').hidden = Boolean(me);
  $('#avatar').hidden = !me;
  $('#menu-admin').hidden = me?.role !== 'admin';
  $('#lang').textContent = state.lang === 'uk' ? 'EN' : 'UA';
  $('#lang').setAttribute('aria-label', `${$('#lang').textContent}, Мова / Language`);
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('.skip').textContent = t('skip');
  if (me) {
    $('#avatar').textContent = (me.name || me.email)[0].toUpperCase();
    $('#avatar').setAttribute('aria-label', `${t('profile')}: ${me.name}`);
    const n = await api('/notifications').catch(() => null);
    $('#avatar').classList.toggle('has-unread', Boolean(n?.unread));
  }
}

async function loadMe() {
  state.me = await api('/auth/me').catch(() => null);
  await updateHeader();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    go(a.getAttribute('href'));
    return;
  }
  if (!e.target.closest('.account')) closeMenu();
});
// Escape закриває меню профілю і повертає фокус на аватарку
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#menu').hidden) {
    closeMenu();
    $('#avatar').focus();
  }
});
window.addEventListener('popstate', render);

$('#avatar').onclick = () => {
  const menu = $('#menu');
  menu.hidden = !menu.hidden;
  $('#avatar').setAttribute('aria-expanded', String(!menu.hidden));
  if (!menu.hidden) $('a', menu).focus();
};
$('#logout').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  await updateHeader();
  go('/');
};
$('#lang').onclick = async () => {
  state.lang = state.lang === 'uk' ? 'en' : 'uk';
  try { localStorage.setItem('lang', state.lang); } catch { /* не збережено, мова скинеться після перезавантаження */ }
  await updateHeader();
  render();
};

(async () => {
  state.config = await api('/config').catch(() => ({ google: false, support_email: '', pay_window_hours: 48 }));
  await loadMe();
  render();
})();
