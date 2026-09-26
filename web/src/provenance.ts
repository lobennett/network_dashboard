import { element, details, type RecordRow } from './review';

type File = {id: string; path: string; content_id?: string};
export type Provenance = {
  artifact: File; artifacts: File[];
  links: {input: string; output: string; attempt: string; relation: string}[];
  attempts: RecordRow[]; truncated: boolean;
};
const purposes: Record<string, string> = {
  conversion: 'Convert source images to BIDS',
  defacing: 'Remove facial anatomy',
  trim_dummy: 'Trim BOLD volumes',
  events: 'Convert behavioral trials to BIDS events and align scan timing',
  freesurfer: 'Reconstruct cortical surfaces from reviewed anatomy',
  fmriprep: 'Preprocess BOLD using approved anatomy and surfaces',
};

export function provenanceTree(data: Provenance): HTMLElement {
  const root = element('section', '', 'provenance-tree');
  root.append(element('p', 'Output → recorded transformations → input files. Expand a file to inspect its ancestry.', 'muted'));
  const files = new Map(data.artifacts.map(f => [f.id, f]));
  files.set(data.artifact.id, data.artifact);
  let count = 0;
  function branch(id: string, visited: Set<string>): HTMLElement {
    const file = files.get(id);
    const block = element('details');
    block.open = visited.size < 3;
    block.append(element('summary', file?.path ?? 'File outside displayed tree'));
    if (visited.has(id) || ++count > 500) {
      block.append(element('p', 'Repeated reference or display limit reached.', 'muted'));
      return block;
    }
    const path = new Set([...visited, id]);
    if (file?.content_id) block.append(element('code', file.content_id));
    const parents = data.links.filter(l => l.output === id);
    if (!parents.length) block.append(element('p', data.truncated && !file
      ? 'Earlier history omitted by display limit' : 'Earlier history unrecorded', 'muted'));
    for (const key of new Set(parents.map(l => l.attempt))) {
      const group = parents.filter(l => l.attempt === key);
      const attempt = data.attempts.find(a => a.id === key);
      const stage = String(attempt?.stage ?? group[0].relation);
      const transform = element('div', '', 'provenance-transform');
      transform.append(element('strong', purposes[stage] ?? stage.replaceAll('_', ' ')));
      const software = attempt?.software;
      const label = software && typeof software === 'object'
        ? Object.entries(software).map(([k,v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v ?? 'version unrecorded'}`).join(' · ')
        : 'Software version unrecorded';
      transform.append(element('p', label, 'muted'));
      if (attempt?.parameters) transform.append(details(attempt.parameters as RecordRow));
      for (const link of group) {
        if (count >= 500) break;
        transform.append(branch(link.input, path));
      }
      block.append(transform);
    }
    return block;
  }
  root.append(branch(data.artifact.id, new Set()));
  if (data.truncated || count >= 500) root.append(element('p', 'Large history: showing a limited tree.', 'gap'));
  return root;
}

/** Show the selected version's recorded ancestors in dependency order. */
export function provenanceJourney(data: Provenance, inspect?: (id: string) => void): HTMLElement {
  const root = element('section', '', 'provenance-journey');
  root.append(element('p', 'Recorded changes, from inputs to the selected file. Separate inputs can converge on one step.', 'muted'));
  const files = new Map(data.artifacts.map(f => [f.id, f]));
  files.set(data.artifact.id, data.artifact);
  const incoming = new Map<string, Provenance['links']>();
  for (const link of data.links) incoming.set(link.output, [...(incoming.get(link.output) ?? []), link]);
  const visited = new Set<string>(), active = new Set<string>(), sources = new Set<string>();
  const order: string[] = [], grouped = new Map<string, Provenance['links']>();
  let cycle = false, limited = data.truncated;
  function visit(id: string, depth = 0) {
    if (active.has(id)) { cycle = true; return; }
    if (visited.has(id)) return;
    if (visited.size >= 500 || depth >= 100) { limited = true; return; }
    active.add(id); visited.add(id);
    const parents = incoming.get(id) ?? [];
    if (!parents.length) sources.add(id);
    for (const link of parents) visit(link.input, depth + 1);
    for (const link of parents) {
      if (!grouped.has(link.attempt)) { order.push(link.attempt); grouped.set(link.attempt, []); }
      grouped.get(link.attempt)!.push(link);
    }
    active.delete(id);
  }
  visit(data.artifact.id);
  function fileList(ids: Iterable<string>, label: string) {
    const list = element('div', '', 'history-files');
    list.append(element('span', label, 'muted'));
    for (const id of new Set(ids)) {
      const file = files.get(id), name = file?.path.split('/').pop() ?? 'File outside displayed history';
      const item = element('button', name, 'text-button');
      item.title = file?.path ?? id;
      item.disabled = !file || !inspect;
      if (inspect && file) item.onclick = () => inspect(id);
      list.append(item);
    }
    return list;
  }
  if (sources.size) {
    const source = element('div', '', 'history-source');
    source.append(fileList(sources, 'Earliest recorded inputs'));
    source.append(element('p', data.truncated && [...sources].some(id => !files.has(id))
      ? 'Earlier history omitted by display limit' : 'Earlier history unrecorded', 'muted'));
    root.append(source);
  }
  // An attempt can have several outputs; gather every dependency before ordering steps.
  const producers = new Map<string, Set<string>>();
  for (const [id, links] of grouped)
    for (const link of links) producers.set(link.output, new Set([...(producers.get(link.output) ?? []), id]));
  const ordered: string[] = [], done = new Set<string>(), visiting = new Set<string>();
  function orderAttempt(id: string) {
    if (visiting.has(id)) { cycle = true; return; }
    if (done.has(id)) return;
    visiting.add(id);
    for (const link of grouped.get(id) ?? [])
      for (const parent of producers.get(link.input) ?? []) if (parent !== id) orderAttempt(parent);
    visiting.delete(id); done.add(id); ordered.push(id);
  }
  for (const id of order) orderAttempt(id);
  const steps = element('ol', '', 'history-steps');
  for (const id of ordered) {
    const links = grouped.get(id)!, attempt = data.attempts.find(a => a.id === id);
    const stage = String(attempt?.stage ?? links[0].relation);
    const params = attempt?.parameters as RecordRow | undefined;
    const title = stage === 'conversion' && params?.pfile ? 'Reconstruct fieldmap from GE P-file'
      : stage === 'trim_dummy' ? 'Trim BOLD volumes' : purposes[stage] ?? stage.replaceAll('_', ' ');
    const step = element('li', '', 'history-step');
    step.append(element('h4', title));
    if (attempt?.status) step.append(element('span', String(attempt.status).replaceAll('_', ' '), 'badge'));
    if (stage === 'trim_dummy' && Number.isInteger(params?.discarded_volumes) && Number(params?.discarded_volumes) >= 0)
      step.append(element('p', `${params!.discarded_volumes} initial volumes removed.`, 'history-change'));
    step.append(fileList(links.map(l => l.input), 'Inputs'), fileList(links.map(l => l.output), 'Outputs'));
    const record = element('details');
    record.append(element('summary', 'Versions, parameters and file identities'));
    if (attempt) record.append(details(attempt));
    else record.append(element('p', 'Transformation details unrecorded.', 'muted'));
    for (const fileId of new Set(links.flatMap(l => [l.input,l.output]))) {
      const file = files.get(fileId);
      if (file) record.append(details(file));
    }
    step.append(record); steps.append(step);
  }
  root.append(steps);
  if (cycle) root.append(element('p', 'Cycle in recorded history; repeated references are shown once.', 'gap'));
  if (limited) root.append(element('p', 'Partial history: display limits omit some earlier records.', 'gap'));
  return root;
}
