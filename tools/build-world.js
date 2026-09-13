/**
 * Rebuild ../world-data.js from Natural Earth's country borders.
 *
 *   node tools/build-world.js path/to/ne_50m_admin_0_countries.geojson
 *
 * Get the file (public domain, ~3 MB) from:
 * https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
 *
 * WHY THE BORDERS DEFINE THE LAND, and not a photograph. An earlier version of
 * this sampled a satellite image for "is this pixel land" and then guessed the
 * country by nearest capital city. Two sources, two answers: dots that the
 * photo called land sat outside every border, and borders ran through cells
 * the photo called sea. Here one dataset answers both questions — a cell is
 * land because it falls inside some country's polygon, and that polygon is
 * which country it is. Coastlines and borders cannot disagree because they
 * are the same edges.
 *
 * WHAT "EXACT" MEANS HERE. The borders are exact: they are the survey, not an
 * approximation of it. The GRID is what is coarse. At 0.8 degrees a cell is
 * about 89 km across at the equator, so a country smaller than that contains
 * no grid point at all — Singapore, Malta, Bahrain and forty-odd others. Those
 * are not dropped: each gets one dot at its own true coordinates (below), so
 * every country on the map is present and can be pointed at. A dot is a
 * sample, not a shape; at this grain a country under ~5,000 km² is one dot
 * whether it is Luxembourg or Liechtenstein.
 */
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2];
if (!SRC) {
  console.error("usage: node tools/build-world.js <ne_50m_admin_0_countries.geojson>");
  process.exit(1);
}

/** degrees between grid points — the dot grain */
const STEP = 0.8;
const LAT_TOP = 84;
const LAT_BOT = -88;

/* index-to-two-characters, so a country code costs two bytes in the output
   string instead of a JSON array entry */
const B = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const enc = (i) => B[Math.floor(i / 62)] + B[i % 62];

const geo = JSON.parse(fs.readFileSync(SRC, "utf8"));

/* ── flatten to rings with bounding boxes ────────────────────────────────
   A country is a list of polygons; a polygon is an outer ring and zero or
   more holes. The bbox is the whole optimisation: a point is tested against a
   ring's 2,000 vertices only when it is inside that ring's box, which for a
   world of 242 countries turns ~24 million edge tests per row into a few
   thousand. */
const countries = [];
for (const f of geo.features) {
  const p = f.properties;
  const cont = p.CONTINENT;
  if (cont === "Seven seas (open ocean)") continue; // scattered rocks, no land
  const polys = [];
  const push = (poly) => {
    const rings = poly.map((ring) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const flat = new Float64Array(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][0], y = ring[i][1];
        flat[i * 2] = x;
        flat[i * 2 + 1] = y;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      return { flat, x0, y0, x1, y1 };
    });
    polys.push({ outer: rings[0], holes: rings.slice(1) });
  };
  if (f.geometry.type === "Polygon") push(f.geometry.coordinates);
  else if (f.geometry.type === "MultiPolygon") f.geometry.coordinates.forEach(push);
  if (!polys.length) continue;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of polys) {
    if (q.outer.x0 < x0) x0 = q.outer.x0;
    if (q.outer.y0 < y0) y0 = q.outer.y0;
    if (q.outer.x1 > x1) x1 = q.outer.x1;
    if (q.outer.y1 > y1) y1 = q.outer.y1;
  }
  countries.push({
    name: p.NAME,
    iso: p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ADM0_A3,
    continent: cont,
    /* Natural Earth's own label anchor — a point guaranteed to be inside the
       country, which a centroid is not (think Indonesia, or Chile). */
    labelLng: p.LABEL_X,
    labelLat: p.LABEL_Y,
    /* Whose sovereignty it sits under, which is NOT what TYPE says. Natural
       Earth types Jersey, Aruba, Greenland, Hong Kong and Åland as "Country",
       so a TYPE test sorts Åland in among the sovereign states — it was
       second in the list, right after Afghanistan. Comparing the sovereign to
       the administrator gets all sixteen of those right, and leaves Kosovo,
       Israel, Western Sahara and Antarctica standing on their own, which a
       TYPE test does not. */
    sovereign: p.SOVEREIGNT !== p.ADMIN ? p.SOVEREIGNT : null,
    polys,
    x0, y0, x1, y1,
    cells: 0,
  });
}
countries.sort((a, b) => a.name.localeCompare(b.name));

