import {
  set_trial_context,
  type StimBank,
  type TaskSettings,
  type TrialBuilder,
  type TrialSnapshot
} from "psyflow-web";

import {
  CHOICE_GAMBLE,
  CHOICE_SAFE,
  Controller,
  type Offer
} from "./controller";

interface TrialOutcome {
  response_key: string;
  chosen_option: string;
  timed_out: boolean;
  rt_s: number | null;
  chose_gamble: boolean | null;
  feedback_text: string;
}

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getOutcome(snapshot: TrialSnapshot): TrialOutcome | null {
  const value = snapshot.units.trial_outcome?.outcome_payload;
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as TrialOutcome;
}

export function run_trial(
  trial: TrialBuilder,
  condition: string,
  context: {
    settings: TaskSettings;
    stimBank: StimBank;
    controller: Controller;
    block_id: string;
    block_idx: number;
  }
): TrialBuilder {
  const { settings, stimBank, controller, block_id, block_idx } = context;
  const conditionName = Controller.parse_condition(condition);
  const offer: Offer = controller.sample_offer(conditionName);
  const triggerMap = (settings.triggers ?? {}) as Record<string, unknown>;
  const safeKey = normalizeKey(settings.safe_key ?? "f");
  const gambleKey = normalizeKey(settings.gamble_key ?? "j");
  const responseKeys = [safeKey, gambleKey];
  const choiceLabels = toRecord(settings.choice_labels);
  const safeLabel = String(choiceLabels[CHOICE_SAFE] ?? CHOICE_SAFE);
  const gambleLabel = String(choiceLabels[CHOICE_GAMBLE] ?? CHOICE_GAMBLE);
  const feedbackTemplate = String(settings.feedback_choice_template ?? "你选择了 {choice_label}");

  const fixationDuration = controller.sample_duration(settings.fixation_duration, 0.5);
  const decisionDeadline = Math.max(0.2, Number(settings.decision_deadline ?? 4.0));
  const feedbackDuration = Math.max(0.1, Number(settings.feedback_duration ?? 0.7));
  const itiDuration = controller.sample_duration(settings.iti_duration, 0.5);

  const fixation = trial.unit("fixation").addStim(stimBank.get("fixation"));
  set_trial_context(fixation, {
    trial_id: trial.trial_id,
    phase: "fixation",
    deadline_s: fixationDuration,
    valid_keys: [],
    block_id,
    condition_id: conditionName,
    task_factors: {
      stage: "fixation",
      offer_id: offer.offer_id,
      block_idx
    },
    stim_id: "fixation"
  });
  fixation.show({ duration: fixationDuration }).to_dict();

  const decision = trial
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
    );
  set_trial_context(decision, {
    trial_id: trial.trial_id,
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
      block_idx
    },
    stim_id: "frame_label+scenario_text+safe_option_text+gamble_option_text+key_hint"
  });
  decision
    .captureResponse({
      keys: responseKeys,
      correct_keys: responseKeys,
      duration: decisionDeadline,
      response_trigger: {
        [safeKey]: Number(triggerMap.choice_safe ?? 31),
        [gambleKey]: Number(triggerMap.choice_gamble ?? 32)
      },
      timeout_trigger: Number(triggerMap.choice_timeout ?? 33)
    })
    .set_state({
      response_key: (snapshot: TrialSnapshot) => normalizeKey(snapshot.units.decision?.response),
      timed_out: (snapshot: TrialSnapshot) => {
        const key = normalizeKey(snapshot.units.decision?.response);
        return key !== safeKey && key !== gambleKey;
      },
      rt_s: (snapshot: TrialSnapshot) => {
        const rt = Number(snapshot.units.decision?.rt);
        return Number.isFinite(rt) ? rt : null;
      },
      chosen_option: (snapshot: TrialSnapshot) => {
        const key = normalizeKey(snapshot.units.decision?.response);
        if (key === safeKey) {
          return CHOICE_SAFE;
        }
        if (key === gambleKey) {
          return CHOICE_GAMBLE;
        }
        return "";
      },
      chose_gamble: (snapshot: TrialSnapshot) => {
        const key = normalizeKey(snapshot.units.decision?.response);
        if (key === safeKey) {
          return false;
        }
        if (key === gambleKey) {
          return true;
        }
        return null;
      }
    })
    .to_dict();

  const trialOutcome = trial.unit("trial_outcome");
  set_trial_context(trialOutcome, {
    trial_id: trial.trial_id,
    phase: "trial_outcome",
    deadline_s: 0,
    valid_keys: [],
    block_id,
    condition_id: conditionName,
    task_factors: {
      stage: "trial_outcome",
      offer_id: offer.offer_id,
      block_idx
    },
    stim_id: "trial_outcome"
  });
  trialOutcome
    .show({
      duration: 0
    })
    .set_state({
      outcome_payload: (snapshot: TrialSnapshot) => {
        const responseKey = normalizeKey(snapshot.units.decision?.response_key);
        const timedOut = responseKey !== safeKey && responseKey !== gambleKey;
        if (timedOut) {
          return {
            response_key: "",
            chosen_option: "",
            timed_out: true,
            rt_s: snapshot.units.decision?.rt_s as number | null,
            chose_gamble: null,
            feedback_text: ""
          } satisfies TrialOutcome;
        }
        const choseGamble = responseKey === gambleKey;
        const choiceLabel = choseGamble ? gambleLabel : safeLabel;
        return {
          response_key: responseKey,
          chosen_option: choseGamble ? CHOICE_GAMBLE : CHOICE_SAFE,
          timed_out: false,
          rt_s: snapshot.units.decision?.rt_s as number | null,
          chose_gamble: choseGamble,
          feedback_text: feedbackTemplate.replace("{choice_label}", choiceLabel)
        } satisfies TrialOutcome;
      }
    });

  const feedback = trial.unit("feedback").addStim((snapshot: TrialSnapshot) => {
    const outcome = getOutcome(snapshot);
    if (!outcome || outcome.timed_out) {
      return stimBank.get("feedback_timeout");
    }
    return stimBank.get_and_format("feedback_choice", {
      chosen_text: outcome.feedback_text
    });
  });
  set_trial_context(feedback, {
    trial_id: trial.trial_id,
    phase: "feedback",
    deadline_s: feedbackDuration,
    valid_keys: [],
    block_id,
    condition_id: conditionName,
    task_factors: {
      stage: "feedback",
      offer_id: offer.offer_id,
      block_idx
    },
    stim_id: "feedback"
  });
  feedback
    .show({ duration: feedbackDuration })
    .set_state({
      response_key: (snapshot: TrialSnapshot) => getOutcome(snapshot)?.response_key ?? "",
      chosen_option: (snapshot: TrialSnapshot) => getOutcome(snapshot)?.chosen_option ?? "",
      timed_out: (snapshot: TrialSnapshot) => getOutcome(snapshot)?.timed_out ?? true,
      rt_s: (snapshot: TrialSnapshot) => getOutcome(snapshot)?.rt_s ?? null,
      chose_gamble: (snapshot: TrialSnapshot) => getOutcome(snapshot)?.chose_gamble ?? null
    })
    .to_dict();

  const iti = trial.unit("iti").addStim(stimBank.get("fixation"));
  set_trial_context(iti, {
    trial_id: trial.trial_id,
    phase: "iti",
    deadline_s: itiDuration,
    valid_keys: [],
    block_id,
    condition_id: conditionName,
    task_factors: {
      stage: "iti",
      block_idx
    },
    stim_id: "fixation"
  });
  iti.show({ duration: itiDuration }).to_dict();

  trial.finalize((snapshot, _runtime, helpers) => {
    const outcome = getOutcome(snapshot);
    const choseGamble = outcome?.chose_gamble ?? null;
    const rtS = outcome?.rt_s ?? null;
    const timedOut = outcome?.timed_out ?? true;
    helpers.setTrialState("condition", conditionName);
    helpers.setTrialState("offer_id", offer.offer_id);
    helpers.setTrialState("response_key", outcome?.response_key ?? "");
    helpers.setTrialState("chosen_option", outcome?.chosen_option ?? "");
    helpers.setTrialState("timed_out", timedOut);
    helpers.setTrialState("rt_s", rtS);
    helpers.setTrialState("chose_gamble", choseGamble);
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

    controller.record_trial({
      condition: conditionName,
      chose_gamble: choseGamble,
      rt_s: rtS,
      timed_out: timedOut
    });
  });

  return trial;
}

