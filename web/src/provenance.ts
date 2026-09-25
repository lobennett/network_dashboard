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
  trim_dummy: 'Remove the first seven BOLD volumes',
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
