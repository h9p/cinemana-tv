/* سينما همام (Cinema Humam) — remote-friendly TV app.
 * جميع الحقوق محفوظة للمهندس همام محمد
 * Plain ES2017 (no optional chaining) so it runs on older TV browsers / WebViews.
 */
(function () {
  'use strict';

  var API = 'https://cinemana.shabakaty.cc/api/android/';
  var LEVEL = 0; // parental level, same default the mobile app uses

  // ---------------------------------------------------------------- helpers
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function title(v) { return (v && (v.ar_title || v.en_title || v.other_title)) || ''; }
  function subTitle(v) { return v && v.en_title && v.en_title !== v.ar_title ? v.en_title : ''; }
  function poster(v) { return v.imgMediumThumbObjUrl || v.imgObjUrl || v.imgThumbObjUrl || ''; }
  function isSeries(v) { return String(v.kind) === '2'; }
  function rootOf(v) { return v.rootSeries && v.rootSeries !== '0' ? v.rootSeries : v.nb; }
  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('ctv_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('ctv_' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  var toastTimer;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2500);
  }

  var cache = {};
  function api(path, fresh) {
    if (!fresh && cache[path]) return cache[path];
    var p = fetch(API + path).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    cache[path] = p;
    p.catch(function () { delete cache[path]; });
    return p;
  }

  // ------------------------------------------------------- watch progress
  function getProg(nb) { return store.get('prog', {})[nb]; }
  function saveProg(nb, t, d) {
    var p = store.get('prog', {});
    p[nb] = { t: t, d: d, at: Date.now() };
    var keys = Object.keys(p);
    if (keys.length > 600) {
      keys.sort(function (a, b) { return p[a].at - p[b].at; }).slice(0, 100).forEach(function (k) { delete p[k]; });
    }
    store.set('prog', p);
  }
  function saveHistory(entry) {
    var h = store.get('hist', []).filter(function (x) { return x.key !== entry.key; });
    entry.at = Date.now();
    h.unshift(entry);
    store.set('hist', h.slice(0, 40));
  }
  function historyItems() { return store.get('hist', []); }

  // ------------------------------------------------------ focus engine
  var focused = null;
  var sidebar = $('#sidebar');
  var views = $('#views');
  var stack = [];
  function currentView() { return stack.length ? stack[stack.length - 1] : null; }
  function playerOpen() { return !$('#player').hidden; }
  function menuOpen() { return !$('#p-menu').hidden; }

  function isVisible(e) {
    if (!e || !document.body.contains(e) || e.closest('[hidden]')) return false;
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function focus(e, noScroll) {
    if (!e) return;
    if (focused && focused !== e) focused.classList.remove('focused');
    focused = e;
    e.classList.add('focused');
    if (e.tagName === 'INPUT') {
      // don't pop the TV's on-screen keyboard just by passing over the field; OK opens it
      if (document.activeElement && document.activeElement !== e && document.activeElement.blur) document.activeElement.blur();
    } else {
      try { e.focus({ preventScroll: true }); } catch (x) { e.focus(); }
    }
    var inSide = sidebar.contains(e);
    sidebar.classList.toggle('open', inSide && !isNarrow());
    var v = e.closest('.view');
    if (v) v._last = e;
    var row = e.closest('.row-scroll');
    if (row) row._last = e;
    if (!noScroll) scrollToFocus(e);
    if (e._onFocus) e._onFocus();
  }

  function isNarrow() { return window.innerWidth < window.innerHeight; }

  function scrollToFocus(e) {
    var row = e.closest('.row-scroll');
    if (row) {
      var r = e.getBoundingClientRect(), rr = row.getBoundingClientRect();
      var pad = Math.min(rr.width * 0.12, 160), dx = 0;
      if (r.left < rr.left + pad) dx = r.left - rr.left - pad;
      else if (r.right > rr.right - pad) dx = r.right - rr.right + pad;
      if (dx) row.scrollBy({ left: dx, behavior: 'smooth' });
    }
    var view = e.closest('.view');
    if (!view) return;
    if (e.closest('.hero')) { view.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var anchor = e.closest('.row') || e;
    var a = anchor.getBoundingClientRect(), vr = view.getBoundingClientRect();
    if (a.height > vr.height * 0.8) { anchor = e; a = e.getBoundingClientRect(); }
    var topLimit = vr.top + vr.height * 0.12, botLimit = vr.bottom - vr.height * 0.12;
    if (a.top < topLimit || a.bottom > botLimit) {
      view.scrollTo({ top: view.scrollTop + (a.top - vr.top) - vr.height * 0.18, behavior: 'smooth' });
    }
  }

  function candidates() {
    var list;
    if (menuOpen()) list = $$('.f', $('#p-menu'));
    else if (playerOpen()) list = $$('.f', $('#player')).filter(function (x) { return !x.closest('#p-menu'); });
    else {
      var v = currentView();
      list = $$('.f', sidebar).concat(v ? $$('.f', v.el) : []);
    }
    return list.filter(isVisible);
  }

  function move(dir) {
    var list = candidates();
    if (!focused || list.indexOf(focused) < 0) { focus(defaultFocus()); return; }
    var a = focused.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var horiz = dir === 'left' || dir === 'right';
    var found = [];
    list.forEach(function (c) {
      if (c === focused) return;
      var b = c.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var main, cross, beam;
      if (dir === 'left') { if (bx >= ax - 1) return; main = Math.max(0, a.left - b.right); }
      if (dir === 'right') { if (bx <= ax + 1) return; main = Math.max(0, b.left - a.right); }
      if (dir === 'up') { if (by >= ay - 1) return; main = Math.max(0, a.top - b.bottom); }
      if (dir === 'down') { if (by <= ay + 1) return; main = Math.max(0, b.top - a.bottom); }
      if (horiz) { cross = Math.abs(by - ay); beam = b.top < a.bottom - 2 && b.bottom > a.top + 2; }
      else { cross = Math.abs(bx - ax); beam = true; }
      found.push({ c: c, main: main, cross: cross, beam: beam });
    });
    if (!horiz) {
      // up/down never crosses between the sidebar and the page content
      var inSide = sidebar.contains(focused);
      found = found.filter(function (x) { return sidebar.contains(x.c) === inSide; });
    }
    if (horiz) {
      var inBeam = found.filter(function (x) { return x.beam; });
      if (inBeam.length) found = inBeam;
      else {
        // nothing on the same line: only allow jumping to/from the sidebar
        var toSide = found.filter(function (x) { return sidebar.contains(x.c) !== sidebar.contains(focused); });
        if (!toSide.length) return;
        if (!sidebar.contains(focused)) { focus($('.nav-item.active') || toSide[0].c); return; }
        var v = currentView();
        if (v && v.el._last && isVisible(v.el._last)) { focus(v.el._last); return; }
        found = toSide;
      }
    }
    if (!found.length) return;
    var minMain = Math.min.apply(null, found.map(function (x) { return x.main; }));
    var tol = horiz ? a.width * 0.6 : a.height * 0.6;
    var near = found.filter(function (x) { return x.main <= minMain + tol; });
    near.sort(function (p, q) { return p.cross - q.cross; });
    var best = near[0].c;
    if (!sidebar.contains(focused) && sidebar.contains(best)) best = $('.nav-item.active') || best;
    // entering a horizontal row vertically: return to the card last used in it
    var row = best.closest('.row-scroll');
    if (!horiz && row && row !== focused.closest('.row-scroll') && row._last && isVisible(row._last)) {
      var lr = row._last.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (lr.right > rr.left && lr.left < rr.right) best = row._last;
    }
    // leaving the sidebar: return to where the user was in the page
    if (horiz && sidebar.contains(focused) && !sidebar.contains(best)) {
      var cv = currentView();
      if (cv && cv.el._last && isVisible(cv.el._last)) best = cv.el._last;
    }
    focus(best);
  }

  function defaultFocus() {
    if (menuOpen()) return $('.m-item.on', $('#p-menu')) || $('.m-item', $('#p-menu'));
    if (playerOpen()) return $('#p-play');
    var v = currentView();
    if (v) {
      if (v.el._last && isVisible(v.el._last)) return v.el._last;
      var first = $$('.f', v.el).filter(isVisible)[0];
      if (first) return first;
    }
    return $('.nav-item.active') || $('.nav-item');
  }

  // --------------------------------------------------------- view stack
  function pushView(name, node, opts) {
    opts = opts || {};
    if (opts.root) {
      stack.forEach(function (v) { if (v.destroy) v.destroy(); v.el.remove(); });
      stack = [];
    } else if (currentView()) {
      currentView().el.hidden = true;
    }
    node.classList.add('view');
    views.appendChild(node);
    var v = { name: name, el: node, destroy: opts.destroy };
    stack.push(v);
    if (opts.nav) setActiveNav(opts.nav);
    if (!opts.keepFocus) setTimeout(function () { focus(defaultFocus()); }, 0);
    return v;
  }

  function popView() {
    if (stack.length < 2) return false;
    var v = stack.pop();
    if (v.destroy) v.destroy();
    v.el.remove();
    var cur = currentView();
    cur.el.hidden = false;
    if (cur.onShow) cur.onShow();
    focus(defaultFocus());
    return true;
  }

  function setActiveNav(name) {
    $$('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-nav') === name); });
  }

  function loadingView() {
    return el('div', '', '<div class="spinner view-loading"></div>');
  }
  function errorInto(node, retry) {
    node.innerHTML = '<div class="empty">تعذّر الاتصال بالسيرفر<br><br></div>';
    var b = el('button', 'btn primary f', '↻ إعادة المحاولة');
    b.onclick = retry;
    node.firstChild.appendChild(b);
    focus(b);
  }

  // ------------------------------------------------------------- cards
  function card(v, opts) {
    opts = opts || {};
    var b = el('button', 'card f');
    var prog = opts.prog;
    b.innerHTML =
      '<div class="poster"><img alt="" loading="lazy">' +
      (v.stars && v.stars !== '0' ? '<span class="badge">★ ' + esc(v.stars) + '</span>' : '') +
      (isSeries(v) ? '<span class="badge kind">مسلسل</span>' : '') +
      (prog ? '<div class="progress"><i style="width:' + Math.min(100, prog * 100).toFixed(1) + '%"></i></div>' : '') +
      '</div><div class="c-title">' + esc(title(v)) + '</div>' +
      '<div class="c-sub">' + esc(opts.sub || v.year || '') + '</div>';
    var img = $('img', b);
    img.onload = function () { img.classList.add('ok'); };
    img.onerror = function () { img.remove(); };
    img.src = poster(v);
    b.onclick = function () { openDetails(v); };
    b._item = v;
    return b;
  }

  function rowSection(heading, items, opts) {
    opts = opts || {};
    var sec = el('section', 'row');
    var head = el('div', 'row-head', '<h2 class="row-title">' + esc(heading) + '</h2>');
    if (opts.more) {
      var m = el('button', 'row-more f', 'عرض الكل ‹');
      m.onclick = opts.more;
      head.appendChild(m);
    }
    sec.appendChild(head);
    var sc = el('div', 'row-scroll');
    items.forEach(function (it) { sc.appendChild(opts.render ? opts.render(it) : card(it)); });
    sec.appendChild(sc);
    return sec;
  }

  // --------------------------------------------------------------- HOME
  function showHome() {
    var node = loadingView();
    var timer = null;
    pushView('home', node, { root: true, nav: 'home', keepFocus: true, destroy: function () { clearInterval(timer); } });
    Promise.all([
      api('banner/level/' + LEVEL).catch(function () { return []; }),
      api('newlyVideosItems/level/' + LEVEL + '/offset/12/page/0/').catch(function () { return []; }),
      api('videoGroups/lang/ar/level/' + LEVEL)
    ]).then(function (res) {
      var banners = (res[0] || []).slice(0, 10), newly = res[1] || [], groups = (res[2] && res[2].groups) || [];
      node.innerHTML = '';
      if (banners.length) {
        var hero = el('section', 'hero');
        hero.innerHTML = '<div class="hero-bg"></div><div class="hero-info"><h1 class="hero-title"></h1>' +
          '<div class="hero-meta"></div><p class="hero-desc"></p><div class="btn-row"></div><div class="hero-dots"></div></div>';
        var idx = 0;
        var playB = el('button', 'btn primary f', '▶ شاهد الآن');
        var infoB = el('button', 'btn f', 'ⓘ التفاصيل');
        $('.btn-row', hero).appendChild(playB);
        $('.btn-row', hero).appendChild(infoB);
        var dots = $('.hero-dots', hero);
        banners.forEach(function () { dots.appendChild(el('i')); });
        var paint = function () {
          var b = banners[idx];
          $('.hero-bg', hero).style.backgroundImage = 'url("' + (b.imgObjUrl || poster(b)) + '")';
          $('.hero-title', hero).textContent = title(b);
          $('.hero-meta', hero).innerHTML = (b.stars ? '<span>★ ' + esc(b.stars) + '</span>' : '') +
            (b.year ? '<span>' + esc(b.year) + '</span>' : '') + '<span>' + (isSeries(b) ? 'مسلسل' : 'فيلم') + '</span>' +
            (subTitle(b) ? '<span dir="ltr">' + esc(subTitle(b)) + '</span>' : '');
          $('.hero-desc', hero).textContent = b.ar_content || b.en_content || '';
          $$('i', dots).forEach(function (d, i) { d.classList.toggle('on', i === idx); });
        };
        playB.onclick = function () { var b = banners[idx]; if (isSeries(b)) openDetails(b); else playVideo(b); };
        infoB.onclick = function () { openDetails(banners[idx]); };
        paint();
        timer = setInterval(function () {
          if (node.hidden || playerOpen()) return;
          idx = (idx + 1) % banners.length; paint();
        }, 9000);
        node.appendChild(hero);
      }
      var hist = historyItems();
      if (hist.length) {
        node.appendChild(rowSection('تابع المشاهدة', hist.slice(0, 15), { render: historyCard }));
      }
      if (newly.length) node.appendChild(rowSection('أحدث الإضافات', newly));
      groups.forEach(function (g) {
        if (!g.content || !g.content.length) return;
        node.appendChild(rowSection(g.title, g.content, {
          more: g.hasPagination && g.groupsID ? function () { showGroup(g); } : null
        }));
      });
      if (!stack.length || currentView().el === node) focus(defaultFocus());
    }).catch(function () { errorInto(node, showHome); });
  }

  function historyCard(h) {
    var p = getProg(h.nb);
    var c = card(h.item, { prog: p && p.d ? p.t / p.d : 0, sub: h.label || '' });
    c.onclick = function () { openDetails(h.item, { resume: h }); };
    return c;
  }

  // ---------------------------------------------------- GRID (paged lists)
  function gridView(name, heading, loader, opts) {
    opts = opts || {};
    var node = el('div');
    node.appendChild(el('h1', 'view-title', esc(heading)));
    if (opts.chips) node.appendChild(opts.chips);
    var grid = el('div', 'grid');
    var more = el('div', 'loading-more', '');
    node.appendChild(grid);
    node.appendChild(more);
    var page = 0, busy = false, done = false, seen = {};
    function load() {
      if (busy || done) return;
      busy = true;
      more.innerHTML = '<div class="spinner" style="position:relative;top:auto;left:auto;margin:1rem auto"></div>';
      loader(page).then(function (list) {
        busy = false; more.innerHTML = '';
        list = (list || []).filter(function (v) { if (seen[v.nb]) return false; seen[v.nb] = 1; return true; });
        if (!list.length) {
          done = true;
          if (!grid.children.length) more.innerHTML = '<div class="empty">لا توجد نتائج</div>';
          return;
        }
        page++;
        list.forEach(function (v) {
          var c = card(v);
          c._onFocus = function () {
            var all = grid.children, i = Array.prototype.indexOf.call(all, c);
            if (i > all.length - 14) load();
          };
          grid.appendChild(c);
        });
        if (page === 1 && currentView() && currentView().el === node && !node.contains(focused)) focus(defaultFocus());
        if (node.scrollHeight <= node.clientHeight + 50) load();
      }).catch(function () {
        busy = false;
        more.innerHTML = '';
        var b = el('button', 'btn f', '↻ إعادة المحاولة');
        b.onclick = load;
        more.appendChild(b);
      });
    }
    node.addEventListener('scroll', function () {
      if (node.scrollTop + node.clientHeight > node.scrollHeight - 600) load();
    });
    pushView(name, node, { root: opts.root, nav: opts.nav, keepFocus: true });
    if (opts.chips) focus($('.chip.on', opts.chips) || $('.chip', opts.chips));
    load();
    return node;
  }

  function showBrowse(type, catNb) {
    var label = type === 'movies' ? 'أفلام' : 'مسلسلات';
    var chips = el('div', 'chips');
    api('mainCategories').then(function (cats) {
      var all = [{ nb: '', title: 'الكل' }].concat(cats || []);
      all.forEach(function (c) {
        var b = el('button', 'chip f' + (String(c.nb) === String(catNb || '') ? ' on' : ''), esc(CAT_AR[c.title] || c.title));
        b.onclick = function () { showBrowse(type, c.nb); };
        chips.appendChild(b);
      });
      var on = $('.chip.on', chips);
      if (on && chips.parentNode && !chips.parentNode.contains(focused)) focus(on);
    }).catch(function () { /* categories are optional */ });
    gridView(type, label, function (page) {
      return api('AdvancedSearch?type=' + type + '&page=' + page + '&level=' + LEVEL + (catNb ? '&categoryNb=' + catNb : ''));
    }, { root: true, nav: type, chips: chips });
  }

  var CAT_AR = {
    Action: 'أكشن', Adventure: 'مغامرة', Animation: 'رسوم متحركة', Comedy: 'كوميدي', Crime: 'جريمة',
    Documentary: 'وثائقي', Drama: 'دراما', Fantasy: 'فانتازيا', Horror: 'رعب', Mystery: 'غموض',
    Romance: 'رومانسي', 'Sci-Fi': 'خيال علمي', Sport: 'رياضة', Thriller: 'إثارة', Western: 'غرب أمريكي'
  };

  function showGroup(g) {
    gridView('group', g.title, function (page) {
      return api('videoListPagination?groupID=' + g.groupsID + '&level=' + LEVEL + '&itemsPerPage=24&page=' + page);
    });
  }

  function showHistory() {
    var node = el('div');
    node.appendChild(el('h1', 'view-title', 'تابع المشاهدة'));
    var grid = el('div', 'grid');
    var h = historyItems();
    if (!h.length) node.appendChild(el('div', 'empty', 'لم تشاهد أي شيء بعد'));
    h.forEach(function (x) { grid.appendChild(historyCard(x)); });
    node.appendChild(grid);
    pushView('history', node, { root: true, nav: 'history' });
  }

  // ------------------------------------------------------------- SEARCH
  // Arabic/English normalisation so matching is by letters, not by spelling variants
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')               // tashkeel + tatweel
      .replace(/[\u200c-\u200f\u202a-\u202e\u2066-\u2069]/g, '')  // direction marks
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/[.,:;!?'"`()\[\]{}<>\-–—_\/\&*#@+|~^%$،؛؟«»]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  // 0 = exact title, 1 = title starts with it, 2 = a word starts with it, 3 = contains it, -1 = no match
  function matchRank(v, q) {
    var best = -1;
    v._match = '';
    var names = [v.ar_title, v.en_title];
    String(v.other_title || '').split(/[,،]/).forEach(function (n) { names.push(n); });
    names.forEach(function (raw) {
      var t = norm(raw);
      if (!t) return;
      var r = -1;
      if (t === q) r = 0;
      else if (t.indexOf(q) === 0) r = 1;
      else if ((' ' + t).indexOf(' ' + q) >= 0) r = 2;
      else if (t.indexOf(q) >= 0) r = 3;
      if (r >= 0 && (best < 0 || r < best)) { best = r; v._match = String(raw).trim(); }
    });
    return best;
  }
  // the server only knows one spelling (ة vs ه, ى vs ي, أ vs ا) so try the common variants too
  function spellings(q) {
    var v = [q];
    var a = q.replace(/ه(?=\s|$)/g, 'ة'), b = q.replace(/ي(?=\s|$)/g, 'ى'),
        c = q.replace(/(^|\s)ا/g, '$1أ'), d = q.replace(/(^|\s)ا/g, '$1إ');
    [a, b, c, d].forEach(function (x) { if (v.indexOf(x) < 0) v.push(x); });
    return v;
  }
  function searchAll(q) {
    var vars = spellings(q), i = 0;
    function next() {
      var cur = vars[i++];
      return Promise.all([searchType(cur, 'movies', q), searchType(cur, 'series', q)]).then(function (r) {
        if ((r[0].length || r[1].length) || i >= vars.length) return r;
        return next();
      });
    }
    return next();
  }
  function searchType(q, type, typed) {
    var enc = encodeURIComponent(q), pages = [0, 1, 2];
    return Promise.all(pages.map(function (p) {
      return api('AdvancedSearch?videoTitle=' + enc + '&type=' + type + '&page=' + p + '&level=' + LEVEL)
        .catch(function () { return []; });
    })).then(function (lists) {
      var nq = norm(typed || q), seen = {}, out = [];
      [].concat.apply([], lists).forEach(function (v, i) {
        if (seen[v.nb]) return;
        seen[v.nb] = 1;
        var r = matchRank(v, nq);
        if (r >= 0) out.push({ v: v, r: r, i: i });
      });
      out.sort(function (a, b) { return a.r - b.r || a.i - b.i; });
      return out.map(function (x) { return x.v; });
    });
  }

  function showSearch() {
    var node = el('div');
    var top = el('div', 'search-top');
    var input = el('input', 'search-box f');
    input.type = 'search';
    input.placeholder = 'ابحث عن فيلم أو مسلسل...';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', 'search');
    input.setAttribute('inputmode', 'search');
    top.appendChild(input);
    node.appendChild(top);
    var hint = el('div', 'search-hint', 'اضغط <b>OK</b> على مربع البحث لفتح الكيبورد، واكتب اسم الفيلم أو المسلسل');
    node.appendChild(hint);
    var results = el('div');
    node.appendChild(results);
    var timer = null, seq = 0, focusResults = false;

    function run() {
      clearTimeout(timer);
      var q = input.value.trim();
      var my = ++seq;
      if (norm(q).length < 2) { results.innerHTML = ''; hint.hidden = false; return; }
      hint.hidden = true;
      results.innerHTML = '<div class="loading-more">جارِ البحث...</div>';
      searchAll(q).then(function (r) {
        if (my !== seq) return;
        results.innerHTML = '';
        var render = function (v) { return card(v, { sub: v._match && norm(v._match) !== norm(title(v)) ? v._match : v.year }); };
        if (r[0].length) results.appendChild(rowSection('أفلام (' + r[0].length + ')', r[0], { render: render }));
        if (r[1].length) results.appendChild(rowSection('مسلسلات (' + r[1].length + ')', r[1], { render: render }));
        if (!r[0].length && !r[1].length) results.innerHTML = '<div class="empty">لا توجد نتائج مطابقة لـ "' + esc(q) + '"</div>';
        if (focusResults) {
          focusResults = false;
          var first = $('.card', results);
          if (first) focus(first);
        }
      });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, 600);
    });
    // OK / Enter on the TV keyboard: search now and jump to the results
    input._submit = function () {
      input.blur();
      focusResults = true;
      run();
    };
    pushView('search', node, { root: true, nav: 'search', keepFocus: true });
    focus(input);
    openKeyboard(input);
  }

  // Shows the device's own on-screen keyboard (Android TV / smart TV / phone)
  function openKeyboard(input) {
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    try { input.click(); } catch (e) { /* ignore */ }
    if (window.AndroidTV && window.AndroidTV.showKeyboard) window.AndroidTV.showKeyboard();
  }

  // ------------------------------------------------------------ DETAILS
  function openDetails(v, opts) {
    opts = opts || {};
    var node = loadingView();
    var bgUrl = v.imgObjUrl || poster(v);
    pushView('details', node, { keepFocus: true });
    var series = isSeries(v);
    var root = rootOf(v);
    Promise.all([
      api('allVideoInfo/id/' + (series ? root : v.nb)),
      series ? api('videoSeason/id/' + root).catch(function () { return []; }) : Promise.resolve(null)
    ]).then(function (res) {
      var info = res[0] || v, eps = res[1];
      node.innerHTML = '';
      var wrap = el('div', 'details');
      wrap.appendChild(el('div', 'd-bg'));
      $('.d-bg', wrap).style.backgroundImage = 'url("' + (info.imgObjUrl || bgUrl) + '")';
      var cats = (info.categories || []).map(function (c) { return '<span class="pill">' + esc(c.ar_title || c.en_title) + '</span>'; }).join('');
      var people = function (list, lbl) {
        list = (list || []).slice(0, 6).map(function (p) { return esc(p.name); });
        return list.length ? '<div><b>' + lbl + ':</b> ' + list.join('، ') + '</div>' : '';
      };
      var dur = parseFloat(info.duration);
      var top = el('div', 'd-wrap');
      top.innerHTML =
        '<div class="d-poster"></div><div class="d-info">' +
        '<h1 class="d-title">' + esc(title(info)) + '</h1>' +
        (subTitle(info) ? '<div class="d-sub" dir="auto">' + esc(subTitle(info)) + '</div>' : '<div class="d-sub"></div>') +
        '<div class="d-meta">' +
        (info.stars && info.stars !== '0' ? '<span class="pill star">★ ' + esc(info.stars) + '</span>' : '') +
        (info.year ? '<span class="pill">' + esc(info.year) + '</span>' : '') +
        (!series && dur ? '<span class="pill">' + Math.round(dur / 60) + ' دقيقة</span>' : '') +
        (info.videoLanguages ? '<span class="pill">' + esc(info.videoLanguages.ar_title || info.videoLanguages.en_title) + '</span>' : '') +
        cats + '</div>' +
        '<p class="d-desc">' + esc(info.ar_content || info.en_content || '') + '</p>' +
        '<div class="d-people">' + people(info.directorsInfo, 'إخراج') + people(info.actorsInfo, 'بطولة') + '</div>' +
        '<div class="btn-row"></div></div>';
      $('.d-poster', top).style.backgroundImage = 'url("' + (info.imgObjUrl || poster(v)) + '")';
      var btns = $('.btn-row', top);
      wrap.appendChild(top);
      node.appendChild(wrap);

      if (!series) {
        var pr = getProg(info.nb);
        var resumable = pr && pr.t > 30 && pr.d && pr.t < pr.d - 60;
        var pb = el('button', 'btn primary f', resumable ? '▶ متابعة من ' + fmt(pr.t) : '▶ تشغيل');
        pb.onclick = function () { playVideo(info); };
        btns.appendChild(pb);
        if (resumable) {
          var sb = el('button', 'btn f', '⟲ من البداية');
          sb.onclick = function () { saveProg(info.nb, 0, pr.d); playVideo(info); };
          btns.appendChild(sb);
        }
        focus(pb);
        return;
      }

      // ---- series: seasons + episodes
      eps = (eps || []).slice().sort(function (a, b) {
        return (+a.season - +b.season) || (+a.episodeNummer - +b.episodeNummer);
      });
      if (!eps.length) {
        btns.appendChild(el('div', 'pill', 'لا توجد حلقات متاحة'));
        focus(defaultFocus());
        return;
      }
      var seasons = [];
      eps.forEach(function (e) { if (seasons.indexOf(e.season) < 0) seasons.push(e.season); });
      var hist = historyItems().filter(function (h) { return h.key === String(root); })[0];
      var resumeEp = hist && eps.filter(function (e) { return e.nb === hist.nb; })[0];
      var startEp = resumeEp || eps[0];
      var pb2 = el('button', 'btn primary f', (resumeEp ? '▶ متابعة ' : '▶ تشغيل ') + epLabel(startEp));
      pb2.onclick = function () { playVideo(startEp, { episodes: eps, series: info }); };
      btns.appendChild(pb2);

      var sWrap = el('div', 'seasons');
      sWrap.appendChild(el('h2', 'row-title', 'المواسم'));
      var chips = el('div', 'chips');
      chips.style.padding = '.8rem 0 0';
      sWrap.appendChild(chips);
      var epList = el('div', 'ep-list');
      var showSeason = function (s) {
        $$('.chip', chips).forEach(function (c) { c.classList.toggle('on', c._s === s); });
        epList.innerHTML = '';
        eps.filter(function (e) { return e.season === s; }).forEach(function (e) {
          var p = getProg(e.nb);
          var b = el('button', 'ep f',
            '<div class="ep-num">' + esc(e.episodeNummer) + '</div><div style="flex:1;min-width:0">' +
            '<div class="ep-t">الحلقة ' + esc(e.episodeNummer) + '</div>' +
            '<div class="ep-s">' + (e.duration ? Math.round(e.duration / 60) + ' دقيقة' : '') + (e.nb === (resumeEp && resumeEp.nb) ? ' • آخر مشاهدة' : '') + '</div>' +
            (p && p.d ? '<div class="progress"><i style="width:' + Math.min(100, p.t / p.d * 100).toFixed(1) + '%"></i></div>' : '') +
            '</div>');
          b.onclick = function () { playVideo(e, { episodes: eps, series: info }); };
          epList.appendChild(b);
        });
      };
      seasons.forEach(function (s) {
        var c = el('button', 'chip f', 'الموسم ' + esc(s));
        c._s = s;
        c.onclick = function () { showSeason(s); };
        chips.appendChild(c);
      });
      node.appendChild(sWrap);
      node.appendChild(epList);
      showSeason(startEp.season);
      focus(pb2);
    }).catch(function () { errorInto(node, function () { popView(); openDetails(v, opts); }); });
  }

  function epLabel(e) { return 'م' + e.season + ' • ح' + e.episodeNummer; }

  // ============================================================== PLAYER
  var P = {
    root: $('#player'), video: $('#video'), ui: $('#p-ui'),
    item: null, info: null, files: [], fileIdx: 0, subs: [], subIdx: -1, cues: [], cueI: 0,
    episodes: null, epIdx: -1, series: null, hideTimer: null, saveTimer: null, tick: null,
    seekTarget: null, seekTimer: null, intro: null, returnFocus: null, token: 0
  };
  var SUB_SIZES = [1.6, 2.2, 2.8, 3.6];
  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  function resNum(f) { return parseInt(f.resolution, 10) || (/4k/i.test(f.name) ? 2160 : 0); }

  function playVideo(item, ctx) {
    ctx = ctx || {};
    var token = ++P.token;
    P.returnFocus = focused;
    P.item = item;
    P.episodes = ctx.episodes || null;
    P.series = ctx.series || null;
    P.epIdx = P.episodes ? P.episodes.map(function (e) { return e.nb; }).indexOf(item.nb) : -1;
    P.root.hidden = false;
    document.body.classList.add('playing');
    $('#p-spinner').hidden = false;
    $('#p-title').textContent = P.series ? title(P.series) : title(item);
    $('#p-sub').textContent = P.series ? 'الموسم ' + item.season + ' • الحلقة ' + item.episodeNummer : (item.year || '');
    $('#p-next').hidden = !(P.episodes && P.epIdx > -1 && P.epIdx < P.episodes.length - 1);
    $('#p-episodes').hidden = !P.episodes;
    $('#subs').innerHTML = '';
    P.cues = []; P.cueI = 0; P.intro = null;
    P.video.removeAttribute('src');
    showUI(true);
    focus($('#p-play'));
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen && !window.AndroidTV && !isNarrow()) {
        document.documentElement.requestFullscreen().catch(function () {});
      }
    } catch (e) { /* fullscreen optional */ }

    Promise.all([
      api('allVideoInfo/id/' + item.nb),
      api('transcoddedFiles/id/' + item.nb, true)
    ]).then(function (r) {
      if (token !== P.token) return;
      var info = r[0] || item, files = (r[1] || []).filter(function (f) { return f.videoUrl; });
      P.info = info;
      if (!files.length) { toast('لا يوجد ملف فيديو متاح لهذا العنوان'); closePlayer(); return; }
      files.sort(function (a, b) { return resNum(a) - resNum(b); });
      P.files = files;
      var pref = store.get('quality', 720), pick = 0;
      files.forEach(function (f, i) { if (resNum(f) <= pref) pick = i; });
      P.intro = (info.introSkipping || [])[0] || null;
      // subtitles: one entry per language, prefer VTT
      var byLang = {};
      (info.translations || []).forEach(function (t) {
        if (!byLang[t.type] || t.extention === 'vtt') byLang[t.type] = t;
      });
      P.subs = Object.keys(byLang).map(function (k) { return byLang[k]; });
      var sPref = store.get('subLang', 'ar');
      P.subIdx = sPref === 'off' ? -1 : P.subs.map(function (s) { return s.type; }).indexOf(sPref);
      if (P.subIdx < 0 && sPref !== 'off' && P.subs.length) P.subIdx = 0;
      loadSubs();
      var pr = getProg(item.nb);
      var start = pr && pr.t > 30 && pr.d && pr.t < pr.d - 60 ? pr.t : 0;
      if (start) toast('متابعة من ' + fmt(start));
      setQuality(pick, start);
      applySubSize();
      P.video.playbackRate = 1;
      $('#p-sp-lbl').textContent = '1x';
      if (P.series) {
        saveHistory({ key: String(P.series.nb), nb: item.nb, label: epLabel(item), item: slim(P.series) });
      } else {
        saveHistory({ key: String(item.nb), nb: item.nb, label: '', item: slim(info) });
      }
    }).catch(function () {
      if (token !== P.token) return;
      toast('تعذّر تحميل الفيديو');
      closePlayer();
    });
  }

  function slim(v) {
    return { nb: v.nb, ar_title: v.ar_title, en_title: v.en_title, kind: v.kind, year: v.year, stars: v.stars,
      rootSeries: v.rootSeries, imgObjUrl: v.imgObjUrl, imgMediumThumbObjUrl: v.imgMediumThumbObjUrl };
  }

  function setQuality(i, at) {
    var v = P.video, f = P.files[i];
    P.fileIdx = i;
    var t = at != null ? at : v.currentTime, wasPaused = at == null && v.paused && v.currentTime > 0;
    $('#p-q-lbl').textContent = qLabel(f);
    $('#p-spinner').hidden = false;
    v.src = f.videoUrl;
    var onMeta = function () {
      v.removeEventListener('loadedmetadata', onMeta);
      if (t) { try { v.currentTime = t; } catch (e) { /* ignore */ } }
      if (!wasPaused) v.play().catch(function () { showUI(true); });
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.load();
  }
  function qLabel(f) {
    var n = resNum(f);
    return n >= 2160 ? '4K' : n ? n + 'p' : (f.resolution || f.name);
  }

  function loadSubs() {
    P.cues = []; P.cueI = 0;
    $('#subs').innerHTML = '';
    var s = P.subs[P.subIdx];
    $('#p-s-lbl').textContent = s ? langName(s.type) : 'إيقاف';
    if (!s) return;
    var token = P.token;
    fetch(s.file).then(function (r) { return r.text(); }).then(function (txt) {
      if (token !== P.token) return;
      P.cues = parseSubs(txt);
    }).catch(function () { toast('تعذّر تحميل الترجمة'); });
  }
  function langName(t) { return { ar: 'العربية', en: 'English', sp: 'Español', fr: 'Français', tr: 'Türkçe' }[t] || t; }

  function parseSubs(txt) {
    var out = [];
    txt.replace(/\r/g, '').split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split('\n'), i = 0;
      while (i < lines.length && lines[i].indexOf('-->') < 0) i++;
      if (i >= lines.length) return;
      var m = lines[i].split('-->');
      var text = lines.slice(i + 1).join('\n')
        .replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
      if (text) out.push({ s: ts(m[0]), e: ts(m[1]), t: text });
    });
    out.sort(function (a, b) { return a.s - b.s; });
    return out;
  }
  function ts(s) {
    s = s.trim().split(/\s+/)[0].replace(',', '.');
    return s.split(':').reduce(function (acc, p) { return acc * 60 + parseFloat(p); }, 0);
  }

  var lastSubText = null;
  function renderSubs() {
    var t = P.video.currentTime, c = P.cues, txt = '';
    if (c.length) {
      var i = P.cueI;
      if (i >= c.length || c[i].s > t) i = 0;
      while (i < c.length && c[i].e < t) i++;
      P.cueI = i;
      var parts = [];
      for (var j = i; j < c.length && c[j].s <= t; j++) if (c[j].e >= t) parts.push(c[j].t);
      txt = parts.join('\n');
    }
    if (txt !== lastSubText) {
      lastSubText = txt;
      $('#subs').innerHTML = txt ? '<span>' + esc(txt) + '</span>' : '';
    }
    var skip = $('#p-skip');
    var inIntro = P.intro && t >= +P.intro.start && t < +P.intro.end - 1;
    if (skip.hidden === !!inIntro) {
      skip.hidden = !inIntro;
      if (!inIntro && focused === skip) focus($('#p-play'));
    }
  }

  function applySubSize() {
    var i = store.get('subSize', 1);
    P.root.style.setProperty('--sub-size', SUB_SIZES[i] + 'rem');
  }

  function updateBar() {
    var v = P.video, d = v.duration || 0;
    var t = P.seekTarget != null ? P.seekTarget : v.currentTime;
    var pct = d ? t / d * 100 : 0;
    $('#p-prog').style.width = pct + '%';
    $('#p-knob').style.left = pct + '%';
    $('#p-cur').textContent = fmt(t);
    $('#p-dur').textContent = fmt(d);
    if (v.buffered && v.buffered.length && d) {
      var end = 0;
      for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) end = v.buffered.end(i);
      $('#p-buf').style.width = (end / d * 100) + '%';
    }
    $('#p-play').textContent = v.paused ? '▶' : '❚❚';
  }

  function showUI(stay) {
    P.root.classList.add('ui-on');
    clearTimeout(P.hideTimer);
    if (!stay) P.hideTimer = setTimeout(hideUI, 4500);
  }
  function hideUI() {
    if (menuOpen() || P.video.paused) return;
    P.root.classList.remove('ui-on');
    if (focused && P.root.contains(focused) && focused !== $('#p-skip')) focus($('#p-play'), true);
  }
  function uiVisible() { return P.root.classList.contains('ui-on'); }

  function seekBy(sec) {
    var v = P.video, d = v.duration || 0;
    if (!d) return;
    var base = P.seekTarget != null ? P.seekTarget : v.currentTime;
    P.seekTarget = Math.max(0, Math.min(d - 1, base + sec));
    updateBar();
    showUI();
    clearTimeout(P.seekTimer);
    P.seekTimer = setTimeout(function () {
      v.currentTime = P.seekTarget;
      P.seekTarget = null;
      P.cueI = 0;
    }, 450);
  }
  function togglePlay() {
    var v = P.video;
    if (v.paused) v.play().catch(function () {}); else v.pause();
    showUI(v.paused);
  }

  function persist() {
    var v = P.video;
    if (P.item && v.duration && v.currentTime > 5) saveProg(P.item.nb, v.currentTime, v.duration);
  }

  function closePlayer() {
    persist();
    P.token++;
    closeMenu(true);
    var v = P.video;
    v.pause();
    v.removeAttribute('src');
    v.load();
    P.root.hidden = true;
    P.root.classList.remove('ui-on');
    document.body.classList.remove('playing');
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ }
    // refresh the page underneath so progress bars and "continue" buttons update
    var cur = currentView();
    if (cur && cur.name === 'details' && P.returnFocus && cur.el.contains(P.returnFocus)) {
      var info = P.series || P.info;
      if (info) { popView(); openDetails(info); return; }
    }
    focus(P.returnFocus && isVisible(P.returnFocus) ? P.returnFocus : defaultFocus());
  }

  function playNext() {
    if (!P.episodes || P.epIdx < 0 || P.epIdx >= P.episodes.length - 1) return;
    persist();
    playVideo(P.episodes[P.epIdx + 1], { episodes: P.episodes, series: P.series });
  }

  // ---------- player menus
  var menuReturn = null;
  function openMenu(heading, items) {
    var m = $('#p-menu'), list = $('#p-menu-list');
    menuReturn = focused;
    $('#p-menu-title').textContent = heading;
    list.innerHTML = '';
    var onEl = null;
    items.forEach(function (it) {
      var b = el('button', 'm-item f' + (it.on ? ' on' : ''), esc(it.label));
      b.onclick = function () { closeMenu(); it.action(); };
      list.appendChild(b);
      if (it.on) onEl = b;
    });
    m.hidden = false;
    showUI(true);
    focus(onEl || $('.m-item', list));
  }
  function closeMenu(silent) {
    var m = $('#p-menu');
    if (m.hidden) return;
    m.hidden = true;
    if (!silent) { focus(menuReturn && isVisible(menuReturn) ? menuReturn : $('#p-play')); showUI(); }
  }

  $('#p-play').onclick = togglePlay;
  $('#p-back10').onclick = function () { seekBy(-10); };
  $('#p-fwd10').onclick = function () { seekBy(10); };
  $('#p-next').onclick = playNext;
  $('#p-skip').onclick = function () { if (P.intro) { P.video.currentTime = +P.intro.end; P.cueI = 0; } focus($('#p-play')); };
  $('#p-quality').onclick = function () {
    openMenu('دقة الفيديو', P.files.map(function (f, i) {
      return { label: qLabel(f), on: i === P.fileIdx, action: function () { store.set('quality', resNum(f)); setQuality(i); } };
    }).reverse());
  };
  $('#p-subsbtn').onclick = function () {
    var items = [{ label: 'إيقاف الترجمة', on: P.subIdx < 0, action: function () { P.subIdx = -1; store.set('subLang', 'off'); loadSubs(); } }];
    P.subs.forEach(function (s, i) {
      items.push({ label: langName(s.type), on: i === P.subIdx, action: function () { P.subIdx = i; store.set('subLang', s.type); loadSubs(); } });
    });
    openMenu('الترجمة', items);
  };
  $('#p-subsize').onclick = function () {
    var cur = store.get('subSize', 1);
    openMenu('حجم خط الترجمة', ['صغير', 'متوسط', 'كبير', 'كبير جداً'].map(function (l, i) {
      return { label: l, on: i === cur, action: function () { store.set('subSize', i); applySubSize(); } };
    }));
  };
  $('#p-speed').onclick = function () {
    openMenu('سرعة التشغيل', SPEEDS.map(function (s) {
      return { label: s === 1 ? 'عادي (1x)' : s + 'x', on: P.video.playbackRate === s, action: function () {
        P.video.playbackRate = s; $('#p-sp-lbl').textContent = s + 'x';
      } };
    }));
  };
  $('#p-episodes').onclick = function () {
    if (!P.episodes) return;
    var season = P.item.season;
    openMenu('الموسم ' + season, P.episodes.filter(function (e) { return e.season === season; }).map(function (e) {
      return { label: 'الحلقة ' + e.episodeNummer, on: e.nb === P.item.nb, action: function () {
        persist(); playVideo(e, { episodes: P.episodes, series: P.series });
      } };
    }));
  };

  var bar = $('#p-bar');
  bar.addEventListener('click', function (e) {
    var r = bar.getBoundingClientRect(), d = P.video.duration;
    if (d) { P.video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d; P.cueI = 0; }
    showUI();
  });

  var v = P.video;
  v.addEventListener('waiting', function () { $('#p-spinner').hidden = false; });
  v.addEventListener('playing', function () { $('#p-spinner').hidden = true; updateBar(); showUI(); });
  v.addEventListener('canplay', function () { $('#p-spinner').hidden = true; });
  v.addEventListener('pause', function () { updateBar(); showUI(true); persist(); });
  v.addEventListener('timeupdate', updateBar);
  v.addEventListener('ended', function () {
    persist();
    if (P.item) saveProg(P.item.nb, 0, v.duration);
    if (!$('#p-next').hidden) { toast('جارِ تشغيل الحلقة التالية...'); playNext(); } else closePlayer();
  });
  v.addEventListener('error', function () {
    if (P.root.hidden || !v.getAttribute('src')) return;
    $('#p-spinner').hidden = true;
    if (P.fileIdx > 0) {
      toast('تعذّر تشغيل دقة ' + qLabel(P.files[P.fileIdx]) + ' — جارِ التحويل لدقة أقل');
      setQuality(P.fileIdx - 1, v.currentTime || null);
    } else toast('تعذّر تشغيل الفيديو', 4000);
  });
  setInterval(function () { if (!P.root.hidden) renderSubs(); }, 150);
  setInterval(function () { if (!P.root.hidden && !v.paused) persist(); }, 10000);
  P.root.addEventListener('mousemove', function (e) { if (e.movementX || e.movementY) showUI(); });
  v.addEventListener('click', function () { if (uiVisible()) togglePlay(); else showUI(); });

  // ================================================================ KEYS
  var KEY = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 23: 'ok', 66: 'ok',
    27: 'back', 8: 'back', 461: 'back', 10009: 'back', 166: 'back',
    179: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 228: 'ff', 227: 'rw', 176: 'next'
  };
  var NAMED = {
    ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', Enter: 'ok', Escape: 'back',
    GoBack: 'back', BrowserBack: 'back', Backspace: 'back', MediaPlayPause: 'playpause', MediaPlay: 'play',
    MediaPause: 'pause', MediaStop: 'stop', MediaFastForward: 'ff', MediaRewind: 'rw', MediaTrackNext: 'next', ' ': 'space'
  };

  function handleKey(k, e) {
    var typing = focused && focused.tagName === 'INPUT' && document.activeElement === focused;
    if (typing) {
      if (k === 'left' || k === 'right' || k === 'space') return false; // caret / typing
      if (k === 'back' && e && e.key === 'Backspace' && focused.value) return false;
      if (k === 'ok') { if (focused._submit) focused._submit(); else { focused.blur(); move('down'); } return true; }
    }

    if (playerOpen()) return playerKey(k);

    switch (k) {
      case 'left': case 'right': case 'up': case 'down': move(k); return true;
      case 'ok': if (focused) { if (focused.tagName === 'INPUT') openKeyboard(focused); else focused.click(); } return true;
      case 'back': return goBack();
      default: return false;
    }
  }

  function playerKey(k) {
    if (menuOpen()) {
      if (k === 'back') { closeMenu(); return true; }
      if (k === 'up' || k === 'down' || k === 'left' || k === 'right') { move(k); return true; }
      if (k === 'ok') { focused.click(); return true; }
      return true;
    }
    if (k === 'playpause' || k === 'space') { togglePlay(); return true; }
    if (k === 'play') { v.play().catch(function () {}); return true; }
    if (k === 'pause') { v.pause(); return true; }
    if (k === 'stop') { closePlayer(); return true; }
    if (k === 'ff') { seekBy(30); return true; }
    if (k === 'rw') { seekBy(-30); return true; }
    if (k === 'next') { playNext(); return true; }

    if (!uiVisible()) {
      var skip = $('#p-skip');
      if (k === 'ok') {
        if (!skip.hidden) skip.click(); else togglePlay();
        return true;
      }
      if (k === 'left') { seekBy(-10); focus(bar, true); return true; }
      if (k === 'right') { seekBy(10); focus(bar, true); return true; }
      if (k === 'up' || k === 'down') { showUI(); focus(!skip.hidden ? skip : $('#p-play')); return true; }
      if (k === 'back') { closePlayer(); return true; }
      return false;
    }

    showUI();
    if (k === 'back') { P.root.classList.remove('ui-on'); return true; }
    if (focused === bar && (k === 'left' || k === 'right')) { seekBy(k === 'right' ? 10 : -10); return true; }
    if (k === 'ok') { if (focused === bar) togglePlay(); else if (focused) focused.click(); return true; }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') { move(k); return true; }
    return false;
  }

  function goBack() {
    if (popView()) return true;
    if (focused && !sidebar.contains(focused)) { focus($('.nav-item.active') || $('.nav-item')); return true; }
    var cur = currentView();
    if (cur && cur.name !== 'home') { showHome(); return true; }
    return false; // at the root: let the shell exit the app
  }

  document.addEventListener('keydown', function (e) {
    var k = NAMED[e.key] || KEY[e.keyCode];
    if (!k) { if (playerOpen()) showUI(); return; }
    if (handleKey(k, e)) e.preventDefault();
  });

  // Called by the Android TV shell when the remote's BACK key is pressed.
  // Returns true if handled, false if the app should close.
  window.tvBack = function () {
    if (playerOpen()) return playerKey('back');
    if (focused && focused.tagName === 'INPUT') focused.blur();
    return goBack();
  };
  window.tvPause = function () { if (playerOpen()) { v.pause(); persist(); } };

  // mouse / touch: hovering moves focus too, so it works with air-mouse remotes
  // only a mouse that really moved may take focus (not a page scrolling under a resting cursor)
  var lastMove = 0, mx = -1, my = -1;
  document.addEventListener('mousemove', function (e) {
    if (Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) > 3) { lastMove = Date.now(); mx = e.clientX; my = e.clientY; }
  });
  document.addEventListener('mouseover', function (e) {
    if (Date.now() - lastMove > 250) return;
    var f = e.target.closest && e.target.closest('.f');
    if (f && f !== focused && isVisible(f)) focus(f, true);
  });
  document.addEventListener('focusin', function (e) {
    var f = e.target.closest && e.target.closest('.f');
    if (f && f !== focused) focus(f, true);
  });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', function () { if (document.hidden) persist(); });

  // ------------------------------------------------------------- NAV
  $$('.nav-item').forEach(function (n) {
    n.onclick = function () {
      var to = n.getAttribute('data-nav');
      if (to === 'home') showHome();
      else if (to === 'search') showSearch();
      else if (to === 'movies') showBrowse('movies');
      else if (to === 'series') showBrowse('series');
      else if (to === 'history') showHistory();
    };
  });

  $('#year').textContent = new Date().getFullYear();
  showHome();
})();
