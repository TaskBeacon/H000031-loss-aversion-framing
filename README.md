# H000031 Loss Aversion / Framing Task

HTML/browser preview aligned to local `T000031-loss-aversion-framing`.
The web task mirrors the Python block schedule, config-defined offer banks, timing, and feedback wording while staying browser-native.

## Layout

- `main.ts`: task orchestration, instruction screens, block countdowns, block breaks, and trial execution
- `config/config.yaml`: declarative preview config with `task.offer_banks`, timings, and participant text
- `src/run_trial.ts`: trial flow (`fixation -> decision -> feedback -> iti`)
- `src/utils.ts`: deterministic offer sampling plus block / overall summary helpers
- `.github/workflows/notify-psyflow-web.yml`: refresh dispatch for the shared `psyflow-web` runner on pushes to `main`

## Notes

- No task-local state manager is used on the web side.
- Offer content is sampled from `task.offer_banks` and summary metrics are derived from reduced rows.
- The browser preview keeps the same semantics as the Python task, with preview-profile timing/count differences only where configured.

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
