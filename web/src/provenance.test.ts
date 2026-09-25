// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { provenanceTree } from './provenance';

it('shows transformations, recorded versions, and missing history without inventing it', () => {
  const artifacts = [{id:'raw',path:'raw.csv'}, {id:'events',path:'events.tsv'}];
  const tree = provenanceTree({artifact:artifacts[1],artifacts,
    links:[{input:'raw',output:'events',attempt:'make',relation:'events'}],
    attempts:[{id:'make',stage:'events',software:{network_events:'0.2.0'}}],truncated:false});
  expect(tree.textContent).toContain('network_events: 0.2.0');
  expect(tree.textContent).toContain('raw.csv');
  expect(tree.textContent).toContain('Earlier history unrecorded');
  expect(tree.querySelectorAll('details')).toHaveLength(2);
});

it('distinguishes a truncated frontier from missing evidence', () => {
  const file = {id:'output',path:'output.nii.gz'};
  const tree = provenanceTree({artifact:file,artifacts:[file],
    links:[{input:'omitted',output:'output',attempt:'make',relation:'conversion'}],
    attempts:[],truncated:true});
  expect(tree.textContent).toContain('Earlier history omitted by display limit');
  expect(tree.textContent).not.toContain('Earlier history unrecorded');
});
