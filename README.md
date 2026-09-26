# network_dashboard

Read-only review of Network scans, decisions, and file provenance. Oak/DataLad
holds the canonical data; the dashboard uses a disposable local cache.

With uv, SSH, and a Sherlock account with russpold Oak access:

```bash
uvx --python 3.12 --from https://network-dashboard-devloganbennetts-projects.vercel.app/downloads/network_dashboard-0.6.1-py3-none-any.whl network-dashboard connect --ssh YOUR_SUNET_ID@login.sherlock.stanford.edu
```

Complete authentication, leave the command running, and open the
[dashboard](https://network-dashboard-devloganbennetts-projects.vercel.app).
Images and reports download when opened; restart the command to refresh records.
No local DataLad installation is needed. See [setup](web/public/connect.html).

Use **Review data** to inspect scans, surfaces and Flywheel selections.
Each subject has a preprocessing checklist with outstanding checks, evidence links
and a JSON download. Successful processing and manual approval stay separate.
**Data completeness** lists missing scan files, behavioral exceptions, per-run
behavior metrics and first-level inputs, with a downloadable inventory.
The **Pipeline guide** shows the source-to-fMRIPrep workflow and both approval gates;
it opens without a data connection.

NiiVue displays BOLD, fieldmap/magnitude images, and FreeSurfer volumes/surfaces.
Anatomy and surfaces require recorded defacing ancestry. Manual surface decisions
remain in the pipeline’s review file; the dashboard never approves scans.

For an existing local DataLad clone, use `network-dashboard --study PATH --index PATH`.
See [sharing](docs/sharing.md) for deployment and [analysis handoff](docs/analysis-handoff.md)
for timing, exclusions, downloadable manifests, and saved design previews.

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
