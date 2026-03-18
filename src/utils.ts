import type { ReducedTrialRow, TaskSettings } from "psyflow-web";

export const COND_GAIN = "gain_frame";
export const COND_LOSS = "loss_frame";
export const COND_MIXED = "mixed_frame";

export const CHOICE_SAFE = "safe";
export const CHOICE_GAMBLE = "gamble";

export interface Offer {
  condition: string;
  offer_id: string;
  frame_label: string;
  scenario_text: string;
  safe_text: string;
  gamble_text: string;
  ev_safe: number;
  ev_gamble: number;
  endowment: number;
  sure_amount: number;
  gamble_gain: number;
  gamble_loss: number;
  gamble_gain_prob: number;
}

type OfferRow = Record<string, unknown>;
type OfferBanks = Record<string, OfferRow[]>;
type FramingSettings = TaskSettings & {
  offer_banks?: OfferBanks;
  enable_logging?: unknown;
  block_seed?: Array<number | null>;
  overall_seed?: number;
  trials_per_block?: number;
  trial_per_block?: number;
};

export function normalizeCondition(condition: unknown): string {
  const token = String(condition ?? "")
    .trim()
    .toLowerCase();
  if (token === COND_GAIN || token === COND_LOSS || token === COND_MIXED) {
    return token;
  }
  throw new Error(`Unsupported framing condition: ${String(condition)}`);
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value: unknown, fallback: number): number {
  return Math.round(toNumber(value, fallback));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pctText(prob: number): number {
  return Math.round(clamp01(prob) * 100);
}

function amountText(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded >= 0) {
    return `获得 ${rounded} 元`;
  }
  return `损失 ${Math.abs(rounded)} 元`;
}

function hashSeed(...parts: unknown[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = `${part}|`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

function makeSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveOfferBanks(settings: FramingSettings): OfferBanks {
  const banks = settings.offer_banks;
  if (!banks || typeof banks !== "object" || Array.isArray(banks)) {
    throw new Error("task.offer_banks must be a mapping keyed by condition.");
  }

  const normalized: OfferBanks = {};
  for (const condition of [COND_GAIN, COND_LOSS, COND_MIXED]) {
    const value = banks[condition];
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`task.offer_banks must define a non-empty list for '${condition}'.`);
    }
    const cleaned = value
      .filter((item): item is OfferRow => !!item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({ ...item }));
    if (cleaned.length === 0) {
      throw new Error(`task.offer_banks['${condition}'] does not contain any offer objects.`);
    }
    normalized[condition] = cleaned;
  }
  return normalized;
}

function sampleOfferRow(
  settings: FramingSettings,
  condition: string,
  blockIdx: number,
  trialId: number,
  trialIndex: number
): OfferRow {
  const cond = normalizeCondition(condition);
  const banks = resolveOfferBanks(settings);
  const blockSeed =
    Array.isArray(settings.block_seed) && settings.block_seed[blockIdx] != null
      ? toNumber(settings.block_seed[blockIdx], NaN)
      : NaN;
  const baseSeed = Number.isFinite(blockSeed) ? blockSeed : toNumber(settings.overall_seed, 2025);
  const rng = makeSeededRandom(hashSeed(baseSeed, cond, blockIdx, trialIndex + 1, trialId));
  const bank = banks[cond];
  return { ...bank[Math.floor(rng() * bank.length)] };
}

