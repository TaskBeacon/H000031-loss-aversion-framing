import {
  type StimBank,
  type TaskSettings,
  type TrialBuilder,
  type TrialSnapshot
} from "psyflow-web";

import { CHOICE_GAMBLE, CHOICE_SAFE, normalizeCondition, sampleOffer } from "./utils";

interface DecisionOutcome {
  responseKey: string;
  chosenOption: string;
  timedOut: boolean;
  rtS: number | null;
  choseGamble: boolean | null;
}

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTriggerCode(triggerMap: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(triggerMap[key]);
  return Number.isFinite(value) ? value : fallback;
}

function resolveDuration(value: unknown, fallback: number | number[]): number | number[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    if (value.length === 1) {
      const parsed = Number(value[0]);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    if (value.length >= 2) {
      const a = Number(value[0]);
      const b = Number(value[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        return [a, b];
      }
    }
  }
  return fallback;
}

function resolveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readDecisionOutcome(snapshot: TrialSnapshot, safeKey: string, gambleKey: string): DecisionOutcome {
  const responseKey = normalizeKey(snapshot.units.decision?.response);
  const timedOut = responseKey !== safeKey && responseKey !== gambleKey;
  if (timedOut) {
    return {
      responseKey: "",
      chosenOption: "",
      timedOut: true,
      rtS: asNumber(snapshot.units.decision?.rt ?? snapshot.units.decision?.response_time),
      choseGamble: null
    };
  }
  const choseGamble = responseKey === gambleKey;
  return {
    responseKey,
    chosenOption: choseGamble ? CHOICE_GAMBLE : CHOICE_SAFE,
    timedOut: false,
    rtS: asNumber(snapshot.units.decision?.rt ?? snapshot.units.decision?.response_time),
    choseGamble
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function run_trial(
  trial: TrialBuilder,
  condition: string,
  context: {
    settings: TaskSettings;
    stimBank: StimBank;
    block_id: string;
    block_idx: number;
  }
): TrialBuilder {
  const { settings, stimBank, block_id, block_idx } = context;
  const conditionName = normalizeCondition(condition);
  const trialId = Number(trial.trial_id);
  const resolvedTrialId = Number.isFinite(trialId) ? trialId : 0;
  const trialIndex = Number(trial.trial_index);
  const resolvedTrialIndex = Number.isFinite(trialIndex) ? trialIndex : 0;
  const blockTrialNumber = resolvedTrialIndex + 1;

  const triggerMap = (settings.triggers ?? {}) as Record<string, unknown>;
  const choiceSafeTrigger = getTriggerCode(triggerMap, "choice_safe", 31);
  const choiceGambleTrigger = getTriggerCode(triggerMap, "choice_gamble", 32);
  const choiceTimeoutTrigger = getTriggerCode(triggerMap, "choice_timeout", 33);

  const safeKey = String(settings.safe_key ?? "f").trim().toLowerCase();
  const gambleKey = String(settings.gamble_key ?? "j").trim().toLowerCase();
  const responseKeys = [safeKey, gambleKey];
  const choiceLabels = toRecord(settings.choice_labels);
  const safeLabel = String(choiceLabels[CHOICE_SAFE] ?? CHOICE_SAFE);
  const gambleLabel = String(choiceLabels[CHOICE_GAMBLE] ?? CHOICE_GAMBLE);
  const feedbackTemplate = String(settings.feedback_choice_template ?? "你选择了 {choice_label}");

  const offer = sampleOffer(settings, conditionName, block_idx, resolvedTrialId, resolvedTrialIndex);
  const fixationDuration = resolveDuration(settings.fixation_duration, 0.5);
  const decisionDeadline = resolveNumber(settings.decision_deadline, 4.0);
  const feedbackDuration = resolveNumber(settings.feedback_duration, 0.7);
  const itiDuration = resolveDuration(settings.iti_duration, 0.5);

  trial
    .unit("fixation")
    .addStim(stimBank.get("fixation"))
    .setContext({
      trial_id: trialId,
      phase: "fixation",
      deadline_s: fixationDuration,
      valid_keys: [],
      block_id,
      condition_id: conditionName,
      task_factors: {
        stage: "fixation",
        offer_id: offer.offer_id,
        block_idx,
        trial_id: trialId
      },
      stim_id: "fixation"
    })
    .show({ duration: fixationDuration })
    .to_dict();

  trial
    .unit("decision")
    .addStim(
      stimBank.get_and_format("frame_label", {
        frame_label: offer.frame_label
      })
    )
    .addStim(
      stimBank.get_and_format("scenario_text", {
        scenario_text: offer.scenario_text
      })
    )
    .addStim(
      stimBank.get_and_format("safe_option_text", {
        safe_option_text: offer.safe_text
      })
    )
    .addStim(
      stimBank.get_and_format("gamble_option_text", {
        gamble_option_text: offer.gamble_text
      })
    )
    .addStim(
      stimBank.get_and_format("key_hint", {
        safe_key: safeKey.toUpperCase(),
        gamble_key: gambleKey.toUpperCase()
      })
    )
    .setContext({
      trial_id: trialId,
      phase: "decision",
      deadline_s: decisionDeadline,
      valid_keys: responseKeys,
      block_id,
      condition_id: conditionName,
      task_factors: {
        stage: "decision",
        offer_id: offer.offer_id,
        safe_key: safeKey,
        gamble_key: gambleKey,
        block_idx,
        trial_id: trialId,
        block_trial_index: blockTrialNumber
      },
      stim_id: "frame_label+scenario_text+safe_option_text+gamble_option_text+key_hint"
    })
    .captureResponse({
      keys: responseKeys,
      correct_keys: responseKeys,
      duration: decisionDeadline,
      response_trigger: {
        [safeKey]: choiceSafeTrigger,
        [gambleKey]: choiceGambleTrigger
      },
      timeout_trigger: choiceTimeoutTrigger
    })
    .to_dict();

  trial
    .unit("feedback")
    .addStim((snapshot: TrialSnapshot) => {
      const outcome = readDecisionOutcome(snapshot, safeKey, gambleKey);
      if (outcome.timedOut) {
        return stimBank.get("feedback_timeout");
      }
      const choiceLabel = outcome.choseGamble ? gambleLabel : safeLabel;
      const chosenText = feedbackTemplate.replace("{choice_label}", choiceLabel);
      return stimBank.get_and_format("feedback_choice", {
        chosen_text: chosenText
      });
    })
    .setContext({
      trial_id: trialId,
      phase: "feedback",
      deadline_s: feedbackDuration,
      valid_keys: [],
      block_id,
      condition_id: conditionName,
      task_factors: {
        stage: "feedback",
        offer_id: offer.offer_id,
        block_idx,
        trial_id: trialId,
        block_trial_index: blockTrialNumber
      },
      stim_id: "feedback"
    })
    .show({ duration: feedbackDuration })
    .to_dict();

  trial
    .unit("iti")
    .addStim(stimBank.get("fixation"))
    .setContext({
      trial_id: trialId,
      phase: "iti",
      deadline_s: itiDuration,
      valid_keys: [],
      block_id,
      condition_id: conditionName,
      task_factors: {
        stage: "iti",
        block_idx,
        trial_id: trialId,
        block_trial_index: blockTrialNumber
      },
      stim_id: "fixation"
    })
    .show({ duration: itiDuration })
    .to_dict();

  trial.finalize((snapshot, _runtime, helpers) => {
    const outcome = readDecisionOutcome(snapshot, safeKey, gambleKey);
    helpers.setTrialState("condition", conditionName);
    helpers.setTrialState("offer_id", offer.offer_id);
    helpers.setTrialState("response_key", outcome.responseKey);
    helpers.setTrialState("chosen_option", outcome.chosenOption);
    helpers.setTrialState("timed_out", outcome.timedOut);
    helpers.setTrialState("rt_s", outcome.rtS);
    helpers.setTrialState("chose_gamble", outcome.choseGamble);
    helpers.setTrialState("safe_key", safeKey);
    helpers.setTrialState("gamble_key", gambleKey);
    helpers.setTrialState("frame_label", offer.frame_label);
    helpers.setTrialState("scenario_text", offer.scenario_text);
    helpers.setTrialState("safe_option_text", offer.safe_text);
    helpers.setTrialState("gamble_option_text", offer.gamble_text);
    helpers.setTrialState("ev_safe", offer.ev_safe);
    helpers.setTrialState("ev_gamble", offer.ev_gamble);
    helpers.setTrialState("endowment", offer.endowment);
    helpers.setTrialState("sure_amount", offer.sure_amount);
    helpers.setTrialState("gamble_gain", offer.gamble_gain);
    helpers.setTrialState("gamble_loss", offer.gamble_loss);
    helpers.setTrialState("gamble_gain_prob", offer.gamble_gain_prob);
  });

  return trial;
}
