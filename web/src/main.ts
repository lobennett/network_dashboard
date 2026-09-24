import './styles.css';
import {get} from './api';
import {element, details, renderAttempts, renderDecisions, type RecordRow} from './review';
import {viewFile} from './viewer';
import {renderScans, scanPrefix} from './scans';

type Artifact = {id: string; path: string; content_id: string; dataset_id: string};
type Subject = {entities: RecordRow[]; attempts: RecordRow[]; findings: RecordRow[]; decisions: RecordRow[]};
type Lineage = {artifact: Artifact; artifacts: Artifact[]; links: {input:string;output:string;attempt:string;relation:string}[]; attempts: RecordRow[]; ancestry:string};

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<header><div><strong>Network</strong><span class="muted">Pipeline review</span></div><span id="freshness" role="status">Loading index…</span></header>
<div class="workspace"><aside><h2>Subjects</h2><nav id="subjects" aria-label="Subjects"></nav><p class="aside-note">Read-only review<br>DataLad is the source of record.</p></aside>
<main><div id="notice" role="alert"></div><section class="subject-heading"><div><p class="muted">Acquisition to derivatives</p><h1 id="subject-title">Select a subject</h1></div><span class="badge">Manual approval gates</span></section>
<nav class="tabs" aria-label="Review sections"><button data-tab="scans" aria-pressed="true">Scans</button><button data-tab="processing">Processing</button><button data-tab="files">Files & lineage</button><button data-tab="reviews">Decisions & findings</button></nav>
<section id="scans" class="tab-panel"><h2>Scans</h2><p class="muted">DICOM source → BIDS → MRIQC → surface review → fMRIPrep. Select a scan to inspect its files and recorded history. Missing links remain unrecorded.</p><div id="scan-list"></div></section>
<section id="processing" class="tab-panel" hidden><h2>Processing attempts</h2><p class="muted">Open a stage for recorded job details. Job completion does not imply review approval.</p><div id="attempts"></div></section>
<section id="files" class="tab-panel" hidden><label for="search">Find a file</label><form id="search-form"><input id="search" placeholder="Subject, session, task or filename"><button>Search</button></form><div class="file-layout"><div id="file-list"></div><article id="file-detail"><p class="empty">Select a file to trace its recorded inputs and outputs.</p></article></div></section>
<section id="reviews" class="tab-panel" hidden><h2>Review decisions</h2><div id="decisions"></div><h2>Metrics & findings</h2><div id="findings"></div></section></main></div>`;

const find = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const notice = (message: string) => { find('notice').textContent = message; };
let selected = '';
let selectionRequest = 0;
let fileRequest = 0;
let detailRequest = 0;
let viewer: Awaited<ReturnType<typeof viewFile>> | undefined;

document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    document.querySelectorAll<HTMLElement>('.tab-panel').forEach(p => { p.hidden = p.id !== button.dataset.tab; });
    if (button.dataset.tab === 'files') void searchFiles();
  };
});

async function chooseSubject(subject: string) {
  const request = ++selectionRequest;
  selected = subject;
  fileRequest++;
  find('file-list').replaceChildren();
  detailRequest++;
  viewer?.cleanup();
  viewer = undefined;
  find("file-detail").replaceChildren(element("p", "Select a file to trace its history.", "empty"));
  find('subject-title').textContent = `sub-${subject}`;
  find<HTMLInputElement>('search').value = `sub-${subject}`;
  for (const id of ['attempts', 'decisions', 'findings', 'scan-list']) find(id).replaceChildren(element('p', 'Loading…'));
  document.querySelectorAll<HTMLButtonElement>('#subjects button').forEach(b => b.setAttribute('aria-current', String(b.dataset.subject === subject)));
  try {
    const value = await get<Subject>(`subjects/${encodeURIComponent(subject)}`);
    if (request !== selectionRequest) return;
    find('scan-list').replaceChildren(renderScans(value, scan => {
      find<HTMLInputElement>('search').value = scanPrefix(scan);
      document.querySelector<HTMLButtonElement>('[data-tab="files"]')!.click();
    }));
    find('attempts').replaceChildren(renderAttempts(value.attempts));
    find('decisions').replaceChildren(renderDecisions(value.decisions));
    find('findings').replaceChildren(...value.findings.map(f => {
      const item = element('details', '', 'finding');
      item.append(element('summary', String(f.finding_type)), details(f));
      return item;
    }));
    if (!value.findings.length) find('findings').append(element('p', 'No findings recorded.', 'empty'));
    notice('');
    await searchFiles();
  } catch (error) { if (request === selectionRequest) notice(String(error)); }
}

async function searchFiles() {
  const request = ++fileRequest;
  try {
    const results = await get<Artifact[]>(`artifacts?q=${encodeURIComponent(find<HTMLInputElement>('search').value)}`);
    if (request !== fileRequest) return;
    find('file-list').replaceChildren(element('p', `${results.length} files shown · up to 200 per search`, 'muted'));
    for (const file of results) {
      const button = element('button', file.path, 'file-button');
      button.onclick = () => void showFile(file.id);
      find('file-list').append(button);
    }
    if (!results.length) find('file-list').append(element('p', 'No indexed files match. Refresh the index or broaden your search.', 'empty'));
  } catch (error) { notice(String(error)); }
}

async function showFile(identity: string) {
  const request = ++detailRequest;
  viewer?.cleanup();
  viewer = undefined;
  const panel = find('file-detail');
  panel.replaceChildren(element('p', 'Loading file history…'));
  try {
    const value = await get<Lineage>(`artifacts/${encodeURIComponent(identity)}/lineage`);
    if (request !== detailRequest) return;
    panel.replaceChildren(element('h2', value.artifact.path.split('/').pop()!), details(value.artifact));
    if (value.ancestry === 'unrecorded') panel.append(element('p', 'Earlier processing history is unrecorded for this version.', 'gap'));
    for (const direction of ['Inputs', 'Outputs'] as const) {
      panel.append(element('h3', direction));
      const links = value.links.filter(link => direction === 'Inputs' ? link.output === identity : link.input === identity);
      if (!links.length) panel.append(element('p', 'No links recorded.', 'muted'));
      for (const link of links) {
        const id = direction === 'Inputs' ? link.input : link.output;
        const related = value.artifacts.find(a => a.id === id)!;
        const button = element('button', `${link.relation} → ${related.path}`, 'file-button');
        button.onclick = () => void showFile(id);
        panel.append(button);
      }
    }
    for (const attempt of value.attempts) {
      const block = element('details');
      block.append(element('summary', `Processing details · ${attempt.stage}`), details(attempt));
      panel.append(block);
    }
    const path = value.artifact.path;
    const preview = element('button', /\.(nii(\.gz)?|mgz|white|pial|inflated|gii)$/.test(path) ? 'Load image / surface' : 'Open recorded file', 'primary');
    panel.append(preview);
    preview.onclick = async () => {
      try {
        if (/\.(nii(\.gz)?|mgz|white|pial|inflated|gii)$/.test(path)) {
          viewer?.cleanup();
          const canvas = element('canvas', '', 'viewer');
          canvas.setAttribute('aria-label', 'Image and surface viewer');
          const frame = element('div', '', 'viewer-frame');
          frame.append(canvas);
          panel.querySelector('.viewer-frame')?.remove();
          panel.append(frame);
          const loaded = await viewFile(canvas, identity, path);
          if (request !== detailRequest) loaded.cleanup(); else viewer = loaded;
        } else {
          window.open(`/api/artifacts/${encodeURIComponent(identity)}/content`, '_blank', 'noopener,noreferrer');
        }
      } catch (error) { notice(String(error)); }
    };
  } catch (error) { if (request === detailRequest) panel.replaceChildren(element('p', String(error), 'gap')); }
}

find('search-form').onsubmit = event => { event.preventDefault(); void searchFiles(); };
async function start() {
  try {
    const [metadata, subjects] = await Promise.all([get<RecordRow>('metadata'), get<{subject:string}[]>('subjects')]);
    const updateFreshness = () => {
      const built = Date.parse(String(metadata.built_at ?? ''));
      const stale = metadata.stale || !Number.isFinite(built) || Date.now() - built > 900_000;
      find('freshness').textContent = `${metadata.data_mode === 'synthetic' ? 'Synthetic test data · ' : ''}${stale ? 'Stale snapshot' : 'Index refreshed'} · ${metadata.built_at ?? 'time unknown'}`;
      find('freshness').className = stale ? 'gap' : 'muted';
    };
    updateFreshness();
    if (metadata.conversion_links === 0) {
      find('scans').prepend(element('p', 'DICOM-to-BIDS file links were not recorded for this snapshot. Existing reports and decisions are real; full source tracing requires conversion receipts from a new run.', 'gap'));
    }
    window.setInterval(updateFreshness, 60_000);
    for (const {subject} of subjects) {
      const button = element('button', `sub-${subject}`);
      button.dataset.subject = subject;
      button.onclick = () => void chooseSubject(subject);
      find('subjects').append(button);
    }
    if (subjects.length) await chooseSubject(subjects[0].subject);
    else notice('No subjects indexed. Build records from the canonical study first.');
  } catch (error) { notice(`Cannot load the study: ${error}`); find('freshness').textContent = 'Index unavailable'; }
}
void start();
