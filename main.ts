import {
  BlockUnit,
  StimBank,
  SubInfo,
  TaskSettings,
  TrialBuilder,
  count_down,
  mountTaskApp,
  next_trial_id,
  parsePsyflowConfig,
  reset_trial_counter,
  type CompiledTrial,
  type Resolvable,
  type RuntimeView,
  type StimRef,
  type StimSpec,
  type TrialSnapshot
} from "psyflow-web";

import configText from "./config/config.yaml?raw";
import { Controller } from "./src/controller";
import { run_trial } from "./src/run_trial";
import { summarizeBlock, summarizeConditionRates, summarizeOverall } from "./src/utils";

function buildWaitTrial(
  meta: { trial_id: string; condition: string; trial_index: number },
  blockId: string | null,
  unitLabel: string,
  stimInputs: Array<Resolvable<StimRef | StimSpec | null>>
): CompiledTrial {
  const trial = new TrialBuilder({
    trial_id: meta.trial_id,
    block_id: blockId,
    trial_index: meta.trial_index,
    condition: meta.condition
  });
  trial.unit(unitLabel).addStim(...stimInputs).waitAndContinue();
  return trial.build();
}

export async function run(root: HTMLElement): Promise<void> {
  const parsed = parsePsyflowConfig(configText, import.meta.url);
  const settings = TaskSettings.from_dict(parsed.task_config);
  const subInfo = new SubInfo(parsed.subform_config);
  const stimBank = new StimBank(parsed.stim_config);
  const controller = Controller.from_dict(parsed.controller_config);

  settings.triggers = parsed.trigger_config;
  settings.controller = parsed.controller_config;

  if (settings.voice_enabled) {
    stimBank.convert_to_voice("instruction_text", {
      voice: String(settings.voice_name ?? "zh-CN-YunyangNeural"),
      rate: 1
    });
  }

  await mountTaskApp({
    root,
    task_id: "H000031-loss-aversion-framing",
    task_name: "Loss Aversion / Framing Task",
    task_description:
      "HTML preview aligned to local psyflow Loss Aversion / Framing procedure and parameters.",
    settings,
    subInfo,
    stimBank,
    buildTrials: (): CompiledTrial[] => {
      reset_trial_counter();
      const compiledTrials: CompiledTrial[] = [];
      const totalBlocks = Math.max(1, Number(settings.total_blocks ?? 1));
      const trialPerBlock = Math.max(
        1,
        Number(settings.trial_per_block ?? settings.trials_per_block ?? 1)
      );

      const instructionInputs: Array<Resolvable<StimRef | StimSpec | null>> = [
        stimBank.get("instruction_text")
      ];
      if (settings.voice_enabled) {
        instructionInputs.push(stimBank.get("instruction_text_voice"));
      }
      compiledTrials.push(
        buildWaitTrial(
          { trial_id: "instruction", condition: "instruction", trial_index: -1 },
          null,
          "instruction_text",
          instructionInputs
        )
      );

      for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
        const blockId = `block_${blockIndex}`;
        controller.start_block(blockIndex);

        compiledTrials.push(
          ...count_down({
            seconds: 3,
            block_id: blockId,
            trial_id_prefix: `countdown_${blockId}`,
            stim: { color: "white", height: 3.5 }
          })
        );

        const block = new BlockUnit({
          block_id: blockId,
          block_idx: blockIndex,
          settings,
          n_trials: trialPerBlock
        }).generate_conditions();

        block.conditions.forEach((condition, trialIndex) => {
          const trial = new TrialBuilder({
            trial_id: next_trial_id(),
            block_id: blockId,
            trial_index: trialIndex,
            condition: String(condition)
          });
          run_trial(trial, String(condition), {
            settings,
            stimBank,
            controller,
            block_id: blockId,
            block_idx: blockIndex
          });
          compiledTrials.push(trial.build());
        });

        if (blockIndex < totalBlocks - 1) {
          compiledTrials.push(
            buildWaitTrial(
              {
                trial_id: `block_break_${blockIndex}`,
                condition: "block_break",
                trial_index: block.conditions.length + blockIndex
              },
              blockId,
              "block_break",
              [
                (_snapshot: TrialSnapshot, runtime: RuntimeView) => {
                  const summary = summarizeBlock(runtime.getReducedRows(), blockId);
                  return stimBank.get_and_format("block_break", {
                    block_num: blockIndex + 1,
                    total_blocks: totalBlocks,
                    block_gamble_rate: summary.gamble_rate,
                    mean_rt_ms: summary.mean_rt_ms,
                    timeout_count: summary.timeout_count
                  });
                }
              ]
            )
          );
        }
      }

      compiledTrials.push(
        buildWaitTrial(
          {
            trial_id: "goodbye",
            condition: "goodbye",
            trial_index: Number(settings.total_trials ?? 0)
          },
          null,
          "goodbye",
          [
            (_snapshot: TrialSnapshot, runtime: RuntimeView) => {
              const rows = runtime.getReducedRows();
              const overall = summarizeOverall(rows);
              const cond = summarizeConditionRates(rows);
              return stimBank.get_and_format("good_bye", {
                total_trials: overall.total_trials,
                overall_gamble_rate: overall.gamble_rate,
                mean_rt_ms: overall.mean_rt_ms,
                timeout_count: overall.timeout_count,
                gain_rate: cond.gain_rate,
                loss_rate: cond.loss_rate,
                mixed_rate: cond.mixed_rate
              });
            }
          ]
        )
      );

      return compiledTrials;
    }
  });
}

export async function main(root: HTMLElement): Promise<void> {
  await run(root);
}

export default main;

