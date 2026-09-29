# Architecture and reuse

The dashboard has three parts:

1. **Pipeline index:** `network_fmri records build` reads committed DataLad datasets,
   processing receipts, file lineage, and review decisions into SQLite. DataLad
   remains the source of truth; SQLite is a disposable snapshot.
2. **Local connector:** `src/network_dashboard/` downloads that index over the
   user's SSH connection and exposes a localhost FastAPI service. Images and
   reports are fetched on demand and checked against their indexed checksums.
3. **Browser interface:** `web/src/` renders subjects, stages, decisions and file
   history. Niivue displays volumes and surfaces. Vercel hosts only this interface
   and the installable connector wheel, never study images or the index.

## Start reading

| Code | Purpose |
|---|---|
| `src/network_dashboard/records.py` | Read the SQLite model |
| `src/network_dashboard/api.py` | HTTP endpoints |
| `src/network_dashboard/remote.py` | SSH downloads, cache identity and integrity |
| `web/src/` | Stage navigation, evidence panels and viewers |
| `tests/` and `web/src/*.test.ts` | Backend and frontend tests |

The index producer lives in `network_fmri/src/network_fmri/records/` on its
`feat/mechababs-integration` branch. This repository consumes that schema; it does
not run MRIQC, FreeSurfer or fMRIPrep, and does not write review decisions back.

## Adapt to another study

Supply a study root and index with `--study` and `--index`; use `--origin` for a
separate frontend. Adapt the index producer to that study's receipts and decisions.
The frontend currently includes Network-specific stage names, task labels,
software descriptions and branding; these need changing for a different pipeline.
Do not assume that matching BIDS filenames establish provenance.

Use explicit stage input/output identities, package/container versions, and
separate preprocessing exclusions from analysis exclusions. Preserve manual
review attribution instead of treating numerical outliers as automatic failures.

## Data access and layout

Collaborators need uv, SSH, and an authorized Sherlock/Oak account. They do not
need local DataLad. A shared website URL alone does not grant access. The connector
is attended and local; there is no public image-serving endpoint on Sherlock.
Restart it to refresh the index snapshot.

The canonical study root is `/oak/stanford/groups/russpold/data/network_grant/bids`.
It uses the MechaBABS study layout: raw BIDS is `sourcedata/raw`, with versioned
processing outputs under `derivatives`. Pass the raw subdataset to BIDS tools.
The historical `network-study-v1` path is retained as a compatibility link.

CI runs Python tests, frontend tests, builds and a whitespace check. Do not commit
study indexes, image data, credentials, FreeSurfer licenses, or local caches.
