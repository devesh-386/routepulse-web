import { describe, expect, it } from "vitest";
import { hourLabel } from "@/lib/bundle";
import { ASSESSMENTS, MANIFEST, ROUTES, SCENARIO_IDS, STORY } from "./data";
import { buildEvidence, display, type Audience, type EvidencePack } from "./evidence";
import { templateExplanation } from "./template";
import { validate, validateSentence, type Sentence } from "./validate";

const AUDIENCES: Audience[] = ["commuter", "bus_operator", "transport_planner"];

describe("templates", () => {
  it("pass the validator for every scenario, 3-hour step, OD pair and audience", () => {
    const failures: string[] = [];
    let n = 0;
    for (const sc of SCENARIO_IDS) {
      for (const hour of ASSESSMENTS[sc].hours) {
        for (const od of ROUTES.od_pairs) {
          for (const audience of AUDIENCES) {
            const pack = buildEvidence({ scenario: sc, hour, od: od.id, audience });
            const v = validate(pack, templateExplanation(pack));
            n++;
            if (!v.ok && failures.length < 5) {
              const bad = v.sentences.find((s) => !s.ok)!;
              failures.push(`${sc} h${hour} ${od.id} ${audience}: "${bad.text}" → ${bad.errors.join("; ")}`);
            }
          }
        }
      }
    }
    expect(n).toBe(5 * 112 * 20 * 3);
    expect(failures).toEqual([]);
  }, 120_000);  // 33,600 combinations; ~4 s alone, but 30 s+ when another job (e.g. model training) holds the CPU
});

// the story's switch: SC03, OD016, previously recommended route now blocked
const step = STORY.steps[2];
const pack: EvidencePack = buildEvidence({
  scenario: STORY.scenario as (typeof SCENARIO_IDS)[number], hour: step.hour, od: STORY.od_pair, audience: "commuter",
});
const OLD = step.previous_route!;   // blocked at this hour
const NEW = step.route;             // recommended
const d = (id: string) => display(pack.items[id]);
const check = (text: string, ...evidence_ids: string[]) => validateSentence(pack, { text, evidence_ids });
const errorsOf = (s: Sentence) => validateSentence(pack, s).errors.join(" | ");

describe("validator accepts grounded sentences", () => {
  it("a correctly cited LLM-style sentence", () => {
    const s = check(`${NEW} is the best-performing route in this scenario, with a simulated ETA of ${d(`route.${NEW}.eta_min`)} minutes.`,
                    `route.${NEW}.recommended`, `route.${NEW}.eta_min`);
    expect(s.errors).toEqual([]);
    expect(s.kind).toBe("derived");
  });
  it("labels a sentence citing a model output as model output", () => {
    const p = pack.items[`route.${OLD}.p_closed_3h_max_pct`].value;
    const s = check(`The model gives ${OLD} a ${p} % simulated probability of a closed segment at +3 h.`,
                    `route.${OLD}.p_closed_3h_max_pct`);
    expect(s.errors).toEqual([]);
    expect(s.kind).toBe("model_output");
  });
});