export function sampleOffer(
  settings: TaskSettings,
  condition: string,
  blockIdx: number,
  trialId: number,
  trialIndex: number
): Offer {
  const typedSettings = settings as FramingSettings;
  const cond = normalizeCondition(condition);
  const row = sampleOfferRow(typedSettings, cond, blockIdx, trialId, trialIndex);

  let offer: Offer;
  if (cond === COND_GAIN) {
    const endowment = toInt(row.endowment, 100);
    const sureKeep = toInt(row.sure_keep, 80);
    const gambleKeep = toInt(row.gamble_keep, endowment);
    const gambleProb = clamp01(toNumber(row.gamble_prob, 0.8));
    const keepPct = pctText(gambleProb);
    const zeroPct = 100 - keepPct;
    offer = {
      condition: cond,
      offer_id: String(row.offer_id ?? `gain_${endowment}_${sureKeep}_${keepPct}`),
      frame_label: "收益框架",
      scenario_text: `你获得 ${endowment} 元预算。请选择其一：`,
      safe_text: `方案A（确定）\n保留 ${sureKeep} 元`,
      gamble_text: `方案B（风险）\n${keepPct}% 保留 ${gambleKeep} 元\n${zeroPct}% 保留 0 元`,
      ev_safe: sureKeep,
      ev_gamble: gambleProb * gambleKeep,
      endowment,
      sure_amount: sureKeep,
      gamble_gain: gambleKeep,
      gamble_loss: 0,
      gamble_gain_prob: gambleProb
    };
  } else if (cond === COND_LOSS) {
    const endowment = toInt(row.endowment, 100);
    const sureLoss = toInt(row.sure_loss, 20);
    const gambleLoss = toInt(row.gamble_loss, endowment);
    const gambleLossProb = clamp01(toNumber(row.gamble_loss_prob, 0.2));
    const noLossProb = 1 - gambleLossProb;
    const lossPct = pctText(gambleLossProb);
    const keepPct = pctText(noLossProb);
    offer = {
      condition: cond,
      offer_id: String(row.offer_id ?? `loss_${endowment}_${sureLoss}_${lossPct}`),
      frame_label: "损失框架",
      scenario_text: `你获得 ${endowment} 元预算。请选择其一：`,
      safe_text: `方案A（确定）\n损失 ${sureLoss} 元`,
      gamble_text: `方案B（风险）\n${keepPct}% 损失 0 元\n${lossPct}% 损失 ${gambleLoss} 元`,
      ev_safe: -sureLoss,
      ev_gamble: -gambleLossProb * gambleLoss,
      endowment,
      sure_amount: -sureLoss,
      gamble_gain: 0,
      gamble_loss: gambleLoss,
      gamble_gain_prob: noLossProb
    };
  } else {
    const sureAmount = toNumber(row.sure_amount, 0);
    const gambleGain = toNumber(row.gamble_gain, 40);
    const gambleLoss = toNumber(row.gamble_loss, 30);
    const gainProb = clamp01(toNumber(row.gamble_gain_prob, 0.5));
    const lossProb = 1 - gainProb;
    const gainPct = pctText(gainProb);
    const lossPct = pctText(lossProb);
    offer = {
      condition: cond,
      offer_id: String(row.offer_id ?? `mixed_${Math.round(gambleGain)}_${Math.round(gambleLoss)}_${gainPct}`),
      frame_label: "混合框架",
      scenario_text: "请选择其一：",
      safe_text: `方案A（确定）\n${amountText(sureAmount)}`,
      gamble_text: `方案B（风险）\n${gainPct}% 获得 ${Math.round(gambleGain)} 元\n${lossPct}% 损失 ${Math.round(gambleLoss)} 元`,
      ev_safe: sureAmount,
      ev_gamble: gainProb * gambleGain - lossProb * gambleLoss,
      endowment: 0,
      sure_amount: sureAmount,
      gamble_gain: gambleGain,
      gamble_loss: gambleLoss,
      gamble_gain_prob: gainProb
    };
  }

  if ((settings as FramingSettings).enable_logging !== false) {
    const trialNumber = trialIndex + 1;
    console.debug(
      [
        "[Framing]",
        `trial_id=${trialId}`,
        `block_idx=${blockIdx}`,
        `block_trial=${trialNumber}`,
        `condition=${cond}`,
        `offer_id=${offer.offer_id}`
      ].join(" ")
    );
  }

  return offer;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "y";
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value01: number): string {
  return `${(value01 * 100).toFixed(1)}%`;
}

function summarizeRows(rows: ReducedTrialRow[]): {
  gamble_rate: string;
  mean_rt_ms: string;
  timeout_count: number;
  total_trials: number;
} {
  if (rows.length === 0) {
    return {
      gamble_rate: "0.0%",
      mean_rt_ms: "0",
      timeout_count: 0,
      total_trials: 0
    };
  }

  const timeoutCount = rows.filter((row) => asBool(row.timed_out)).length;
  const responded = rows.filter((row) => !asBool(row.timed_out));
  const gambleCount = responded.filter((row) => asBool(row.chose_gamble)).length;
  const gambleRate = responded.length > 0 ? formatPercent(gambleCount / responded.length) : "0.0%";
  const rtValues = responded
    .map((row) => asNumber(row.rt_s))
    .filter((value): value is number => value != null);
  const meanRtMs = Math.round(mean(rtValues) * 1000).toString();

  return {
    gamble_rate: gambleRate,
    mean_rt_ms: meanRtMs,
    timeout_count: timeoutCount,
    total_trials: rows.length
  };
}

export function summarizeBlock(rows: ReducedTrialRow[], blockId: string): {
  gamble_rate: string;
  mean_rt_ms: string;
  timeout_count: number;
  total_trials: number;
} {
  const blockRows = rows.filter((row) => String(row.block_id ?? "") === blockId);
  return summarizeRows(blockRows);
}

export function summarizeOverall(rows: ReducedTrialRow[]): {
  gamble_rate: string;
  mean_rt_ms: string;
  timeout_count: number;
  total_trials: number;
} {
  return summarizeRows(rows);
}

function conditionRate(rows: ReducedTrialRow[], condition: string): string {
  const condRows = rows.filter(
    (row) => String(row.condition ?? "") === condition && !asBool(row.timed_out)
  );
  if (condRows.length === 0) {
    return "0.0%";
  }
  const gambleCount = condRows.filter((row) => asBool(row.chose_gamble)).length;
  return formatPercent(gambleCount / condRows.length);
}

export function summarizeConditionRates(rows: ReducedTrialRow[]): {
  gain_rate: string;
  loss_rate: string;
  mixed_rate: string;
} {
  return {
    gain_rate: conditionRate(rows, COND_GAIN),
    loss_rate: conditionRate(rows, COND_LOSS),
    mixed_rate: conditionRate(rows, COND_MIXED)
  };
}
