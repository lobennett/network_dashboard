# Analysis handoff

The canonical 46-subject study is:

```text
/oak/stanford/groups/russpold/data/network_grant/bids
```

In **Analysis exports**, choose preprocessing, task first-level models, or time-series
analysis and download a TSV or JSON manifest. Optional subject/task filters narrow
it. Each row retains its selection, reasons, recorded decisions, input identities,
and dataset commits. Preprocessing exclusions apply to every downstream scope;
task-model exclusions do not automatically exclude time-series analysis.

- `candidate`: preprocessing retention is recorded and required inputs are indexed.
- `candidate_archived`: the same, with BOLD stored in a pinned fMRIPrep ZIP; extract
  the listed member before analysis. The archive checksum identifies that input.
- `inventory_pending`: this snapshot lacks the archive inventory; refresh after publication.
- `excluded`, `undecided`, `missing_inputs`, `not_applicable`: do not silently include
  these rows. Source acquisitions skipped before conversion are listed separately.

Candidates are not approval of a particular model. Pin the exported snapshot and
input commits. The per-subject provenance bundle includes software, checksums,
findings and file history.

**Do not trim again.** Seven volumes were removed upstream; canonical events already
use that time origin. Check matching BOLD, confound and design row counts. Retain
the model recipe, saved design, contrasts, software commit, space and smoothing
settings with each analysis. The dashboard previews recorded events/designs; it
does not fit models or replace their QA.
