# Sharing

Dashboard: <https://network-dashboard-devloganbennetts-projects.vercel.app>

Vercel hosts the interface only. Collaborators need Sherlock accounts and russpold
Oak access. Their browser connects to a localhost service backed by their own
SSH-authenticated DataLad clone. No study files, index, or SSH credentials go to
Vercel. The local service permits only the exact HTTPS origin passed with
`--allow-origin`; it is not a public API.

[Collaborator setup](../web/public/connect.html) is served at `/connect.html`.
Current Chrome supports this connection after granting local-network permission.
The default service port is 18782.

## Data

The current pilot lives at
`/oak/stanford/groups/russpold/data/network_grant/network-study-pilot-s03`.
Its derived index is shared within `oak_russpold` at
`/oak/stanford/groups/russpold/data/network_grant/network-dashboard-cache/records.sqlite`.
The index is a snapshot, rebuilt from receipts and decisions retained in DataLad.
After pipeline milestones, publish a refreshed index here; it is not yet a live
feed. The controller's normal index remains in its configured local cache.

A real 133 MB sub-s03 BOLD was fetched from Oak with DataLad and verified against
its indexed SHA256. Other files remain fetch-on-demand using DataLad or
`network-dashboard --index records.sqlite --study study --get-artifact ID`.
Subdatasets must be installed first; previews never fetch data automatically.

For behavioral subdatasets whose recorded sources are Oak-local paths, run inside
`sourcedata/raw` before installing them:

```bash
git config datalad.get.subdataset-source-candidate-050oak 'ssh://sherlock{url}'
datalad get -n sourcedata/behavioral/in_scanner sourcedata/behavioral/out_of_scanner
```

Original DICOMs stay in Flywheel. The dashboard retains source identifiers and
selection reasons. Recovered current inventory is distinguished from historical
conversion receipts. Planned processing is FreeSurfer **8.2.0**, then fMRIPrep
**25.2.5** using approved surfaces; existing pilot anatomy is a legacy campaign.

## Deploy

Build the code-only backend download before deploying:

```bash
uv build --wheel
mkdir -p web/public/downloads
cp dist/network_dashboard-0.1.0-py3-none-any.whl web/public/downloads/
vercel --prod
```

`vercel.json` builds the frontend for `http://127.0.0.1:18782`.
`.vercelignore` allowlists frontend sources, setup instructions, and the backend
wheel. Inspect the wheel before publishing; it must contain code only. Do not
upload `.local-data`, `.env`, licenses, or indexes. Vercel access to the empty
interface does not grant Oak access.
