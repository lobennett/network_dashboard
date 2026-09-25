# network_dashboard

Local, read-only review of Network processing, file provenance, and scan decisions.
DataLad remains the source of record; SQLite is a disposable index.

```bash
uv sync --frozen
cd web && npm ci && npm run build && cd ..
uv run network-dashboard --study /path/to/study \
  --index /path/to/records.sqlite --web web/dist
```

Open <http://127.0.0.1:18782>. For Sherlock, run the server there and forward
the port with `ssh -L 18782:127.0.0.1:18782 sherlock`.

`network-fmri processing run config.toml` refreshes the index at
`<study-parent>/.network-fmri-cache/<study-name>/records.sqlite`. To rebuild manually:

```bash
network-fmri records build config.toml --output /path/to/records.sqlite
```

The interface separates preprocessing decisions from analysis exclusions and
surface approvals. NiiVue opens registered images with verified content hashes;
anatomical previews require defacing evidence. Missing annex content must be
retrieved by the operator with DataLad. Older files may have unrecorded ancestry.
Surface review uses ITK-SNAP ribbon overlays and Freeview white/pial mesh checks.
Corrections require reconstruction, repeat inspection, and a new content-bound approval.

This implementation is under development. Keep study data and indexes off GitHub
and public hosting.

Checks: `uv run pytest`, then `cd web && npm test && npm run build`.

The local pilot snapshot is in ignored `.local-data/`. It contains real `sub-s03`
review records and selected reports/images copied from Sherlock. Launch it with
`uv run network-dashboard --index .local-data/records.sqlite --study .local-data/study --web web/dist`.
The snapshot timestamp is shown in the header; reload after refreshing the index.
Select a pipeline stage, then a scan. **View in NiiVue** opens available images;
**Open MRIQC report** opens its report. Filter scans by review status or analysis
exclusion. **Files & provenance** contains sidecars and recorded file history.
The Flywheel stage includes a recovered current acquisition inventory; it is
distinct from historical conversion evidence. New conversions save their selection
receipts automatically. Planned versions are FreeSurfer 8.2.0 and fMRIPrep 25.2.5.

See [sharing and DataLad access](docs/sharing.md) for Oak retrieval and Vercel setup.
