// Checks an explanation sentence by sentence against its evidence pack. The same rules
// apply to template sentences and to LLM output; nothing is shown as validated otherwise.
//
//  1. every sentence cites at least one evidence id, and every id exists
//  2. routes, bus services, segments, scenarios and times named must be in the pack and cited
//  3. every number must equal a cited item's displayed value, belong to an entity the
//     sentence names, and carry that item's unit; numbers must be digits, never words
//  4. cause words need a cited item of the matching kind; unsupported causes are rejected
//  5. no certainty or real-world claims, and a minutes, % or model-output value must say "simulated"
// Arithmetic is impossible to slip through: a computed number is not in the pack.

import { ROUTES, SCENARIOS } from "./data";
import { display, sentenceKind, type Evidence, type EvidencePack, type Kind, type Unit } from "./evidence";

export interface Sentence { text: string; evidence_ids: string[] }
export interface CheckedSentence extends Sentence { ok: boolean; errors: string[]; kind: Kind }
export interface Validation { ok: boolean; sentences: CheckedSentence[] }

const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(%|percent|per cent)$/i, "%"],
  [/^(min|mins|minute|minutes)$/i, "min"],
  [/^(cm|centimet(?:er|re)s?)$/i, "cm"],
  [/^(mm|millimet(?:er|re)s?)$/i, "mm"],
  [/^(km|kilomet(?:er|re)s?)$/i, "km"],
];
const NUMBER = /(-?\d+(?:\.\d+)?)(?:\s*(%|percent|per cent|minutes?|mins?|cm|centimet(?:er|re)s?|mm|millimet(?:er|re)s?|km|kilomet(?:er|re)s?)\b|\s*(%))?/gi;
const UNIT_BEARING: Unit[] = ["min", "cm", "mm", "km", "%"];

const has = (ids: string[], re: RegExp) => ids.some((id) => re.test(id));

