export const COND_GAIN = "gain_frame";
export const COND_LOSS = "loss_frame";
export const COND_MIXED = "mixed_frame";

export const CHOICE_SAFE = "safe";
export const CHOICE_GAMBLE = "gamble";

interface Bucket {
  n: number;
  gamble: number;
  timeouts: number;
  rt_sum: number;
  rt_n: number;
}

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

function makeSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleArray<T>(values: T[], random: () => number): T {
  if (values.length === 0) {
    throw new Error("Cannot sample from empty array.");
  }
  const index = Math.floor(random() * values.length);
  return values[index] as T;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value: unknown, fallback: number): number {
  return Math.round(toNumber(value, fallback));
}

function toOfferList(value: unknown, fallback: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const clean = value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ ...(item as Record<string, unknown>) }));
  return clean.length > 0 ? clean : [...fallback];
}

function newBucket(): Bucket {
  return {
    n: 0,
    gamble: 0,
    timeouts: 0,
    rt_sum: 0,
    rt_n: 0
  };
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

function bucketMetrics(bucket: Bucket): {
  n: number;
  gamble: number;
  timeouts: number;
  responded_n: number;
  gamble_rate: number;
  timeout_rate: number;
  mean_rt_ms: number;
} {
  const n = Math.round(bucket.n);
  const gamble = Math.round(bucket.gamble);
  const timeouts = Math.round(bucket.timeouts);
  const responded = Math.max(0, n - timeouts);
  const gamble_rate = responded > 0 ? gamble / responded : 0;
  const timeout_rate = n > 0 ? timeouts / n : 0;
  const mean_rt_ms = bucket.rt_n > 0 ? (bucket.rt_sum / bucket.rt_n) * 1000 : 0;
  return {
    n,
    gamble,
    timeouts,
    responded_n: responded,
    gamble_rate,
    timeout_rate,
    mean_rt_ms
  };
}

export class Controller {
  readonly fixation_duration: number | number[];
  readonly decision_deadline: number;
  readonly feedback_duration: number;
  readonly iti_duration: number | number[];
  readonly enable_logging: boolean;
  readonly gain_trials: Array<Record<string, unknown>>;
  readonly loss_trials: Array<Record<string, unknown>>;
  readonly mixed_trials: Array<Record<string, unknown>>;
  readonly random_seed: number | null;
  block_idx: number;
  trial_count_total: number;
  trial_count_block: number;
  total_bucket: Bucket;
  block_bucket: Bucket;
  cond_total: Record<string, Bucket>;
  cond_block: Record<string, Bucket>;
  private readonly random: () => number;

  constructor(args: {
    fixation_duration?: number | number[];
    decision_deadline?: number;
    feedback_duration?: number;
    iti_duration?: number | number[];
    gain_trials?: unknown;
    loss_trials?: unknown;
    mixed_trials?: unknown;
    random_seed?: number | null;
    enable_logging?: boolean;
  }) {
    this.fixation_duration = args.fixation_duration ?? [0.4, 0.7];
    this.decision_deadline = Math.max(0.2, toNumber(args.decision_deadline, 4.0));
    this.feedback_duration = Math.max(0.1, toNumber(args.feedback_duration, 0.7));
    this.iti_duration = args.iti_duration ?? [0.4, 0.8];
    this.enable_logging = args.enable_logging !== false;
    this.gain_trials = toOfferList(args.gain_trials, this.defaultGainTrials());
    this.loss_trials = toOfferList(args.loss_trials, this.defaultLossTrials());
    this.mixed_trials = toOfferList(args.mixed_trials, this.defaultMixedTrials());
    this.random_seed =
      args.random_seed == null || Number.isNaN(Number(args.random_seed))
        ? null
        : toInt(args.random_seed, 0);
    this.random = makeSeededRandom(this.random_seed ?? Math.floor(Date.now() % 2147483647));

    this.block_idx = -1;
    this.trial_count_total = 0;
    this.trial_count_block = 0;
    this.total_bucket = newBucket();
    this.block_bucket = newBucket();
    this.cond_total = {
      [COND_GAIN]: newBucket(),
      [COND_LOSS]: newBucket(),
      [COND_MIXED]: newBucket()
    };
    this.cond_block = {
      [COND_GAIN]: newBucket(),
      [COND_LOSS]: newBucket(),
      [COND_MIXED]: newBucket()
    };
  }

  static from_dict(config: Record<string, unknown>): Controller {
    const cfg = config ?? {};
    return new Controller({
      fixation_duration: (cfg.fixation_duration as number | number[] | undefined) ?? [0.4, 0.7],
      decision_deadline: toNumber(cfg.decision_deadline, 4.0),
      feedback_duration: toNumber(cfg.feedback_duration, 0.7),
      iti_duration: (cfg.iti_duration as number | number[] | undefined) ?? [0.4, 0.8],
      gain_trials: cfg.gain_trials,
      loss_trials: cfg.loss_trials,
      mixed_trials: cfg.mixed_trials,
      random_seed: cfg.random_seed == null ? null : toInt(cfg.random_seed, 0),
      enable_logging: Boolean(cfg.enable_logging ?? true)
    });
  }

  private defaultGainTrials(): Array<Record<string, unknown>> {
    return [
      { offer_id: "gain_100_80", endowment: 100, sure_keep: 80, gamble_keep: 100, gamble_prob: 0.8 },
      { offer_id: "gain_100_60", endowment: 100, sure_keep: 60, gamble_keep: 100, gamble_prob: 0.6 },
      { offer_id: "gain_120_72", endowment: 120, sure_keep: 72, gamble_keep: 120, gamble_prob: 0.6 },
      { offer_id: "gain_150_105", endowment: 150, sure_keep: 105, gamble_keep: 150, gamble_prob: 0.7 }
    ];
  }

  private defaultLossTrials(): Array<Record<string, unknown>> {
    return [
      {
        offer_id: "loss_100_20",
        endowment: 100,
        sure_loss: 20,
        gamble_loss: 100,
        gamble_loss_prob: 0.2
      },
      {
        offer_id: "loss_100_40",
        endowment: 100,
        sure_loss: 40,
        gamble_loss: 100,
        gamble_loss_prob: 0.4
      },
      {
        offer_id: "loss_120_36",
        endowment: 120,
        sure_loss: 36,
        gamble_loss: 120,
        gamble_loss_prob: 0.3
      },
      {
        offer_id: "loss_150_45",
        endowment: 150,
        sure_loss: 45,
        gamble_loss: 150,
        gamble_loss_prob: 0.3
      }
    ];
  }

  private defaultMixedTrials(): Array<Record<string, unknown>> {
    return [
      { offer_id: "mixed_40_30", sure_amount: 0, gamble_gain: 40, gamble_loss: 30, gamble_gain_prob: 0.5 },
      { offer_id: "mixed_60_45", sure_amount: 0, gamble_gain: 60, gamble_loss: 45, gamble_gain_prob: 0.5 },
      { offer_id: "mixed_30_20", sure_amount: 0, gamble_gain: 30, gamble_loss: 20, gamble_gain_prob: 0.4 },
      { offer_id: "mixed_70_50", sure_amount: 10, gamble_gain: 70, gamble_loss: 50, gamble_gain_prob: 0.5 }
    ];
  }

  static parse_condition(condition: string): string {
    const token = String(condition ?? "")
      .trim()
      .toLowerCase();
    if (token === COND_GAIN || token === COND_LOSS || token === COND_MIXED) {
      return token;
    }
    throw new Error(`Unsupported framing condition: ${condition}`);
  }

  start_block(block_idx: number): void {
    this.block_idx = Math.trunc(block_idx);
    this.trial_count_block = 0;
    this.block_bucket = newBucket();
    this.cond_block = {
      [COND_GAIN]: newBucket(),
      [COND_LOSS]: newBucket(),
      [COND_MIXED]: newBucket()
    };
  }

  next_trial_id(): number {
    return this.trial_count_total + 1;
  }

  sample_duration(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, value);
    }
    if (Array.isArray(value) && value.length >= 2) {
      const a = toNumber(value[0], fallback);
      const b = toNumber(value[1], fallback);
      const lower = Math.min(a, b);
      const upper = Math.max(a, b);
      return Math.max(0, lower + (upper - lower) * this.random());
    }
    return Math.max(0, fallback);
  }

  sample_offer(condition: string): Offer {
    const cond = Controller.parse_condition(condition);
    if (cond === COND_GAIN) {
      const row = sampleArray(this.gain_trials, this.random);
      const endowment = toInt(row.endowment, 100);
      const sure_keep = toInt(row.sure_keep, 80);
      const gamble_keep = toInt(row.gamble_keep, endowment);
      const gamble_prob = clamp01(toNumber(row.gamble_prob, 0.8));
      const keep_pct = pctText(gamble_prob);
      const zero_pct = 100 - keep_pct;
      return {
        condition: COND_GAIN,
        offer_id: String(row.offer_id ?? `gain_${endowment}_${sure_keep}_${keep_pct}`),
        frame_label: "收益框架",
        scenario_text: `你获得 ${endowment} 元预算。请选择其一：`,
        safe_text: `方案A（确定）\n保留 ${sure_keep} 元`,
        gamble_text: `方案B（风险）\n${keep_pct}% 保留 ${gamble_keep} 元\n${zero_pct}% 保留 0 元`,
        ev_safe: sure_keep,
        ev_gamble: gamble_prob * gamble_keep,
        endowment,
        sure_amount: sure_keep,
        gamble_gain: gamble_keep,
        gamble_loss: 0,
        gamble_gain_prob: gamble_prob
      };
    }

    if (cond === COND_LOSS) {
      const row = sampleArray(this.loss_trials, this.random);
      const endowment = toInt(row.endowment, 100);
      const sure_loss = toInt(row.sure_loss, 20);
      const gamble_loss = toInt(row.gamble_loss, endowment);
      const gamble_loss_prob = clamp01(toNumber(row.gamble_loss_prob, 0.2));
      const no_loss_prob = 1 - gamble_loss_prob;
      const loss_pct = pctText(gamble_loss_prob);
      const keep_pct = pctText(no_loss_prob);
      return {
        condition: COND_LOSS,
        offer_id: String(row.offer_id ?? `loss_${endowment}_${sure_loss}_${loss_pct}`),
        frame_label: "损失框架",
        scenario_text: `你获得 ${endowment} 元预算。请选择其一：`,
        safe_text: `方案A（确定）\n损失 ${sure_loss} 元`,
        gamble_text: `方案B（风险）\n${keep_pct}% 损失 0 元\n${loss_pct}% 损失 ${gamble_loss} 元`,
        ev_safe: -sure_loss,
        ev_gamble: -gamble_loss_prob * gamble_loss,
        endowment,
        sure_amount: -sure_loss,
        gamble_gain: 0,
        gamble_loss,
        gamble_gain_prob: no_loss_prob
      };
    }

    const row = sampleArray(this.mixed_trials, this.random);
    const sure_amount = toNumber(row.sure_amount, 0);
    const gamble_gain = toNumber(row.gamble_gain, 40);
    const gamble_loss = toNumber(row.gamble_loss, 30);
    const gain_prob = clamp01(toNumber(row.gamble_gain_prob, 0.5));
    const loss_prob = 1 - gain_prob;
    const gain_pct = pctText(gain_prob);
    const loss_pct = pctText(loss_prob);
    return {
      condition: COND_MIXED,
      offer_id: String(
        row.offer_id ?? `mixed_${Math.round(gamble_gain)}_${Math.round(gamble_loss)}_${gain_pct}`
      ),
      frame_label: "混合框架",
      scenario_text: "请选择其一：",
      safe_text: `方案A（确定）\n${amountText(sure_amount)}`,
      gamble_text: `方案B（风险）\n${gain_pct}% 获得 ${Math.round(gamble_gain)} 元\n${loss_pct}% 损失 ${Math.round(gamble_loss)} 元`,
      ev_safe: sure_amount,
      ev_gamble: gain_prob * gamble_gain - loss_prob * gamble_loss,
      endowment: 0,
      sure_amount,
      gamble_gain,
      gamble_loss,
      gamble_gain_prob: gain_prob
    };
  }

  record_trial(args: {
    condition: string;
    chose_gamble: boolean | null;
    rt_s: number | null;
    timed_out: boolean;
  }): void {
    const cond = Controller.parse_condition(args.condition);
    this.trial_count_total += 1;
    this.trial_count_block += 1;

    for (const bucket of [
      this.total_bucket,
      this.block_bucket,
      this.cond_total[cond],
      this.cond_block[cond]
    ]) {
      bucket.n += 1;
      if (args.timed_out) {
        bucket.timeouts += 1;
      }
      if (args.chose_gamble === true) {
        bucket.gamble += 1;
      }
      if (!args.timed_out && args.rt_s != null && Number.isFinite(args.rt_s)) {
        const rt = Math.max(0, Number(args.rt_s));
        bucket.rt_sum += rt;
        bucket.rt_n += 1;
      }
    }

    if (this.enable_logging) {
      console.debug(
        [
          "[Framing]",
          `block=${this.block_idx}`,
          `trial_block=${this.trial_count_block}`,
          `trial_total=${this.trial_count_total}`,
          `condition=${cond}`,
          `chose_gamble=${args.chose_gamble}`,
          `timed_out=${args.timed_out}`,
          `rt=${args.rt_s}`
        ].join(" ")
      );
    }
  }

  total_metrics(): ReturnType<typeof bucketMetrics> {
    return bucketMetrics(this.total_bucket);
  }

  block_metrics(): ReturnType<typeof bucketMetrics> {
    return bucketMetrics(this.block_bucket);
  }

  condition_metrics(condition: string, args: { block_level?: boolean } = {}): ReturnType<typeof bucketMetrics> {
    const cond = Controller.parse_condition(condition);
    const bucket = args.block_level ? this.cond_block[cond] : this.cond_total[cond];
    return bucketMetrics(bucket);
  }
}

