/**
 * The Earth, in dots, turning — every country in it.
 *
 * The land and the countries both come from Natural Earth's admin-0 borders,
 * sampled into `world-data.js`; that file's header covers the grain and what
 * "exact" does and does not mean at this scale.
 *
 * WHY CANVAS, NOT SVG: the first version drew one <circle> per dot and wrote
 * four attributes to each of them every frame. That is fine at two thousand
 * dots and impossible at eighteen thousand — seventy thousand DOM writes a
 * frame. The projection did not change; only where it puts its pixels.
 *
 * WHY NOT A 3D LIBRARY: three.js is several hundred kilobytes to do what is a
 * few multiplies per dot. Each dot's place on the sphere is precomputed once
 * as a unit vector, so turning the globe is a 2D rotation of that vector with
 * ONE sine and cosine per FRAME rather than four per dot. That is what makes
 * eighteen thousand dots cheap enough to animate.
 *
 * WHY THE COLOUR IS BY CONTINENT AND NOT BY COUNTRY: two hundred and
 * thirty-four fill colours would be two hundred and thirty-four canvas state
 * changes per depth band per frame, and — more to the point — two hundred and
 * thirty-four colours on one sphere is noise, not information. At rest the map
 * is seven tones, one per continent, which is a shape the eye can read. A
 * country only takes its own colour while it is the one being pointed at.
 *
 * It turns on its own, a drag is a throw, and friction walks it back to that
 * idle drift rather than to a stop. One axis only — see the move handler.
 *
 * No build step and no imports on purpose: this file and world-data.js are
 * plain scripts, so the page opens from a file:// path as readily as from a
 * server. Call mountGlobe(canvasElement) and it runs.
 */