// cause words → the evidence that has to be cited for them
const CAUSES: { words: RegExp; needs: (ids: string[], pack: EvidencePack) => boolean; what: string }[] = [
  { words: /\b(rain|rainfall|downpour|precipitation)\b/i, needs: (ids) => has(ids, /\.max_rainfall_24h_mm$/), what: "a rainfall value" },
  { words: /\b(water|flood\w*|waterlog\w*|inundat\w*|submerged)\b/i, needs: (ids) => has(ids, /\.max_water_depth_cm$/), what: "a water-depth value" },
  { words: /\b(congest\w*|traffic|volume)\b/i, needs: (ids) => has(ids, /\.mean_vc_ratio$/), what: "the volume-to-capacity ratio" },
  { words: /\b(closed|closure\w*|blocked|shut|passable|impassable)\b/i,
    needs: (ids, p) => has(ids, /\.(segments_closed|status)$/) || has(ids, /^bus\./) || ids.some((id) => p.items[id]?.kind === "model_output"),
    what: "a route status, closed-segment count or closure probability" },
  { words: /\b(cancel\w*|divert\w*|departures?|trips?)\b/i, needs: (ids) => has(ids, /^bus\./), what: "a bus-service value" },
  { words: /\b(storm|cyclon\w*|depression|cloudburst|monsoon|orographic)\b/i, needs: (ids) => ids.includes("scenario.name"), what: "the scenario" },
  { words: /\b(probabilit\w*|forecast\w*|likel\w*|chance)\b/i, needs: (ids, p) => ids.some((id) => p.items[id]?.kind === "model_output"), what: "a model output" },
  { words: /\b(best|recommend\w*|fastest|preferred|better)\b/i, needs: (ids) => has(ids, /\.recommended$/), what: "the best-performing flag" },
  { words: /\b(risk\w*)\b/i, needs: (ids) => has(ids, /\.risk_(score|band)$/), what: "the route-risk score or category" },
];
const UNSUPPORTED = /\b(landslides?|winds?|windy|gusts?|trees?|accidents?|crash\w*|collision\w*|construction|roadworks?|road works|protests?|strikes?|police|festivals?|breakdowns?|maintenance|potholes?)\b/i;
const OVERCLAIM = /\b(guarantee\w*|definitely|certainly|real-world|real world|real-time|real time|actual(?:ly)?|will|won't|wont)\b/i;

// a number word counting something ("two closed segments", "twenty-five min") can't be checked against the
// evidence, so it is rejected; "one of the routes" is a figure of speech and passes
const NUM_WORD = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen";
const COUNTED = "segments?|routes?|roads?|streets?|services?|departures?|trips?|buses|bus|closures?|hours?|h|days?|min|mins|minutes?|cm|mm|km|percent|per cent|centimet(?:er|re)s?|millimet(?:er|re)s?|kilomet(?:er|re)s?|kph";
const NUMBER_WORD = new RegExp(`\\b((?:${NUM_WORD})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUM_WORD}))*)\\b(?!\\s+of\\b)[\\s-]+(?:[a-z-]+\\s+){0,2}?(?:${COUNTED})\\b`, "i");
const ARITHMETIC = /\b(twice|double[ds]?|triple[ds]?|half|halved|thrice)\b/i;
const NEEDS_SIMULATED: Unit[] = ["min", "%"];

const ALL_OD_LABELS = ROUTES.od_pairs.map((o) => o.label);
const ALL_SCENARIO_NAMES = SCENARIOS.map((s) => s.name);

function unitOf(word: string | undefined): Unit | null {
  if (!word) return null;
  for (const [re, u] of UNIT_WORDS) if (re.test(word.trim())) return u;
  return null;
}

function sameNumber(text: string, e: Evidence) {
  return typeof e.value === "number" && (display(e) === text || Number(text) === e.value);
}

export function validateSentence(pack: EvidencePack, s: Sentence): CheckedSentence {
  const errors: string[] = [];
  const ids = Array.isArray(s.evidence_ids) ? s.evidence_ids.filter((x) => typeof x === "string") : [];
  const text = typeof s.text === "string" ? s.text : "";
  if (!text.trim()) errors.push("empty sentence");
  if (!ids.length) errors.push("cites no evidence");
  const unknown = ids.filter((id) => !pack.items[id]);
  if (unknown.length) errors.push(`cites unknown evidence: ${unknown.join(", ")}`);
  const cited = ids.map((id) => pack.items[id]).filter(Boolean);
  const citedEntities = new Set(cited.map((e) => e.entity).filter(Boolean));

  // ---- 2. entities; matched spans are removed so their digits aren't read as numbers
  let rest = text;
  const strip = (span: string) => { rest = rest.split(span).join(" "); };

  const routesNamed = [...new Set(text.match(/\bR\d{3}-A\d\b/g) ?? [])];
  for (const r of routesNamed) {
    if (!pack.routeIds.includes(r)) errors.push(`names ${r}, which is not a route for ${pack.od.label}`);
    else if (!citedEntities.has(r)) errors.push(`names ${r} but cites no evidence about it`);
    strip(r);
  }
  const busNamed = [...new Set(text.match(/\bTNSTC-\d+\b/g) ?? [])];
  for (const b of busNamed) {
    if (!pack.busIds.includes(b)) errors.push(`names ${b}, which does not run on this pair`);
    else if (!citedEntities.has(b)) errors.push(`names ${b} but cites no evidence about it`);
    strip(b);
  }
  for (const seg of text.match(/\bS\d{3}\b/g) ?? []) errors.push(`names segment ${seg}, which is not in the evidence`);

  for (const label of ALL_OD_LABELS) {
    if (!text.includes(label)) continue;
    if (label !== pack.od.label) errors.push(`names ${label}, but the evidence is about ${pack.od.label}`);
    strip(label);
  }
  for (const name of ALL_SCENARIO_NAMES) {
    if (!text.includes(name)) continue;
    if (name !== pack.scenarioName) errors.push(`names scenario "${name}", but the evidence is ${pack.scenarioName}`);
    else if (!ids.includes("scenario.name")) errors.push("names the scenario without citing scenario.name");
    strip(name);
  }
  if (text.includes(pack.timeLabel)) {
    if (!ids.includes("time.label")) errors.push("states the time without citing time.label");
    strip(pack.timeLabel);
  }
  const strayTime = rest.match(/\b\d{1,2}:\d{2}\b|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+\d{1,2}\s+\w+|\bhour\s+\d+\b|\b\d{1,2}\s+(?:Oct|Nov)\w*/i);
  if (strayTime) errors.push(`states a time ("${strayTime[0]}") that is not the assessment time ${pack.timeLabel}`);
  if (strayTime) strip(strayTime[0]);

  // fixed horizons that are part of a cited quantity's definition, not free numbers
  if (cited.some((e) => e.kind === "model_output")) rest = rest.replace(/\+?\s?3[- ]?(?:h|hours?)\b/gi, " ");
  if (ids.some((id) => id.endsWith(".max_rainfall_24h_mm"))) rest = rest.replace(/\b24[- ]?(?:h|hours?)\b/gi, " ");

  // ---- 3. numbers
  for (const m of rest.matchAll(NUMBER)) {
    const n = m[1];
    const unit = unitOf(m[2] ?? m[3]);
    const matches = cited.filter((e) => sameNumber(n, e));
    if (!matches.length) {
      const elsewhere = Object.values(pack.items).filter((e) => sameNumber(n, e));
      errors.push(elsewhere.length
        ? `${n} matches ${elsewhere[0].id}, which this sentence does not cite`
        : `${n} is not in the evidence`);
      continue;
    }
    const scoped = routesNamed.length || busNamed.length
      ? matches.filter((e) => !e.entity || routesNamed.includes(e.entity) || busNamed.includes(e.entity))
      : matches.filter((e) => !e.entity);
    if (!scoped.length) {
      const owner = matches[0].entity;
      errors.push(routesNamed.length || busNamed.length
        ? `${n} belongs to ${owner}, not to ${[...routesNamed, ...busNamed].join("/")}`
        : `${n} belongs to ${owner}, which the sentence does not name`);
      continue;
    }
    if (unit && !scoped.some((e) => e.unit === unit)) {
      errors.push(`${n} ${m[2] ?? m[3]} has the wrong unit; ${scoped[0].id} is in ${scoped[0].unit}`);
    } else if (!unit && scoped.every((e) => UNIT_BEARING.includes(e.unit))) {
      errors.push(`${n} is missing its unit (${scoped[0].unit})`);
    }
  }

  const w = text.match(NUMBER_WORD);
  if (w) errors.push(`"${w[1]}" is a number written as a word; write it in digits so it can be checked`);
  const a = text.match(ARITHMETIC);
  if (a) errors.push(`"${a[0]}" is arithmetic on the evidence, which can't be checked`);

  // ---- 4. causes
  for (const c of CAUSES) {
    const w = text.match(c.words);
    if (w && !c.needs(ids, pack)) errors.push(`mentions "${w[0]}" without citing ${c.what}`);
  }
  const u = text.match(UNSUPPORTED);
  if (u) errors.push(`"${u[0]}" is not a cause the evidence supports`);

  // ---- 5. certainty / real-world claims
  const o = text.match(OVERCLAIM);
  if (o) errors.push(`"${o[0]}" overclaims: this is a simulation`);
  if (cited.some((e) => NEEDS_SIMULATED.includes(e.unit) || e.kind === "model_output") && !/\bsimulat\w*/i.test(text)) {
    errors.push(`cites a minutes, % or model-output value, so it must say "simulated"`);
  }

  return { text, evidence_ids: ids, ok: errors.length === 0, errors, kind: sentenceKind(pack, ids) };
}

export function validate(pack: EvidencePack, sentences: Sentence[]): Validation {
  const checked = sentences.map((s) => validateSentence(pack, s));
  return { ok: checked.length > 0 && checked.every((c) => c.ok), sentences: checked };
}
