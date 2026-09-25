# Analysis handoff

The current Oak dataset is a **sub-s03 pilot**, not the final 46-subject release:

```text
/oak/stanford/groups/russpold/data/network_grant/network-study-pilot-s03
```

Use the dashboard's **Scan manifest (TSV)** for run-level decisions and **Provenance bundle (JSON)** for dataset commits, file checksums, availability, and recorded processing software. These are snapshots; pin the study and subdataset commits when starting an analysis. An indexed file may be historical or unavailable. Absence of an exclusion is not analysis approval.

## Timing and exclusions

- The canonical BOLD data have the first seven volumes removed upstream. Canonical events use the trimmed scan's time origin. fMRIPrep is configured with `--dummy-scans 0`.
- Consumers must **not trim BOLD or confounds again or shift canonical event onsets again**. Check the per-run TR, volume-discard sidecar, and equal BOLD/confound/design row counts.
- Retention for fMRIPrep and exclusion from task models are separate decisions. The ses-11 `stopSignalWDirectedForgetting` run-1 is retained for preprocessing but excluded from task first-level models because of its timing failure. Retention does not certify suitability for every time-series method.
- For s03/ses-01/goNogo/run-1, the canonical events contain **four go omissions**: `trial_id == test_trial`, `trial_type == go`, `key_press == -1`. LB confirmed this on 2026-09-25. The older saved matrix has not been located, so its discrepancy remains unexplained. Count trials, not nonzero samples in an HRF-convolved regressor.

## Jeanette's analysis package

[Jeanette's package](https://github.com/jmumford/network-fmri) builds designs and loads surface data. For the finalized canonical dataset, its existing `data_is_trimmed=True` path should consume the outputs without further trimming or onset shifts. Verify that path against the first completed fMRIPrep CIFTI and confounds before declaring compatibility. Its legacy untrimmed-data behavior still serves older datasets.

Both Jeanette's package and the pipeline orchestrator use the Python name `network_fmri`. Install them in **separate uv environments**, and identify the repository and commit in analysis records.

Each analysis should save its actual design matrix (a CSV/TSV named with `design_matrix`, `designMatrix`, or `design-matrix`), model specification, contrasts, package commit, input dataset commits, surface space/density, and confound choices. The dashboard can preview indexed saved matrices; it does not generate a second implementation of the model. Register new analysis outputs in the study and rebuild the records index to expose them.

Before the full-sample release, verify surface/BOLD/confound alignment and TRs, publish the final scan manifest and canonical Oak location, and tag the DataLad dataset. Do not silently replace the legacy datasets collaborators currently use.

## Code snapshot (2026-09-25)

These are the checked local revisions used during the pilot; feature branches have not all been merged into `main`.

| Repository | Branch | Commit |
| --- | --- | --- |
| lobennett/network_fmri | feat/mechababs-integration | 87515ad |
| lobennett/network_fw2bids | feat/file-provenance | 1e86429 |
| lobennett/network_events | feat/file-provenance | 9e6690d |
| lobennett/network_qa | main | ccafd79 |
| lobennett/network_glm | main | a61c8d4 |
| jmumford/network-fmri (inspected) | — | c25cd9fa08f6137596fa031b681d652eea6b106b |

The dashboard currently lives on the local `feat/dashboard` branch with no GitHub remote. The processing records describe software actually recorded for each transformation; this table identifies source checkouts, not proof that every historical output used them.
