# network_dashboard

Read-only review of Network scans, decisions, and file provenance. Oak/DataLad
holds the canonical data; the dashboard uses a disposable local cache.

With uv, SSH, and a Sherlock account with russpold Oak access:

```bash
uvx --python 3.12 --from https://network-dashboard-devloganbennetts-projects.vercel.app/downloads/network_dashboard-0.8.4-py3-none-any.whl network-dashboard connect --ssh YOUR_SUNET_ID@login.sherlock.stanford.edu --study /oak/stanford/groups/russpold/data/network_grant/bids --index /oak/stanford/groups/russpold/data/network_grant/network-dashboard-v1/records.sqlite
```

Complete authentication, leave the command running, and open the
[dashboard](https://network-dashboard-devloganbennetts-projects.vercel.app).
Images and reports download when opened; restart the command to refresh records.
No local DataLad installation is needed. See [setup](web/public/connect.html).

**Study progress** shows every configured subject and recorded stage, with missing
subjects marked “Not indexed.” It is a snapshot, not live Slurm status. **Exclusions**
separates Flywheel skips, preprocessing drops and task-model exclusions; download
the TSV for analysis handoff.

**Review data** shows exact stage evidence and current supporting receipts separately.
The events stage checks current behavior, event files and timing findings; B0 linkage
checks each echo’s sidecar against its session fieldmap on request. Trim volumes
shows pre/post reports and verified counts. Use **Current files** for the latest
inventory, **Data completeness** for missing files, and the **Pipeline guide** for
stage order. Images download when opened; restart the connector to refresh records.

For an existing local DataLad clone, use `network-dashboard --study PATH --index PATH`.
See [sharing](docs/sharing.md) for deployment and [analysis handoff](docs/analysis-handoff.md)
for timing, exclusions, downloadable manifests, and saved design previews.

## Architecture and reuse

See [architecture](docs/architecture.md) for the index schema, SSH connector, viewer,
and the parts to adapt for another study such as the Digital Brain Project.

## Development

```bash
uv sync --frozen
uv run pytest
npm ci --prefix web
npm test --prefix web
npm run build --prefix web
uv run network-dashboard --study /path/to/study --index /path/to/records.sqlite --web web/dist
```

Keep study data, indexes, credentials, and licenses out of Git and deployments.

FSQC metrics and anatomical/surface PNGs appear in the FreeSurfer stage after
the pipeline publishes its `fsqc-2.1.4` derivative. These support manual review;
metric outliers do not approve or exclude a subject.