/** ray casting, one ring */
function inRing(r, x, y) {
  if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return false;
  const f = r.flat;
  let inside = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function inCountry(c, x, y) {
  if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) return false;
  for (const q of c.polys) {
    if (!inRing(q.outer, x, y)) continue;
    let hole = false;
    for (const h of q.holes) if (inRing(h, x, y)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

/* ── the grid ──────────────────────────────────────────────────────────── */
const rings = [];
let land = 0;
for (let lat = LAT_BOT; lat <= LAT_TOP + 0.001; lat += STEP) {
  const n = Math.max(1, Math.round((360 / STEP) * Math.cos((lat * Math.PI) / 180)));
  /* only the countries whose box straddles this row are worth asking */
  const row = countries.filter((c) => lat >= c.y0 - STEP && lat <= c.y1 + STEP);
  let mask = "";
  let g = "";
  for (let i = 0; i < n; i++) {
    const lng = -180 + (360 * i) / n;
    let hit = -1;
    for (let k = 0; k < row.length; k++) {
      if (inCountry(row[k], lng, lat)) { hit = countries.indexOf(row[k]); break; }
    }
    if (hit < 0) { mask += "0"; continue; }
    mask += "1";
    g += enc(hit);
    countries[hit].cells++;
    land++;
  }
  if (mask.indexOf("1") < 0) continue;
  rings.push({ lat: +lat.toFixed(2), n, mask, g });
}

/* ── countries too small for the grid ───────────────────────────────────
   One dot each, at Natural Earth's own label anchor, which is a point inside
   the country rather than a centroid that can fall in the sea. These are
   listed separately so the renderer can draw them and the README can say
   plainly which dots are samples of a shape and which are a whole country. */
const tiny = [];
for (let i = 0; i < countries.length; i++) {
  const c = countries[i];
  if (c.cells) continue;
  const lng = Number.isFinite(c.labelLng) ? c.labelLng : (c.x0 + c.x1) / 2;
  const lat = Number.isFinite(c.labelLat) ? c.labelLat : (c.y0 + c.y1) / 2;
  tiny.push({ i, lng: +lng.toFixed(3), lat: +lat.toFixed(3) });
}

const CONTINENTS = [];
for (const c of countries) if (!CONTINENTS.includes(c.continent)) CONTINENTS.push(c.continent);
CONTINENTS.sort();

const out =
  "/**\n" +
  " * Every country in the world, as dots on a sphere.\n" +
  " *\n" +
  " * GENERATED by tools/build-world.js from Natural Earth 1:50m admin-0\n" +
  " * countries (public domain). Do not hand-edit.\n" +
  " *\n" +
  " * Borders are Natural Earth's, unmodified: no nearest-city guessing, no\n" +
  " * hand-traced coastlines. A cell is land because it falls inside a\n" +
  " * country's polygon, so the coastline and the border are the same edge and\n" +
  " * cannot disagree with each other.\n" +
  " *\n" +
  " * GRAIN: " + STEP + " degrees, about " + Math.round(STEP * 111) + " km at the equator. " + rings.length + " rings,\n" +
  " * " + land + " land cells. A country smaller than one cell contains no grid\n" +
  " * point, so the " + tiny.length + " countries in WORLD_TINY get one dot each at their own\n" +
  " * true coordinates instead. Their dot is exactly placed; it is simply one\n" +
  " * dot rather than a shape.\n" +
  " *\n" +
  " * Disputed borders follow Natural Earth's de-facto view (Crimea, Kashmir,\n" +
  " * Western Sahara, Taiwan). It is a defensible default, not a position.\n" +
  " *\n" +
  " * WORLD_RINGS[i] = { lat, n, mask, g }\n" +
  " *   n     how many longitude cells this parallel is divided into\n" +
  " *   mask  \"1\" where that cell is land\n" +
  " *   g     two characters per LAND cell, in mask order: an index into\n" +
  " *         WORLD_COUNTRIES, base-62, high digit first\n" +
  " */\n" +
  "const WORLD_STEP = " + STEP + ";\n\n" +
  "/** the colour zones: each gets one hue family */\n" +
  "const WORLD_CONTINENTS = " + JSON.stringify(CONTINENTS) + ";\n\n" +
  "/** { n: name, c: ISO code, k: index into WORLD_CONTINENTS, d: 1 if a\n" +
  " *    dependency rather than a sovereign state, z: how many grid cells } */\n" +
  "const WORLD_COUNTRIES = [\n" +
  countries
    .map((c) =>
      "  " +
      JSON.stringify({
        n: c.name,
        c: c.iso,
        k: CONTINENTS.indexOf(c.continent),
        ...(c.sovereign ? { s: c.sovereign } : {}),
        z: c.cells,
      }),
    )
    .join(",\n") +
  "\n];\n\n" +
  "/** countries smaller than one grid cell: { i: country index, lng, lat } */\n" +
  "const WORLD_TINY = " + JSON.stringify(tiny) + ";\n\n" +
  "const WORLD_RINGS = " + JSON.stringify(rings) + ";\n";

const dest = path.join(__dirname, "..", "world-data.js");
fs.writeFileSync(dest, out);

console.log("countries   ", countries.length);
console.log("continents  ", CONTINENTS.join(", "));
console.log("rings       ", rings.length);
console.log("land cells  ", land);
console.log("one-dot     ", tiny.length, tiny.length ? "(" + tiny.slice(0, 8).map((t) => countries[t.i].name).join(", ") + (tiny.length > 8 ? ", …" : "") + ")" : "");
console.log("written     ", dest, (fs.statSync(dest).size / 1024).toFixed(1) + " KB");
