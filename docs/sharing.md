# Sharing

[Vercel](https://network-dashboard-devloganbennetts-projects.vercel.app) serves the
interface and Python connector wheel. Study data stay on Oak. Collaborators need
uv, SSH and a Sherlock account with russpold Oak access; local DataLad is unnecessary.
The [connection page](https://network-dashboard-devloganbennetts-projects.vercel.app/connect.html)
generates their copyable command.

The connector authenticates with SSH/Duo, downloads the published records snapshot
and privacy receipts, then serves a read-only API on localhost. Images and reports
are fetched when opened and checked against their recorded checksums. Its attended
SSH connection closes when the terminal command stops. Restart the command to refresh
the records; reload the browser for a website update. These are separate operations.
An occupied port is reported before authentication or downloading.

Defaults:

- Study: `/oak/stanford/groups/russpold/data/network_grant/bids`
- Index: `/oak/stanford/groups/russpold/data/network_grant/network-dashboard-v1/records.sqlite`
- Cache: `~/.cache/network-dashboard/` (isolated by connection and study)

Override with `--study`, `--index` or `--cache`. Current files and exact historical
versions remain distinct; an unavailable version never silently loads a newer image.
Original DICOMs/P-files remain on Flywheel. Archived full fMRIPrep outputs are identified
in analysis exports; review images and reports are separately published for browsing.

## Publication

Use the pipeline's `study publish` command with its workflow configuration and
`--index` destination. It verifies the Oak revision, publishes content, audits
availability, and atomically replaces the index. Group read/traversal access must
include the index, dataset directories and annex objects. Do not make data public.
The snapshot timestamp is not a live scheduler feed.

## Website release

Build/test Python and the frontend, then deploy only `web/dist` with the connector
wheel in `downloads/`. Keep old wheels available for previously shared commands.
Publish the wheel's SHA256 with the connection command. Never include study data,
SQLite indexes, credentials or licenses in Git or Vercel.

The prebuilt deployment must retain the no-store entry-page headers and security
headers from `vercel.json`. Verify the deployed SUNet form and a real local connector
before sharing the URL.
