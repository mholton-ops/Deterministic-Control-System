# LLM Evaluation Package

This folder contains screenshots, API summaries, and review notes for evaluating the HALDN CONTROL deterministic control system against a requirements document such as ALIGN.

## How To Use

Upload these items to the evaluating LLM along with the document you want it to compare against:

- `documentation/LLM_EVALUATION_PROMPT.md`
- `documentation/ALIGN_ALIGNMENT_MATRIX.md`
- `documentation/SYSTEM_SUMMARY.md`
- `documentation/SCREENSHOT_INDEX.md`
- the `images/` folder
- optionally `data/api-snapshot-summary.json` for machine-readable counts and metrics

The screenshots were captured from the local app at http://127.0.0.1:3012. The API backing those screenshots was http://127.0.0.1:3011.

## Important Review Framing

This package is intended to help an LLM decide whether the app is aligned with a document, not whether it is production deployed. The data is deterministic demo/simulation data, but the UI is connected to real app routes and API projections.
