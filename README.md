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
Surface acceptance criteria await the lab's review protocol.

This implementation is under development. Real-study acceptance on Sherlock is
pending. Keep study data and indexes off GitHub and public hosting.

Checks: `uv run pytest`, then `cd web && npm test && npm run build`.

The local pilot snapshot is in ignored `.local-data/`. It contains real `sub-s03`
review records and selected reports/images copied from Sherlock. Launch it with
`uv run network-dashboard --index .local-data/records.sqlite --study .local-data/study --web web/dist`.
The snapshot timestamp is shown in the header; reload after refreshing the index.
The Scans tab links session/task/run rows to their indexed files. This historical
pilot lacks conversion receipts, so its DICOM ancestry is explicitly unrecorded.