(function (global) {
  "use strict";

  var RAD = Math.PI / 180;

  /** name of the window event the country list fires on hover */
  var GLOBE_FOCUS = "globe:focus";
  /** and the one it fires when the pinned set changes */
  var GLOBE_PIN = "globe:pin";

  function hsl(c) {
    return (
      "hsl(" + c.h.toFixed(1) + " " + c.s.toFixed(1) + "% " + c.l.toFixed(1) + "%)"
    );
  }
  /** straight-line blend between two {h,s,l} */
  function mix(a, b, t) {
    return {
      h: a.h + (b.h - a.h) * t,
      s: a.s + (b.s - a.s) * t,
      l: a.l + (b.l - a.l) * t,
    };
  }

  /**
   * THE COLOUR OF THE EARTH, by latitude.
   *
   * The globe is painted as the planet looks rather than as a political map:
   * three families: green where it rains, yellow where it does not, blue at
   * the caps. What
   * makes that possible without a land-cover dataset is that Earth's biomes
   * are mostly ZONAL — they run in bands around the planet, because what sets
   * them is how much sun a latitude gets and where the atmosphere's
   * circulation cells put the rain.
   *
   * Three things are modelled, and they are the three that a latitude
   * actually predicts:
   *
   *   the ice, above about 62 degrees, where the caps begin;
   *   the ARID BELT at 25 degrees north and south, which is not a
   *     coincidence — it is where the Hadley cell comes back down, dry, and
   *     it is the reason the Sahara, Arabia, the Thar, the Kalahari, the
   *     Atacama and the Australian interior all sit at the same distance from
   *     the equator;
   *   and the green in between, deepest at the equator where the same
   *     circulation dumps its rain, cooling toward teal by the time it
   *     reaches the mid-latitudes.
   *
   * What it CANNOT know is longitude, so it has no way to tell the Sahara
   * from India at 25 degrees north, and India comes out as yellow as the
   * Sahara. That
   * is the honest limit of a zonal model, and fixing it needs a land-cover
   * raster rather than a cleverer formula.
   *
   * The bands are computed smoothly and then quantised into BIOMES steps,
   * because colour is a canvas state change and one per dot would be
   * eighteen thousand of them a frame.
   */
  /**
   * Three families, and each one is doing a job the geography gave it:
   * GREEN where it rains, YELLOW where it does not, BLUE where it is frozen.
   *
   * They are not decoration on top of the zones — they ARE the zones. Green
   * is deepest at the equator because that is where the rain lands; yellow
   * peaks at 25 degrees because that is where the dry air comes back down;
   * blue takes over past 60 because that is where the ice starts. Reading the
   * globe left to right across Africa gives you green, yellow, green again,
   * which is the Congo, the Sahara and the Mediterranean in that order.
   */
  var TROPIC = { h: 158, s: 52, l: 32 }; // rainforest, wettest and deepest
  var TEMPERATE = { h: 172, s: 44, l: 42 }; // grass and mixed forest
  var ARID = { h: 48, s: 78, l: 52 }; // desert
  /* 58 and not the near-white it wants to be: the page behind the caps is
     white, so the top of the ramp has a floor it cannot go above or the
     Arctic simply stops being drawn. A real blue holds; an icy tint does not. */
  var ICE = { h: 206, s: 62, l: 58 };

  /**
   * The same ramp with the colour taken out, for the monochrome build.
   *
   * Not a desaturation of the colour ramp — that would hand ice and desert
   * almost the same grey, because on the colour ramp they are told apart by
   * hue and not by lightness. Re-pitched instead so that TONE carries the one
   * thing hue was carrying: how wet the land is. Darkest at the equator where
   * it rains most, lightest across the deserts and the poles, which are dry
   * for opposite reasons and both read as empty paper.
   *
   * The pale end is floored at 72. The page behind it is white, and a band
   * that goes lighter than this stops being drawn at all.
   */
  var MONO = {
    TROPIC: { h: 0, s: 0, l: 20 },
    TEMPERATE: { h: 0, s: 0, l: 38 },
    ARID: { h: 0, s: 0, l: 66 },
    ICE: { h: 0, s: 0, l: 72 },
  };

  var BIOMES = 22;
  var clamp01 = function (v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  };
  function earthAt(lat, set) {
    var a = Math.abs(lat);
    /* the caps, fading in rather than starting at a line */
    var ice = clamp01((a - 60) / 16);
    /* a bell centred on the subtropical high, which is where the deserts are */
    var arid = Math.exp(-Math.pow((a - 25) / 12, 2));
    var c = mix(set.TROPIC, set.TEMPERATE, clamp01(a / 54));
    c = mix(c, set.ARID, arid * 0.78);
    return mix(c, set.ICE, ice);
  }
  var COLOUR = { TROPIC: TROPIC, TEMPERATE: TEMPERATE, ARID: ARID, ICE: ICE };
  /* one entry per latitude band in each palette, built once */
  var BIOME_FILL = [];
  var BIOME_MONO = [];
  for (var bz = 0; bz < BIOMES; bz++) {
    var blat = (90 * (bz + 0.5)) / BIOMES;
    BIOME_FILL.push(earthAt(blat, COLOUR));
    BIOME_MONO.push(earthAt(blat, MONO));
  }
  var biomeIndex = function (lat) {
    return Math.min(BIOMES - 1, Math.floor((Math.abs(lat) / 90) * BIOMES));
  };

  /**
   * The one colour a pointed-at country takes.
   *
   * Not a shade of anything on the map: green, yellow and blue are all spoken
   * for by the terrain, so the highlight has to come from outside that range
   * or it reads as another kind of ground rather than as a selection. Red is
   * the one place left to go. It is the interface's own accent, which
   * on this page already means "this is the thing you are pointing at".
   */
  var PICKED = { h: 8, s: 84, l: 55 };

  /**
   * What the rest of the world fades to while one country is pointed at.
   *
   * Dimming the rest is a stronger way to pick something out than brightening
   * it, and it is gentler here than it was over a political map: taken too
   * far it bleaches the planet, and a green-and-blue Earth going grey is a
   * bigger loss than a colour key going grey.
   */
  var DIM_TONE = { s: 14, l: 80 };

  /**
   * Where the viewer is looking, in degrees of longitude away from the
   * country. At rest the globe sits turned so the country under the pointer
   * arrives to the left of centre, because the card crops the sphere's right
   * side and the left is the part actually on screen. When a country is picked
   * the offset closes toward the front, which turns it to face the reader.
   */
  var VIEW_OFFSET = 40;
  var VIEW_OFFSET_FOCUSED = 22;
  /** how much bigger the sphere gets while a country is picked */
  var ZOOM = 0.22;
  /** milliseconds for the zoom to travel, in and out */
  var ZOOM_MS = 560;

  /** shortest way round from a to b, in degrees */
  function shortest(a, b) {
    var d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  /* meridians and parallels every 30°, as unit vectors: enough to read as a
     globe, few enough to redraw with the dots */
  var GRID = (function () {
    var out = [];
    function pt(lng, lat) {
      var p = lat * RAD;
      var l = lng * RAD;
      return [Math.cos(p) * Math.cos(l), Math.sin(p), Math.cos(p) * Math.sin(l)];
    }
    var lng, lat, line;
    for (lng = -180; lng < 180; lng += 30) {
      line = [];
      for (lat = -90; lat <= 90; lat += 4) line.push(pt(lng, lat));
      out.push(line);
    }
    for (lat = -60; lat <= 60; lat += 30) {
      line = [];
      for (lng = -180; lng <= 180; lng += 4) line.push(pt(lng, lat));
      out.push(line);
    }
    return out;
  })();

  /* ── the countries ─────────────────────────────────────────────────────
     Each one keeps where to turn the globe to bring it into view. The turn
     target is the mean of its dots rather than a stored centroid — the dots
     are what is on screen, so they are what has to arrive in the middle. */
  var B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  var COUNTRIES = WORLD_COUNTRIES.map(function (c, i) {
    return {
      index: i,
      name: c.n,
      iso: c.c,
      continent: WORLD_CONTINENTS[c.k],
      sovereign: c.s || null,
      cells: c.z,
      /* accumulated while the dots are read, then averaged */
      sx: 0,
      sy: 0,
      sz: 0,
      n: 0,
      lat: 0,
      lng: 0,
    };
  });

  /* ── the dots ──────────────────────────────────────────────────────────
     Unit vectors, built once. `c` is the country index and `k` the latitude
     band the dot's colour comes from — the renderer asks for the band on
     every dot of every frame and for the country only when one is pointed
     at, so the band is what gets cached. */
  var LAND = (function () {
    var out = [];
    function add(lng, lat, ci) {
      var p = lat * RAD;
      var l = lng * RAD;
      var X = Math.cos(p) * Math.cos(l);
      var Y = Math.sin(p);
      var Z = Math.cos(p) * Math.sin(l);
      out.push({ X: X, Y: Y, Z: Z, c: ci, k: biomeIndex(lat) });
      var q = COUNTRIES[ci];
      q.sx += X;
      q.sy += Y;
      q.sz += Z;
      q.n++;
    }
    for (var r = 0; r < WORLD_RINGS.length; r++) {
      var ring = WORLD_RINGS[r];
      var k = 0;
      for (var i = 0; i < ring.n; i++) {
        if (ring.mask[i] !== "1") continue;
        var ci = B62.indexOf(ring.g[k * 2]) * 62 + B62.indexOf(ring.g[k * 2 + 1]);
        k++;
        add(-180 + (360 * i) / ring.n, ring.lat, ci);
      }
    }
    /* the countries smaller than one grid cell, at their own coordinates */
    for (var t = 0; t < WORLD_TINY.length; t++) {
      add(WORLD_TINY[t].lng, WORLD_TINY[t].lat, WORLD_TINY[t].i);
    }
    return out;
  })();

  /* the mean direction of each country's dots, turned back into lat/lng */
  for (var qi = 0; qi < COUNTRIES.length; qi++) {
    var q = COUNTRIES[qi];
    if (!q.n) continue;
    var m = Math.hypot(q.sx, q.sy, q.sz) || 1;
    q.lat = Math.asin(q.sy / m) / RAD;
    q.lng = Math.atan2(q.sz / m, q.sx / m) / RAD;
  }

  var BY_NAME = {};
  for (var bi = 0; bi < COUNTRIES.length; bi++) BY_NAME[COUNTRIES[bi].name] = COUNTRIES[bi];

  /**
   * Attach the globe to a <canvas>. Returns a teardown function.
   *
   * @param {HTMLCanvasElement} cv
   * @param {{centreLng?: number, centreLat?: number, draggable?: boolean,
   *          cropTo?: string}} [opts]
   *   cropTo — CSS selector for the element that visually crops this canvas.
   *     The country label is kept inside THAT box, not inside the canvas.
   */
  function mountGlobe(cv, opts) {
    opts = opts || {};
    var ctx = cv && cv.getContext("2d");
    if (!cv || !ctx) return function () {};

    var view = {
      lng: opts.centreLng === undefined ? 60 : opts.centreLng,
      lat: opts.centreLat === undefined ? 18 : opts.centreLat,
    };
    var draggable = opts.draggable !== false;
    var cropSelector = opts.cropTo || ".plate";
    /**
     * "colour" paints the terrain and picks a country out in red; "mono"
     * paints the terrain in greys and lets the pointed-at country be the only
     * colour anywhere on the page.
     *
     * The second is the stronger idea of the two and it is the same engine:
     * what changes is which ramp the base comes from and what a raised
     * country travels TOWARD. In mono it travels to its own terrain colour,
     * so pointing at a country does not just select it — it tells you what
     * kind of ground it is.
     */
    var mono = opts.palette === "mono";
    var BASE = mono ? BIOME_MONO : BIOME_FILL;

    var IDLE = -0.045;
    var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var idleSpeed = calm ? 0 : IDLE;

    var frame = 0;
    var running = false;
    var dragging = false;
    var last = { x: 0, y: 0 };
    var velocity = idleSpeed;
    var focus = null;
    /**
     * Countries that stay lit whether or not the pointer is on them.
     *
     * `lifts` was always a LIST — it had to be, so that leaving one country
     * and arriving at another could happen at the same time rather than one
     * cutting the other. Pinning is that list held open: a pinned country
     * simply never gets told to come back down. Nothing else in the drawing
     * had to change, which is the whole reason this was cheap.
     */
    var pinned = [];
    var isPinned = function (q) {
      return pinned.indexOf(q) >= 0;
    };
    /**
     * How far each country has risen, 0..1 — and only the handful that are
     * off zero are kept, because two hundred and thirty-four entries eased
     * every frame to hold two non-zero numbers is work for nothing.
     *
     * It is a list and not a single value because of what happens between two
     * countries. With one shared height, moving the pointer from Chad to
     * Sudan dropped Chad in a single frame and raised Sudan already standing —
     * the swap was the one moment in the whole interaction with no animation
     * in it. Each country eases on its own, so a swap is one falling and one
     * rising at the same time.
     */
    var lifts = []; // [{ q: country, v: 0..1 }]
    /* Raw progress 0..1 for the zoom, moved by the clock rather than by a
       fraction of the remaining distance. Exponential smoothing can only ease
       OUT — it leaves fastest at the first frame — and what this wants is an
       S-curve, so the progress runs linearly and smoothstep bends it into
       one: slow away, quick through the middle, slow to a stop. */
    var zoomT = 0;
    var lastT = 0;
    /* The canvas is wide and short, and the sphere sits toward its right, so
       the card's left half stays clear for the copy. */
    var cw = 0;
    var ch = 0;
    /* The canvas deliberately runs off the card's right edge, so "inside the
       canvas" is not the same as "on screen". These are the card's edges in
       the canvas's own coordinates, and they are what the label has to stay
       within — clamping to the canvas let the panel hang over the crop and
       get sliced in half. */
    var seenLeft = 0;
    var seenRight = 0;
    var seenTop = 0;
    var dpr = 1;
    var ink = "#2e2318";

    /* Alpha costs a state change per dot, so the depth fade is quantised into
       bands and each band is drawn as one path — group × band is the whole
       batching scheme, a couple of hundred fills a frame instead of eighteen
       thousand. Five bands was too few: the steps showed up as concentric
       rings of shading across the sphere, which read as a lighting artefact
       rather than as depth. Eighteen is below the eye's threshold here and
       still costs nothing. */
    var BANDS = 18;
    /* how many colour groups the map itself needs: one per latitude band */
    var CONT = BIOMES;
    /* group index per country, rebuilt each frame: its continent normally,
       or a group of its own while it is rising or falling */
    /* Which group a dot draws in: its latitude band, unless its country is
       the one being pointed at. Countries straddle bands, so a raised country
       is pulled out of all of them into one group of its own — and it needs a
       band to fade back TO, which is the band its dots average out at. */
    var pickedBand = new Int32Array(COUNTRIES.length);
    var pickedGroup = new Int32Array(COUNTRIES.length).fill(-1);

    /**
     * Read the canvas's size off the page. Returns false when the page has
     * not laid out yet — which is not an edge case: a tab opened in the
     * background never lays out spontaneously, so the size at mount time is
     * zero and the ResizeObserver has nothing to observe a change FROM. Every
     * frame checks whether it still needs measuring, so the first frame after
     * the tab is looked at fixes it. Cheap, and it removes a whole class of
     * "works on my machine, blank for the user" from the component.
     */
    function measure() {
      var rect = cv.getBoundingClientRect();
      if (!rect.width) return false;
      /* a wide canvas at 2x is four million pixels to clear every frame;
         1.5 is past the point the dots look soft */
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cw = rect.width;
      ch = rect.height;
      var host = cv.closest(cropSelector) || cv.parentElement;
      var hr = host && host.getBoundingClientRect();
      seenLeft = hr ? Math.max(0, hr.left - rect.left) : 0;
      seenRight = hr ? Math.min(rect.width, hr.right - rect.left) : rect.width;
      seenTop = hr ? Math.max(0, hr.top - rect.top) : 0;
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ink = getComputedStyle(cv).color || ink;
      /* The label used to work out whether the surface behind it was light or
         dark, so its glass could go the right way. A black plate does not
         care what is behind it, so that whole question — and the bug where a
         mid-grey graticule tipped it the wrong way — is gone with it. */
      return true;
    }

    function draw() {
      if (!cw || !ch) return;
      /* smoothstep: the S-curve. 0 and 1 both have zero slope, so the zoom
         starts and finishes without a visible edge. */
      var e = zoomT * zoomT * (3 - 2 * zoomT);
      /* The radius is scaled so that FULL ZOOM is the size that fits, not the
         size that overflows: dividing by (1 + ZOOM) leaves exactly the room
         the zoom will need. Without it the zoomed sphere ran past the edge of
         the canvas bitmap and its limb came out cut off flat — which looked
         like the card cropping it, but was the canvas element itself. */
      var R = (ch * 0.43 * (1 + ZOOM * e)) / (1 + ZOOM);

      /* How far into "one country is being pointed at" we are. It rides the
         same eased progress as the zoom, so the rest of the world drains of
         colour on exactly the curve the globe grows on — one movement, not
         two things happening near each other. Declared up here because the
         sea is painted before anything else and has to know. */
      var dim = e;
      /* 0.62 and not 1: the rest of the world has to go quiet, not go away.
         Taken all the way it left a blank sphere with one country floating on
         it, and then nothing on screen said WHERE that country is — which is
         the one thing the map was there to answer. */
      var quiet = function (tone) {
        return dim
          ? mix(tone, { h: tone.h, s: DIM_TONE.s, l: DIM_TONE.l }, dim * 0.62)
          : tone;
      };
      /* the sphere hangs off the bottom-right of the canvas */
      var cx = cw - ch * 0.5;
      var cy = ch * 0.5;
      ctx.clearRect(0, 0, cw, ch);

      var C = view.lng * RAD;
      var cosC = Math.cos(C);
      var sinC = Math.sin(C);
      var p0 = view.lat * RAD;
      var cosP0 = Math.cos(p0);
      var sinP0 = Math.sin(p0);

      /**
       * No sea. The water is the page showing through, and the planet is the
       * dots plus the two sets of lines that hold them on a sphere.
       *
       * A flat blue disc was tried and dropped: filling the ocean turns the
       * globe into the heaviest object on a white page, and the dotted land
       * — which is the actual subject — ends up as texture on top of a large
       * blue circle rather than as the thing being looked at. Leaving the
       * water empty also means the land keeps its own colours against paper
       * instead of against a colour that competes with all of them.
       */
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 6.2832);
      /* The limb, drawn properly. It is the edge of a planet, and at 0.16 of
         a hairline it was not reading as one — with no fill behind it, this
         line IS the sphere's silhouette and has to carry it alone. */
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.34 * (1 - 0.4 * dim);
      ctx.lineWidth = 1.3;
      ctx.stroke();

      /* The graticule, broken wherever it goes round the back — and nearly
         twice the weight it used to be. These are the lines that say
         "sphere": without them and without a fill, the dots read as a flat
         scatter rather than as something wrapped around a ball. */
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.19 * (1 - 0.45 * dim);
      ctx.lineWidth = 0.8;
      for (var gr = 0; gr < GRID.length; gr++) {
        ctx.beginPath();
        var pen = false;
        for (var pi = 0; pi < GRID[gr].length; pi++) {
          var v = GRID[gr][pi];
          var ga = v[0] * cosC + v[2] * sinC;
          if (sinP0 * v[1] + cosP0 * ga <= 0.02) {
            pen = false;
            continue;
          }
          var gx = cx + R * (v[2] * cosC - v[0] * sinC);
          var gy = cy - R * (cosP0 * v[1] - sinP0 * ga);
          if (pen) ctx.lineTo(gx, gy);
          else ctx.moveTo(gx, gy);
          pen = true;
        }
        ctx.stroke();
      }

      /* Which group each dot belongs to this frame: its continent, unless it
         is one of the few countries currently up off the surface, which each
         get a group of their own so they can carry their own colour. */
      var groups = CONT;
      var lift = [0];
      var fill = [];
      for (var ci = 0; ci < CONT; ci++) {
        lift[ci] = 0;
        fill[ci] = hsl(quiet(BASE[ci]));
      }
      for (var li = 0; li < lifts.length; li++) {
        var L = lifts[li];
        pickedGroup[L.q.index] = groups;
        lift[groups] = L.v;
        /**
         * The colour travels with the rise, so one movement does both — but
         * it has to travel to where this country WOULD be if it were not
         * risen, which while another country is pointed at is the quiet tone
         * and not the full one.
         *
         * Mixing toward the full tone is what made swapping countries look
         * broken. The one being left behind faded from its own shade to its
         * continent's FULL colour, so for the whole of that fade it stayed
         * the brightest thing on a sphere that had gone pale — reading as a
         * hold rather than a fade — and then popped to pale in a single frame
         * when its lift finally crossed the threshold to be dropped. Ending
         * the fade at the quiet tone removes both the hold and the pop: it is
         * one continuous slide from lit to quiet, and the frame it is dropped
         * on is the frame it already matches.
         */
        fill[groups] = hsl(
          mix(quiet(BASE[L.band]), mono ? BIOME_FILL[L.band] : PICKED, L.v),
        );
        groups++;
      }

      /* the dots, bucketed by group and depth */
      var buckets = [];
      for (var bk = 0; bk < groups; bk++) {
        var rowb = [];
        for (var b0 = 0; b0 < BANDS; b0++) rowb.push([]);
        buckets.push(rowb);
      }
      /* A point lifted off the sphere projects in the same direction from the
         centre, only further out — so raising a country is one multiply on
         its dots' distance from the middle of the disc, no second
         projection. */
      for (var i = 0; i < LAND.length; i++) {
        var d = LAND[i];
        var a = d.X * cosC + d.Z * sinC;
        var facing = sinP0 * d.Y + cosP0 * a;
        if (facing <= 0.02) continue;
        /* its latitude band, unless its country is currently raised */
        var picked = pickedGroup[d.c];
        var gidx = picked < 0 ? d.k : picked;
        var band = Math.min(BANDS - 1, Math.floor(facing * BANDS));
        var up = 1 + 0.05 * lift[gidx];
        buckets[gidx][band].push(
          cx + R * (d.Z * cosC - d.X * sinC) * up,
          cy - R * (cosP0 * d.Y - sinP0 * a) * up,
        );
      }
      for (var g = 0; g < groups; g++) {
        var raised = lift[g];
        for (var b = 0; b < BANDS; b++) {
          var pts = buckets[g][b];
          if (!pts.length) continue;
          var f = (b + 0.5) / BANDS;
          /* the risen country is also a touch fatter and brighter, which is
             what sells it as nearer rather than merely moved */
          var r = R * (0.0023 + 0.0039 * f) * (1 + 0.45 * raised);
          /* The fade toward the limb is what gives the sphere its roundness,
             but it cannot go far: a tone drawn at half opacity sinks toward
             the page behind it, and two regions that were distinct in the
             middle merge into the same murk at the edge. */
          var depth = 0.55 + 0.45 * f;
          /**
           * A RAISED COUNTRY DOES NOT FADE AT ALL.
           *
           * It used to: the depth fade applied to everything, so the one
           * country being pointed at came out at 72% near the limb and full
           * strength in the middle — dimmest exactly when it had been turned
           * to and was still arriving. It is the answer to the question being
           * asked, and the answer should not be weaker on one side of the
           * globe than the other.
           *
           * So `raised` lifts it off the depth curve entirely and lands it at
           * 1. The interpolation is what keeps it continuous: at raised 0 this
           * is the plain depth fade, at raised 1 it is opaque, and a country
           * on its way down walks back down the curve rather than stepping.
           */
          var lit = depth + (1 - depth) * raised;
          /* The quiet ones also step back in opacity — colour alone leaves
             the faded map still crowding the country in front of it. Scaling
             that step by (1 - raised) is the same trick again: a country
             fully up is exempt, one on its way down gives the dim back at
             exactly the rate it loses its lift, and a region that was never
             raised gets the full step. */
          ctx.globalAlpha = lit * (1 - 0.28 * dim * (1 - raised));
          ctx.fillStyle = fill[g];
          ctx.beginPath();
          for (var pj = 0; pj < pts.length; pj += 2) {
            ctx.moveTo(pts[pj] + r, pts[pj + 1]);
            ctx.arc(pts[pj], pts[pj + 1], r, 0, 6.2832);
          }
          ctx.fill();
        }
      }
      /* put the map back the way it was found */
      for (var ri = 0; ri < lifts.length; ri++)
        pickedGroup[lifts[ri].q.index] = -1;

      /* One label per lit country. With two or three pinned for comparison,
         labelling only the hovered one would leave the others as anonymous
         coloured blobs — which is the opposite of a comparison. */
      var shown = pinned.slice();
      if (focus && shown.indexOf(focus) < 0) shown.push(focus);
      /* where labels have already been put this frame, so the next one can
         get out of their way */
      var placed = [];
      for (var li2 = 0; li2 < shown.length; li2++) {
        var q2 = shown[li2];
        if (!q2 || !q2.n) continue;
        var fa =
          Math.cos(q2.lat * RAD) * Math.cos(q2.lng * RAD) * cosC +
          Math.cos(q2.lat * RAD) * Math.sin(q2.lng * RAD) * sinC;
        var fy = Math.sin(q2.lat * RAD);
        if (sinP0 * fy + cosP0 * fa <= 0) continue;
        var ax =
          cx +
          R *
            (Math.cos(q2.lat * RAD) * Math.sin(q2.lng * RAD) * cosC -
              Math.cos(q2.lat * RAD) * Math.cos(q2.lng * RAD) * sinC);
        var ay = cy - R * (cosP0 * fy - sinP0 * fa);
        label(ctx, R, ax, ay, q2.name, q2.continent, placed);
      }
      ctx.globalAlpha = 1;

      function label(ctx, R, anchorX, anchorY, title, sub, placed) {
        /* Small on purpose. These were half again this size, which was fine
           for one and a wall for four: pin a handful of neighbours and the
           plates covered the countries they were naming. A label is an
           annotation on a map, not a headline, and with several on screen
           the map has to stay the thing you are looking at. */
        var nameFont =
          "600 " + (R * 0.05).toFixed(1) + 'px "Noto Sans", system-ui, sans-serif';
        var subFont =
          "400 " + (R * 0.042).toFixed(1) + 'px "Noto Sans", system-ui, sans-serif';
        /* One line — "Thailand : Asia" — so the plate is a wide rectangle
           rather than a squarish two-line box. Measured in two pieces because
           it is still set in two weights: the name is what you are reading,
           the region is what qualifies it. */
        var sep = " · ";
        ctx.font = nameFont;
        var wName = ctx.measureText(title).width;
        ctx.font = subFont;
        var wRest = ctx.measureText(sep + sub).width;
        var wide = wName + wRest;

        /* The words hang up and to the left of the country. Near the left edge
           there is no room for them and they were being cut off by the canvas,
           so the label flips to the other side instead — and is clamped either
           way, because the card crops this canvas too. */
        var pad = R * 0.06;
        var limitL = seenLeft + pad;
        var limitR = seenRight - pad;
        var right = anchorX - R * 0.16;
        var side = "right";
        if (right - wide < limitL) {
          side = "left";
          right = anchorX + R * 0.16 + wide;
        }
        right = Math.min(right, limitR);
        right = Math.max(right, limitL + wide);
        var ly = Math.max(seenTop + R * 0.14, anchorY - R * 0.2);

        /* the leader, from the country up to the label — it fades on the
           same progress, or it is left hanging in mid-air pointing at
           nothing while the plate shrinks away */
        ctx.globalAlpha = 0.32 * e;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(
          anchorX + (side === "right" ? -R * 0.03 : R * 0.03),
          anchorY - R * 0.05,
        );
        ctx.lineTo(side === "right" ? right + 2 : right - wide - 2, ly + 3);
        ctx.stroke();
        ctx.globalAlpha = 1;

        /**
         * A solid black plate, square-cornered, with the type reversed out
         * of it — and it zooms in and out rather than appearing.
         *
         * This replaced a frosted-glass panel: a patch of the globe copied to
         * a scrap canvas, blurred there and drawn back under a translucent
         * fill. That machinery existed to keep the words readable over a
         * field of dots, and a black plate does the same job by simply not
         * letting the dots through — no blur per frame, no scrap canvas, no
         * working out whether the surface underneath is light or dark.
         *
         * The zoom rides `e`, the eased focus progress the globe is already
         * using: 0 with nothing pointed at, 1 with something. So the plate
         * grows in and shrinks out on exactly the curve the sphere grows on,
         * which is one gesture rather than two that happen to overlap. It
         * scales about its own anchored corner, not its centre, so the corner
         * nearest the country stays put and the plate opens away from it.
         */
        var padX = R * 0.032;
        var padY = R * 0.026;
        var boxW = wide + padX * 2;
        /* one line of the larger of the two faces, plus its padding */
        var boxH = R * 0.066 + padY * 2;
        var boxX = right - wide - padX;
        var boxY = ly - R * 0.05 - padY;

        /**
         * Two plates must not land on each other.
         *
         * Pin two neighbours — Algeria and Libya — and their labels are
         * computed from anchors a few degrees apart, so they arrive on top
         * of one another and the lower one covers the upper one's name.
         * Which is precisely the case pinning exists for, so it cannot be
         * left to chance.
         *
         * Each plate that has already been drawn this frame is remembered,
         * and a new one steps UP by its own height until it clears them all.
         * Up rather than down because the anchor is below the label: moving
         * away from the country keeps the leader line pointing at it, and
         * moving toward it would put the plate over the dots being compared.
         */
        if (placed) {
          var step = boxH + R * 0.02;
          for (var tries = 0; tries < 6; tries++) {
            var hit = false;
            for (var pz = 0; pz < placed.length; pz++) {
              var o = placed[pz];
              if (
                boxX < o.x + o.w &&
                boxX + boxW > o.x &&
                boxY < o.y + o.h &&
                boxY + boxH > o.y
              ) {
                hit = true;
                break;
              }
            }
            if (!hit) break;
            boxY -= step;
            ly -= step;
          }
          /* and never above the top of the card, which crops this canvas */
          if (boxY < seenTop + R * 0.04) {
            var back = seenTop + R * 0.04 - boxY;
            boxY += back;
            ly += back;
          }
          placed.push({ x: boxX, y: boxY, w: boxW, h: boxH });
        }

        /* 0.72 to 1: enough travel to read as a zoom at a glance, not so much
           that the words are illegibly small on the way in */
        var k = 0.72 + 0.28 * e;
        var pivotX = side === "right" ? boxX + boxW : boxX;
        var pivotY = boxY + boxH;

        ctx.save();
        ctx.translate(pivotX, pivotY);
        ctx.scale(k, k);
        ctx.translate(-pivotX, -pivotY);
        ctx.globalAlpha = e;

        ctx.fillStyle = "#000000";
        ctx.fillRect(boxX, boxY, boxW, boxH);

        /* drawn left to right now, because the two pieces run on one line and
           the second has to start where the first finished */
        var textX = right - wide;
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = nameFont;
        ctx.fillText(title, textX, ly);
        ctx.globalAlpha = e * 0.62;
        ctx.font = subFont;
        ctx.fillText(sep + sub, textX + wName, ly);
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.textAlign = "left";
      }
    }

    function tick(now) {
      /* if the page had not laid out when this mounted, this is where it gets
         put right — see measure() */
      if (!cw) measure();
      /* clock-driven, so the curve is the same on a 60Hz and a 120Hz screen */
      var dt = lastT ? Math.min(64, now - lastT) : 16;
      lastT = now;
      var engaged = focus || pinned.length;
      zoomT = Math.max(0, Math.min(1, zoomT + ((engaged ? 1 : -1) * dt) / ZOOM_MS));
      var eased = zoomT * zoomT * (3 - 2 * zoomT);
      /* every country eases toward its own target, so leaving one and
         arriving at another happen together instead of one cutting the other */
      for (var i = lifts.length - 1; i >= 0; i--) {
        var want = lifts[i].q === focus || isPinned(lifts[i].q) ? 1 : 0;
        /* Down slightly faster than up. A swap is one country falling and one
           rising at the same moment, and if they move at the same rate the
           two cross in the middle and the eye has nowhere to settle; letting
           the old one clear out first hands the frame over cleanly. */
        lifts[i].v += (want - lifts[i].v) * (want ? 0.12 : 0.18);
        if (!want && lifts[i].v < 0.004) lifts.splice(i, 1);
      }
      /* anything lit has to be in the list before it can be raised */
      var wants = pinned.slice();
      if (focus && wants.indexOf(focus) < 0) wants.push(focus);
      for (var w = 0; w < wants.length; w++) {
        var held = false;
        for (var j = 0; j < lifts.length; j++) if (lifts[j].q === wants[w]) held = true;
        if (!held)
          lifts.push({ q: wants[w], v: 0, band: biomeIndex(wants[w].lat) });
      }

      if (engaged) {
        /**
         * Where to turn with several countries lit at once: the mean of their
         * directions, not the first one's. Taken as a VECTOR and not as an
         * average of longitudes — averaging 170 and -170 gives zero, which is
         * the far side of the planet from both of them.
         *
         * A single country is the same code with one term in the sum, so
         * there is no separate case for it.
         */
        var aim = focus ? [focus] : pinned;
        var tx = 0,
          ty = 0,
          tz = 0;
        var dir = [];
        for (var m = 0; m < aim.length; m++) {
          var pl = aim[m].lat * RAD,
            pg = aim[m].lng * RAD;
          var v = [
            Math.cos(pl) * Math.cos(pg),
            Math.sin(pl),
            Math.cos(pl) * Math.sin(pg),
          ];
          dir.push(v);
          tx += v[0];
          ty += v[1];
          tz += v[2];
        }
        var mag = Math.hypot(tx, ty, tz) || 1;
        var mx = tx / mag,
          my = ty / mag,
          mz = tz / mag;
        /**
         * Aim at the mean of the lit countries — but only while the mean
         * means something.
         *
         * Pin Brazil and Australia and their mean direction points at a spot
         * roughly a quarter of the planet from either, with both of them on
         * the limb: the camera obediently frames the midpoint of two things
         * and shows neither. Two countries on opposite sides of a sphere
         * cannot both be in view, and no amount of averaging fixes that.
         *
         * So: if everything lit is within 70 degrees of the mean, frame them
         * together, which is what makes pinning neighbours worth doing. If
         * they are spread wider than that, fall back to the one most
         * recently asked for — because whatever else is true, a click should
         * show you the thing you just clicked.
         */
        var worst = 1;
        for (var n2 = 0; n2 < dir.length; n2++) {
          var dot = dir[n2][0] * mx + dir[n2][1] * my + dir[n2][2] * mz;
          if (dot < worst) worst = dot;
        }
        var head = aim[aim.length - 1];
        /* cos 70 degrees */
        var together = worst > 0.342;
        var aimLng = together
          ? Math.atan2(mz, mx) / RAD
          : head.lng;
        var aimLat = together
          ? Math.asin(Math.max(-1, Math.min(1, my))) / RAD
          : head.lat;
        /* the offset closes as the zoom comes in, so growing and turning to
           face the reader are one movement rather than two */
        var offset = VIEW_OFFSET - (VIEW_OFFSET - VIEW_OFFSET_FOCUSED) * eased;
        view.lng += shortest(view.lng, aimLng + offset) * 0.09;
        view.lat += (Math.max(-52, Math.min(58, aimLat)) - view.lat) * 0.07;
        velocity = idleSpeed;
      } else if (!dragging) {
        /* friction, aimed at the idle drift instead of at zero */
        velocity += (idleSpeed - velocity) * 0.035;
        view.lng += velocity;
        view.lat += (18 - view.lat) * 0.03;
      }
      draw();
      frame = requestAnimationFrame(tick);
    }
    function start() {
      if (running) return;
      if (!cw) measure();
      running = true;
      lastT = 0;
      frame = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    function down(ev) {
      if (!draggable) return;
      dragging = true;
      focus = null;
      velocity = 0;
      last = { x: ev.clientX, y: ev.clientY };
      cv.setPointerCapture(ev.pointerId);
      cv.classList.add("is-turning");
      start();
    }
    function move(ev) {
      if (!dragging) return;
      /* One axis. Tilting as well let a careless drag leave the globe lying on
         its side with nothing on screen explaining how to get back. */
      var dx = (ev.clientX - last.x) * 0.32;
      view.lng -= dx;
      velocity = -dx; // the hand's speed IS the throw
      last = { x: ev.clientX, y: ev.clientY };
    }
    function up(ev) {
      if (!dragging) return;
      dragging = false;
      if (cv.hasPointerCapture(ev.pointerId)) cv.releasePointerCapture(ev.pointerId);
      cv.classList.remove("is-turning");
    }

    function onFocus(ev) {
      var name = (ev.detail && ev.detail.country) || null;
      focus = name ? BY_NAME[name] || null : null;
      start();
    }

    measure();
    draw(); // paint before the first animation frame, so it is never blank
    var onPin = function (ev) {
      var names = (ev.detail && ev.detail.countries) || [];
      pinned = [];
      for (var pi2 = 0; pi2 < names.length; pi2++) {
        var pq = BY_NAME[names[pi2]];
        if (pq) pinned.push(pq);
      }
      start();
    };
    window.addEventListener(GLOBE_FOCUS, onFocus);
    window.addEventListener(GLOBE_PIN, onPin);
    /* Anything asked for before the globe existed. These are window events,
       and an event dispatched before the listener is attached goes nowhere —
       which is exactly what a script tag in the body does, because the canvas
       is only measurable once the page has loaded and mountGlobe therefore
       runs on `load`. Without this, `?pin=Brazil` lit the row and drew the
       bars while the globe spun on regardless. Anyone driving this from their
       own page would have hit the same order. */
    if (waiting.pin) onPin({ detail: { countries: waiting.pin } });
    if (waiting.focus) onFocus({ detail: { country: waiting.focus } });
    var ro = new ResizeObserver(function () {
      measure();
      draw();
    });
    ro.observe(cv);
    /* a globe spins for nobody when it is not on screen */
    var io = new IntersectionObserver(
      function (entries) {
        if (entries[0].isIntersecting) start();
        else stop();
      },
      { rootMargin: "120px" },
    );
    io.observe(cv);
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    return function destroy() {
      io.disconnect();
      ro.disconnect();
      stop();
      window.removeEventListener(GLOBE_FOCUS, onFocus);
      window.removeEventListener(GLOBE_PIN, onPin);
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
    };
  }

  /* what was asked for before any globe was listening — see mountGlobe */
  var waiting = { focus: null, pin: null };

  function focusCountry(name) {
    waiting.focus = name || null;
    window.dispatchEvent(
      new CustomEvent(GLOBE_FOCUS, { detail: { country: name } }),
    );
  }
  /** replace the set of countries that stay lit; pass [] to clear */
  function pinCountries(names) {
    waiting.pin = names && names.length ? names.slice() : null;
    window.dispatchEvent(
      new CustomEvent(GLOBE_PIN, { detail: { countries: names || [] } }),
    );
  }

  global.mountGlobe = mountGlobe;
  global.focusCountry = focusCountry;
  global.pinCountries = pinCountries;
  global.GLOBE_FOCUS = GLOBE_FOCUS;
  global.GLOBE_PIN = GLOBE_PIN;
  global.GLOBE_COUNTRIES = COUNTRIES;
  global.GLOBE_CONTINENTS = WORLD_CONTINENTS;
  /* the terrain ramp itself, so a legend can read its swatches off the map
     rather than restating them and drifting */
  global.GLOBE_BIOME = BIOME_FILL;
  global.GLOBE_BIOME_MONO = BIOME_MONO;
})(window);
