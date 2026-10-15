# network_dashboard

Read-only review of Network scans, decisions, and file provenance. Oak/DataLad
holds the canonical data; the dashboard uses a disposable local cache.

With uv, SSH, and a Sherlock account with russpold Oak access, use the
[connection page](https://network-dashboard-devloganbennetts-projects.vercel.app/connect.html)
to enter your SUNet ID and copy a personalized command. Alternatively:

```bash
uvx --python 3.12 --from https://network-dashboard-devloganbennetts-projects.vercel.app/downloads/network_dashboard-0.9.2-py3-none-any.whl network-dashboard connect --ssh YOUR_SUNET_ID@login.sherlock.stanford.edu --study /oak/stanford/groups/russpold/data/network_grant/bids --index /oak/stanford/groups/russpold/data/network_grant/network-dashboard-v1/records.sqlite
```

Complete authentication, leave the command running, and open the
[dashboard](https://network-dashboard-devloganbennetts-projects.vercel.app).
The command shows download progress and an estimated remaining time. Unchanged
snapshots and verified files reuse the cache. Images and reports download when
opened; restart the command to check for updated records.
No local DataLad installation is needed. See [setup](web/public/connect.html).

**Study** shows progress and data completeness. **Review data** opens current files;
**Processing history** selects a stage's recorded versions. Metrics, decisions and
file history stay beside the viewer. **Analysis exports** downloads scope-specific
scan manifests with exclusions, input identities and dataset commits.

For an existing local DataLad clone, use `network-dashboard --study PATH --index PATH`.
This local-only mode opens downloaded files; `connect --ssh` fetches uncached files from Oak.
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

Raw behavior is registered under `sourcedata/behavioral` before events are generated.
In **Review data**, select a scan, open **Events & design**, and choose a raw CSV or
events table to inspect or download. Raw CSV previews retain the original units.
The connector owns its SSH connection until you stop it; server-side disconnects
still require reconnecting and completing Duo.
