/**
 * The plate, arriving — with Motion (Framer Motion's vanilla build).
 *
 * A NOTE ON THE LIBRARY: "Framer Motion" proper is a React renderer, and this
 * page has no React and is not going to get any for an entrance. What it uses
 * instead is `motion`, the standalone build from the same project and the
 * same author — `animate()`, `stagger()`, `spring()` — which is the identical
 * animation engine with the React layer taken off. 65 KB, vendored, no build
 * step. If this page were React, the markup would carry <motion.div> and the
 * timings below would move across unchanged.
 *
 * WHAT IT ANIMATES, AND WHY THAT: a plate is typeset, so the entrance is a
 * printing sequence rather than a set of effects. The title is uncovered
 * from behind its own line, the rules are drawn across, and the columns are
 * set last. Nothing scales, nothing blurs, nothing
 * arrives from off to the side — those all say "app", and this says "page".
 *
 * The spring on the title is the one place a physical curve belongs: a word
 * sliding up behind a mask is the only thing here with mass.
 */

(function () {
  "use strict";

  var M = window.Motion;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !M || !M.animate) return;

  var animate = M.animate;
  var stagger = M.stagger;

  /**
   * The rolling second line.
   *
   * Ported from a React/Tailwind component rather than dropped in — this page
   * has no React, no Tailwind and no build step, and adding all three to
   * cycle four words would cost more than the words are worth. What came
   * across is the idea (a fixed line, a rolling one, a mask) and what changed
   * is everything the original used to express it:
   *
   *   - the step is MEASURED, not the original's hard-coded 2rem. This title
   *     is a clamp() between 40 and 76 pixels, so there is no constant to
   *     write down; the step is the first item's own height, re-read whenever
   *     the window resizes.
   *   - it is a spring rather than a 700ms ease, because everything else that
   *     moves on this page is, and one eased thing among springs reads as a
   *     different page.
   *   - no colours. The original gives each line its own; here the whole
   *     design turns on colour appearing only under the pointer, so the
   *     roller stays in ink and the motion does the work.
   *   - it stops when the tab is hidden. A timer that keeps firing into a
   *     background tab is a small thing done wrong for no gain.
   */
  function roller(track) {
    if (!track) return;
    var items = track.children;
    if (items.length < 2) return;
    var i = 0;
    var timer = null;

    var step = function () {
      /* re-read every tick: the title is a clamp, so the step changes with
         the window and a cached number would drift the line off centre */
      return items[0].getBoundingClientRect().height;
    };
    var tick = function () {
      i = (i + 1) % items.length;
      animate(
        track,
        { transform: "translateY(" + -(i * step()) + "px)" },
        { type: "spring", stiffness: 190, damping: 26, mass: 0.9 },
      );
    };
    var start = function () {
      if (!timer) timer = setInterval(tick, 2400);
    };
    var stop = function () {
      clearInterval(timer);
      timer = null;
    };
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });
    /* a resize changes the step, so the current line has to be re-seated
       without animating — otherwise it slides from the old offset */
    addEventListener("resize", function () {
      track.style.transform = "translateY(" + -(i * step()) + "px)";
    });
    start();
  }

  var titleWords = document.querySelectorAll(".plate-title .line > *");
  var rules = document.querySelectorAll(".rule");
  var cols = document.querySelectorAll(".col > *");

  var moved = []
    .concat(
      [].slice.call(titleWords),
      [].slice.call(rules),
      [].slice.call(cols),
    )
    .filter(Boolean);

  document.documentElement.classList.add("is-animating");

  /**
   * Reveal everything, whatever the animations are doing.
   *
   * Hiding the copy behind an entrance means the copy is only as reliable as
   * the entrance, and that is not a hypothetical: the colour edition of this
   * page came back from a headless screenshot completely blank, because the
   * process never advanced the animation clock and the class that hides
   * everything was only ever removed on completion. Anything that does not
   * run requestAnimationFrame the way a foreground tab does — a screenshot
   * pipeline, a scraper, a blocked script, a 404 on the library — gets a
   * blank page. So the class comes off on a timer as well, and the inline
   * styles are cleared by hand rather than by asking the library to undo
   * itself.
   */
  var seq = [];
  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    /**
     * Finish the animations before clearing what they wrote, not after.
     *
     * The first version just cleared the inline styles on a timer, and a
     * headless screenshot caught the page with half its columns still
     * half-transparent: the timer had cleared them and the animations, still
     * live, wrote their in-progress values straight back. `complete()` puts
     * each one at its end state and hands the properties back, so there is
     * nothing left to overwrite the clear. Same race the GSAP edition had,
     * same shape of fix.
     */
    seq.forEach(function (a) {
      try {
        if (a && a.complete) a.complete();
      } catch (e) {}
    });
    var wipe = function () {
      moved.forEach(function (el) {
        el.style.transform = "";
        el.style.opacity = "";
        /* cleared HERE and not only on the happy path: will-change promotes a
           layer for as long as it is set, and thirty forgotten layers is a
           worse bug than the one it was added to avoid */
        el.style.willChange = "";
      });
    };
    /**
     * Twice, and the second time is the one that sticks.
     *
     * `complete()` does not finish writing synchronously — it jumps the
     * animation to its end and the final values land on the next frame, AFTER
     * a clear that ran in this one. Measured: eight elements left carrying
     * translateY(0%), scaleX(1), opacity 1 — their own end values, invisible
     * but real, and a stray transform is a containing block and a stacking
     * context that nothing asked for.
     *
     * The first wipe is the one that matters when rAF never runs at all,
     * which is the whole reason this function exists; the second is the one
     * that matters when it does.
     */
    wipe();
    requestAnimationFrame(wipe);
    document.documentElement.classList.remove("is-animating");
  }
  /**
   * When the sequence is over, on a clock rather than on a promise.
   *
   * The first version waited on `Promise.all` of every animation's `finished`
   * and never got there — measured: eight seconds after load the `.then` had
   * still not run, while each animation's own `finished` resolves fine when
   * tested on its own. Rather than keep bisecting a library's aggregate
   * promise, the length is taken from the timeline above, which is authored
   * here and therefore known: the last step starts at 0.38s, staggers
   * across four boxes and runs 0.5s.
   *
   * This is the second time on this project that hanging the page's visible
   * state off an animation callback has failed — GSAP's onComplete in the
   * colour edition was the first. A timer cannot not fire.
   */
  var END_MS = 1100;

  /* Motion writes its own inline styles, so the hiding class has to come off
     BEFORE the animations start or the two fight over the same properties —
     the class would win on specificity for anything it names. Everything is
     set to its start value inline first, which is the same frame, so nothing
     flashes. */
  moved.forEach(function (el) {
    el.style.willChange = "transform, opacity";
  });
  animate(titleWords, { transform: ["translateY(108%)", "translateY(0%)"] }, {
    duration: 0.001,
  });
  document.documentElement.classList.remove("is-animating");

  /* 1 — the title is uncovered from behind its own line. A spring, because a
         word sliding up behind a mask is the only thing on this page with
         anything like mass. */
  seq.push(
    animate(
      titleWords,
      { transform: ["translateY(108%)", "translateY(0%)"] },
      {
        delay: stagger(0.09),
        type: "spring",
        stiffness: 150,
        damping: 22,
        mass: 0.9,
      },
    ),
  );

  /* 2 — the rules are ruled, left to right, as a pen would */
  seq.push(
    animate(
      rules,
      { transform: ["scaleX(0)", "scaleX(1)"] },
      { duration: 0.75, delay: stagger(0.1, { start: 0.22 }), ease: [0.16, 1, 0.3, 1] },
    ),
  );

  /* 3 — the columns are set last, which is the order a page is made in */
  seq.push(
    animate(
      cols,
      { opacity: [0, 1], transform: ["translateY(14px)", "translateY(0px)"] },
      { duration: 0.5, delay: stagger(0.045, { start: 0.38 }), ease: "easeOut" },
    ),
  );

  setTimeout(function () {
    reveal();
    /* the cycle starts only once the entrance has landed: the line has to
       arrive before it can start changing */
    roller(document.querySelector("[data-roller]"));
  }, END_MS);
})();
