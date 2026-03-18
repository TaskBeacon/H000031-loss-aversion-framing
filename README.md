# H000031 Loss Aversion / Framing Task

HTML/browser preview of Loss Aversion / Framing Task built with `psyflow-web`.
Trial structure, three-condition offer sampling, timeout handling, and framing-specific gamble-rate summaries are aligned to local `T000031-loss-aversion-framing`.

## Layout

- `main.ts`: task orchestration
- `config/config.yaml`: declarative config
- `src/controller.ts`: offer sampler and metrics controller
- `src/run_trial.ts`: trial logic
- `src/utils.ts`: block/overall summary helpers

## Run

From `e:\xhmhc\TaskBeacon\psyflow-web`:

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4173/?task=H000031-loss-aversion-framing
```