describe("validator rejects", () => {
  it("a wrong unit", () => {
    expect(errorsOf({ text: `${NEW} has a simulated ETA of ${d(`route.${NEW}.eta_min`)} cm.`,
                      evidence_ids: [`route.${NEW}.eta_min`] })).toMatch(/wrong unit/);
  });
  it("a missing unit on a measured value", () => {
    expect(errorsOf({ text: `${NEW} has a simulated ETA of ${d(`route.${NEW}.eta_min`)}.`,
                      evidence_ids: [`route.${NEW}.eta_min`] })).toMatch(/missing its unit/);
  });
  it("a mismatched hour", () => {
    const other = hourLabel(MANIFEST, pack.assessedHour + 24);
    expect(errorsOf({ text: `At ${other}, ${OLD} is blocked.`, evidence_ids: [`route.${OLD}.status`, "time.label"] }))
      .toMatch(/not the assessment time/);
  });
  it("the right number attached to the wrong route", () => {
    const depth = d(`route.${OLD}.max_water_depth_cm`);
    expect(errorsOf({ text: `${NEW} has standing water up to ${depth} cm.`,
                      evidence_ids: [`route.${NEW}.status`, `route.${OLD}.max_water_depth_cm`] }))
      .toMatch(new RegExp(`belongs to ${OLD}`));
  });
  it("a route that is not part of this pair", () => {
    const foreign = ROUTES.od_pairs.find((o) => o.id !== STORY.od_pair)!.routes[0];
    expect(errorsOf({ text: `${foreign} is passable.`, evidence_ids: [`route.${NEW}.status`] }))
      .toMatch(/not a route for/);
  });
  it("a segment the evidence does not contain", () => {
    expect(errorsOf({ text: `Segment S009 on ${OLD} is closed.`, evidence_ids: [`route.${OLD}.status`] }))
      .toMatch(/segment S009/);
  });
  it("another scenario's name", () => {
    expect(errorsOf({ text: "This happens in the Severe Cyclonic Storm Landfall scenario.", evidence_ids: ["scenario.name"] }))
      .toMatch(/but the evidence is/);
  });
  it("an unsupported cause", () => {
    expect(errorsOf({ text: `${OLD} is blocked because of an accident.`, evidence_ids: [`route.${OLD}.status`] }))
      .toMatch(/not a cause the evidence supports/);
  });
  it("a cause stated without its evidence", () => {
    expect(errorsOf({ text: `${NEW} is slow because of heavy rain.`, evidence_ids: [`route.${NEW}.eta_min`] }))
      .toMatch(/without citing a rainfall value/);
  });
  it("an uncited sentence", () => {
    expect(errorsOf({ text: `${NEW} is the better choice.`, evidence_ids: [] })).toMatch(/cites no evidence/);
  });
  it("an invented number", () => {
    expect(errorsOf({ text: `${NEW} takes 999.9 min.`, evidence_ids: [`route.${NEW}.eta_min`] }))
      .toMatch(/999.9 is not in the evidence/);
  });
  it("arithmetic on evidence values", () => {
    const sum = (pack.items[`route.${NEW}.eta_min`].value as number) + 10;
    expect(errorsOf({ text: `${NEW} takes ${sum} min including a stop.`, evidence_ids: [`route.${NEW}.eta_min`] }))
      .toMatch(/is not in the evidence/);
  });
  it("a number from evidence the sentence does not cite", () => {
    expect(errorsOf({ text: `${NEW} takes ${d(`route.${NEW}.eta_min`)} min.`, evidence_ids: [`route.${NEW}.status`] }))
      .toMatch(/does not cite/);
  });
  it("certainty and real-world claims", () => {
    expect(errorsOf({ text: `${NEW} will be passable, guaranteed.`, evidence_ids: [`route.${NEW}.status`] }))
      .toMatch(/overclaims/);
  });
  it("unknown evidence ids", () => {
    expect(errorsOf({ text: `${NEW} is passable.`, evidence_ids: ["route.R999-A9.status"] }))
      .toMatch(/unknown evidence/);
  });
  it("a whole answer when one sentence fails", () => {
    const good = templateExplanation(pack);
    const v = validate(pack, [...good, { text: `${NEW} takes 999.9 min.`, evidence_ids: [`route.${NEW}.eta_min`] }]);
    expect(v.ok).toBe(false);
    expect(v.sentences.filter((s) => !s.ok)).toHaveLength(1);
  });
});

// the brutal review (#1, #2): spelled-out numbers slipped past the number check, "simulated" was only a
// prompt request, and only "will be" was treated as certainty
describe("validator rejects number words, unlabelled simulated values and certainty", () => {
  const closed = pack.items[`route.${OLD}.segments_closed`].value as number;
  it("a count written as a word", () => {
    expect(errorsOf({ text: `${OLD} has two closed segments.`, evidence_ids: [`route.${OLD}.segments_closed`] }))
      .toMatch(/"two" is a number written as a word/);
  });
  it("a hyphenated number word with a unit", () => {
    expect(errorsOf({ text: `${NEW} has a simulated ETA of twenty-five min.`, evidence_ids: [`route.${NEW}.eta_min`] }))
      .toMatch(/"twenty-five" is a number written as a word/);
  });
  it("a number word joined to its unit by a hyphen", () => {
    expect(errorsOf({ text: `${NEW} has a ten-minute simulated delay.`, evidence_ids: [`route.${NEW}.delay_min`] }))
      .toMatch(/"ten" is a number written as a word/);
  });
  it("arithmetic words", () => {
    expect(errorsOf({ text: `${NEW} takes twice as long in this simulated storm.`, evidence_ids: [`route.${NEW}.eta_min`] }))
      .toMatch(/"twice" is arithmetic/);
  });
  it("a minutes value without the word simulated", () => {
    expect(errorsOf({ text: `${NEW} takes ${d(`route.${NEW}.eta_min`)} min.`, evidence_ids: [`route.${NEW}.eta_min`] }))
      .toMatch(/must say "simulated"/);
  });
  it("a model output without the word simulated", () => {
    const p = pack.items[`route.${OLD}.p_closed_3h_max_pct`].value;
    expect(errorsOf({ text: `The model gives ${OLD} a ${p} % probability of a closed segment at +3 h.`,
                      evidence_ids: [`route.${OLD}.p_closed_3h_max_pct`] }))
      .toMatch(/must say "simulated"/);
  });
  it("a bare will", () => {
    expect(errorsOf({ text: `${OLD} will flood.`, evidence_ids: [`route.${OLD}.max_water_depth_cm`] }))
      .toMatch(/"will" overclaims/);
  });
  it("won't", () => {
    expect(errorsOf({ text: `${OLD} won't reopen.`, evidence_ids: [`route.${OLD}.status`] }))
      .toMatch(/"won't" overclaims/);
  });
  it("but still accepts digits, figures of speech and depth without the word simulated", () => {
    expect(check(`${OLD} is one of the routes for this pair and has ${closed} closed ${closed === 1 ? "segment" : "segments"}.`,
                 `route.${OLD}.segments_closed`, "od.label").errors).toEqual([]);
    expect(check(`${OLD} has standing water up to ${d(`route.${OLD}.max_water_depth_cm`)} cm.`,
                 `route.${OLD}.max_water_depth_cm`).errors).toEqual([]);
  });
});
