/**
 * The country list.
 *
 * Two hundred and thirty-four names do not go in a footer column. The list
 * that shipped before had five links in it; the same pattern at this length
 * is a wall of text that nobody reads and nothing can be found in.
 *
 * So: a filter box over a scrolling list. The box is the point — the fastest
 * route to a country you already have in mind is typing three letters of it,
 * and the list is there for the case where you do not have one in mind and
 * want to browse a continent.
 *
 * Hovering a row turns the globe to that country. So does arrowing onto it
 * with the keyboard, because the globe listens for `focus` as well as
 * `pointerenter` — a list you can only use with a mouse is half a list.
 */

(function () {
  "use strict";

  var box = document.querySelector("[data-country-list]");
  if (!box || !window.GLOBE_COUNTRIES) return;

  var input = box.querySelector("input");
  var list = box.querySelector("ul");
  var count = box.querySelector("[data-count]");

  /* Sovereign states first, then the territories that belong to one of them,
     alphabetically within each group. Both are on the map — every piece of
     land has to belong to something — but a list that opens with Åland,
     American Samoa and Anguilla reads as a list of somewhere else. */
  var ALL = GLOBE_COUNTRIES.slice().sort(function (a, b) {
    if (!!a.sovereign !== !!b.sovereign) return a.sovereign ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  /* One row per country, built once and then only shown or hidden. Rebuilding
     two hundred nodes on every keystroke is the kind of thing that makes a
     filter box feel slow for no reason. */
  var rows = ALL.map(function (q) {
    var li = document.createElement("li");
    /* A button, not a link. It goes nowhere — it toggles something, and it
       reports that state with aria-pressed, which is a button's attribute and
       means nothing on an anchor. `href="#"` also gives a screen reader a
       destination that does not exist and drops a stray `#` in the URL bar on
       every click. */
    var a = document.createElement("button");
    a.type = "button";
    a.className = "country-row";
    a.setAttribute("data-country", q.name);
    var nm = document.createElement("span");
    nm.className = "country-name";
    nm.textContent = q.name;
    var cn = document.createElement("small");
    /* a territory is more usefully labelled by whose it is than by which
       continent it is off the coast of */
    cn.textContent = q.sovereign || q.continent;
    a.appendChild(nm);
    a.appendChild(cn);
    a.addEventListener("pointerenter", function () {
      focusCountry(q.name);
    });
    a.addEventListener("focus", function () {
      focusCountry(q.name);
      a.scrollIntoView({ block: "nearest" });
    });
    a.addEventListener("click", function () {
      togglePin(q);
    });
    li.appendChild(a);
    li.hidden = false;
    li._q = q;
    return li;
  });
  rows.forEach(function (li) {
    list.appendChild(li);
  });

  /* letting go anywhere in the list lets the globe go back to drifting */
  list.addEventListener("pointerleave", function () {
    focusCountry(null);
  });

  var empty = null;

  function apply() {
    var term = input.value.trim().toLowerCase();
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i]._q;
      var hit =
        !term ||
        q.name.toLowerCase().indexOf(term) >= 0 ||
        q.continent.toLowerCase().indexOf(term) >= 0 ||
        (q.sovereign || "").toLowerCase().indexOf(term) >= 0 ||
        (q.iso || "").toLowerCase() === term;
      rows[i].hidden = !hit;
      if (hit) shown++;
    }
    /* the heading next to this already says "Countries", so the number says
       only what the number knows: how many, and out of how many */
    count.textContent = shown === rows.length ? String(shown) : shown + " / " + rows.length;
    /* an empty panel is indistinguishable from a broken one, so it says so */
    if (!shown && !empty) {
      empty = document.createElement("li");
      empty.className = "finder-empty";
      list.appendChild(empty);
    }
    if (empty) {
      empty.hidden = !!shown;
      if (!shown) empty.textContent = 'Nothing matches "' + input.value.trim() + '"';
    }
    list.scrollTop = 0;
  }

  input.addEventListener("input", apply);
  /* Enter jumps to the first match rather than submitting anything */
  input.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].hidden) {
        rows[i].firstChild.focus();
        return;
      }
    }
  });

  /* ── pinning ────────────────────────────────────────────────────
     Hovering answers one question — what is this. Comparing needs two
     things on screen at once, and a pointer can only be in one place,
     so a click holds a country lit and a second click lets it go. */
  var pins = [];
  var byName = {};
  GLOBE_COUNTRIES.forEach(function (q) {
    byName[q.name] = q;
  });

  function togglePin(q) {
    var at = pins.indexOf(q.name);
    if (at >= 0) pins.splice(at, 1);
    /* Five is where a bar chart of areas stops being readable and the
       labels on the globe start colliding. It drops the oldest rather
       than refusing, because refusing a click leaves the reader
       wondering whether the click landed. */
    else {
      pins.push(q.name);
      if (pins.length > 5) pins.shift();
    }
    pinCountries(pins);
    paintPins();
    drawCompare();
    syncUrl();
  }

  /**
   * Keep the address bar showing what is on screen.
   *
   * `?pin=` could already open a comparison; this is the other half of it —
   * without this you can follow a shared link but you cannot produce one
   * except by typing it, which nobody will do. Pin three countries and the
   * URL is now the thing to send.
   *
   * replaceState, not pushState: pinning is not navigation, and five toggles
   * should not cost five presses of the back button to undo.
   */
  function syncUrl() {
    var q = pins.length ? '?pin=' + pins.map(encodeURIComponent).join(',') : '';
    history.replaceState(null, '', location.pathname + q);
  }

  function paintPins() {
    rows.forEach(function (li) {
      var on = pins.indexOf(li._q.name) >= 0;
      var a = li.firstChild;
      a.classList.toggle('is-pinned', on);
      a.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ── the comparison ─────────────────────────────────────────────
     The reason pinning exists. Bars against the largest of the set,
     because the question is which is bigger and by how much — and five
     figures in a column answer that far more slowly than five bars do.
     Area comes straight out of the dot count: every cell on the grid
     covers the same 8 052 km².

     ROWS ARE KEPT, NOT REBUILT. The first version emptied the list and
     made it again on every change, which meant every bar was a brand new
     element already at its final width — so the CSS transition on width
     had nothing to transition FROM and every bar snapped. Keeping each
     row keyed by name means an existing bar animates to its new length
     when the largest of the set changes, and only a genuinely new row
     plays the entrance. */
  var panel = document.querySelector('[data-compare]');
  var list2 = panel && panel.querySelector('[data-compare-list]');
  var madeRows = {};
  var M = window.Motion;
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canMove = !still && M && M.animate;

  /**
   * Put an element back in the stylesheet's hands, on a timer.
   *
   * Every entrance here animates FROM something TO the element's resting
   * CSS — from transparent to opaque, from a few pixels low to in place.
   * So the finished state and the un-animated state are the same state,
   * and cancelling the animation lands on it just as surely as playing it
   * out does. That is the whole trick: the end state never depends on the
   * animation's clock.
   *
   * It has to be cancel() and not merely clearing the inline styles.
   * Motion runs these through the Web Animations API, and a live WAAPI
   * animation paints over the cascade whether or not anything is left in
   * the style attribute — an animation that stalls at 12% holds the panel
   * at 12% opacity with a perfectly clean style attribute. Measured in a
   * throttled tab: 900ms after the click, a 400ms fade still read 0.12.
   */
  function settle(el, anim, ms) {
    setTimeout(function () {
      if (anim) {
        try {
          if (anim.cancel) anim.cancel();
          else if (anim.stop) anim.stop();
        } catch (e) {
          /* already finished or detached — nothing to cancel */
        }
      }
      el.style.opacity = '';
      el.style.transform = '';
    }, ms);
  }

  function buildRow(q) {
    var li = document.createElement('li');
    li.className = 'compare-row';
    li.innerHTML =
      '<button type="button" class="compare-drop" aria-label="Remove ' +
      q.name + '">&times;</button>' +
      '<span class="compare-name"></span>' +
      '<span class="compare-bar"><i></i></span>' +
      '<span class="compare-num"></span>';
    li.querySelector('.compare-name').textContent = q.name;
    li.querySelector('.compare-drop').addEventListener('click', function () {
      togglePin(q);
    });
    li.addEventListener('pointerenter', function () {
      focusCountry(q.name);
    });
    return li;
  }

  function drawCompare() {
    if (!panel) return;

    if (!pins.length) {
      /* on the way out the panel goes first and the rows go with it —
         animating each row out of a panel that is itself leaving is two
         things saying the same thing */
      var done = function () {
        panel.hidden = true;
        list2.textContent = '';
        madeRows = {};
        /* the exit animation's last frame must not outlive the panel: an
           inline opacity:0 left on a hidden element is a panel that comes
           back invisible */
        panel.style.opacity = '';
        panel.style.transform = '';
      };
      if (canMove && !panel.hidden) {
        var out = M.animate(
          panel,
          { opacity: [1, 0], transform: ['translateY(0px)', 'translateY(-6px)'] },
          { duration: 0.22, ease: 'easeIn' },
        );
        settle(panel, out, 230);
        setTimeout(done, 230);
      } else done();
      return;
    }

    var first = panel.hidden;
    panel.hidden = false;
    if (first) {
      panel.style.opacity = '';
      panel.style.transform = '';
      if (canMove)
        settle(
          panel,
          M.animate(
            panel,
            { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0px)'] },
            { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
          ),
          600,
        );
    }

    var set = pins
      .map(function (n) {
        return byName[n];
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return b.cells - a.cells;
      });
    var top = Math.max(1, set[0].cells);

    /* anything no longer pinned leaves */
    Object.keys(madeRows).forEach(function (name) {
      if (pins.indexOf(name) >= 0) return;
      var el = madeRows[name];
      delete madeRows[name];
      if (!canMove) return el.remove();
      M.animate(
        el,
        { opacity: [1, 0], transform: ['translateX(0px)', 'translateX(-10px)'] },
        { duration: 0.2, ease: 'easeIn' },
      );
      setTimeout(function () {
        el.remove();
      }, 210);
    });

    set.forEach(function (q) {
      var fresh = !madeRows[q.name];
      var li = madeRows[q.name] || (madeRows[q.name] = buildRow(q));
      var km = Math.round((q.cells * 8052) / 1000);
      li.querySelector('.compare-num').textContent = q.cells
        ? km.toLocaleString('en') + 'k km²'
        : '< 8k km²';
      /* appending an element already in the list MOVES it, which is how the
         order is kept without rebuilding anything */
      list2.appendChild(li);

      var bar = li.querySelector('.compare-bar i');
      var pct = Math.max(2, (q.cells / top) * 100);
      if (fresh) {
        bar.style.width = '0%';
        if (canMove)
          settle(
            li,
            M.animate(
              li,
              { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0px)'] },
              { duration: 0.34, ease: [0.22, 1, 0.36, 1] },
            ),
            520,
          );
        /* Next frame, so the width has a value to leave FROM: set in the
           same frame the element was created in, the transition never
           runs. The timer behind it is the one that matters when rAF is
           throttled — a bar left at 0% reads as a country of no size. */
        var grow = function () {
          bar.style.width = pct + '%';
        };
        requestAnimationFrame(grow);
        setTimeout(grow, 120);
      } else {
        bar.style.width = pct + '%';
      }
    });
  }

  var clear = document.querySelector('[data-compare-clear]');
  if (clear)
    clear.addEventListener('click', function () {
      pins = [];
      pinCountries(pins);
      paintPins();
      drawCompare();
      syncUrl();
    });

  /* A comparison is worth sending to someone, and "open this and then click
     these three" is not a way to send one. `?pin=Brazil,India` opens with them
     already lit, which is also what the social preview image is a picture of.
     Names are matched exactly as they appear in the list; anything unknown is
     ignored rather than treated as an error, because a URL that half works is
     better than a blank page. */
  var asked = new URLSearchParams(location.search).get('pin');
  if (asked)
    asked.split(',').forEach(function (n) {
      var q = byName[n.trim()];
      if (q && pins.indexOf(q.name) < 0) togglePin(q);
    });

  apply();
  drawCompare();
})();
