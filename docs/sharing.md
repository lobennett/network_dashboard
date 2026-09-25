# Sharing

[Vercel](https://network-dashboard-devloganbennetts-projects.vercel.app) hosts the
interface and code-only Python wheel. Collaborators run the [setup command](../web/public/connect.html)
with uv and SSH; no Git, git-annex, or DataLad installation is required locally.
The service binds to localhost and permits only the configured HTTPS frontend.

`network-dashboard connect --ssh USER@HOST` uses the pilot at
`/oak/stanford/groups/russpold/data/network_grant/network-study-pilot-s03` and index at
`/oak/stanford/groups/russpold/data/network_grant/network-dashboard-cache/records.sqlite`.
Override these with `--study` and `--index`. Each SSH/study/index combination gets its own cache; matching legacy caches are reused.
`--cache` selects an explicit directory, which must match that connection.
Restart to refresh the snapshot. Missing files are fetched on click and checked
against indexed SHA256 or legacy git-annex MD5 checksums. A first MRIQC report may download its result ZIP.

DataLad provenance stays on Sherlock. Original DICOMs/P-files stay on Flywheel;
the index records their identities and conversion receipts. FreeSurfer **8.2.0**
precedes fMRIPrep **25.2.5**; the older anatomical campaign is marked legacy.

## Publish records

Rebuild from the current study, then copy the SQLite file to the shared index path:

```bash
network-fmri records build workflow.toml --output /path/to/records.sqlite
```

The Oak sibling must contain the registered file versions referenced by that
index. The index is a snapshot, not a live scheduler feed.

## Deploy

```bash
uv build --wheel
mkdir -p web/public/downloads
cp dist/network_dashboard-0.4.2-py3-none-any.whl web/public/downloads/
vercel --prod
```

Inspect the wheel before publishing. `.vercelignore` allowlists frontend code,
setup instructions, and this wheel. Never upload study data, indexes, credentials,
or licenses. Access to the website alone does not grant Oak access.
