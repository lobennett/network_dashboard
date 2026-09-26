// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { provenanceTree, provenanceJourney } from './provenance';

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

it('shows ancestor transformations in input-to-output order with technical details collapsed', () => {
  const artifacts=[{id:'source',path:'original.zip'},{id:'raw',path:'bold.nii.gz'}, {id:'trimmed',path:'bold.nii.gz'}];
  const history=provenanceJourney({artifact:artifacts[2],artifacts,
    links:[{input:'raw',output:'trimmed',attempt:'trim',relation:'trim_dummy'}, {input:'source',output:'raw',attempt:'convert',relation:'conversion'}],
    attempts:[{id:'trim',stage:'trim_dummy',parameters:{discarded_volumes:7},status:'success'}, {id:'convert',stage:'conversion',status:'success'}],truncated:false});
  expect(Array.from(history.querySelectorAll('.history-step h4')).map(n=>n.textContent)).toEqual(['Convert source images to BIDS','Trim BOLD volumes']);
  expect(history.textContent).toContain('Earlier history unrecorded');
  expect(history.querySelector('details')?.open).toBe(false);
  expect(history.textContent).toContain('7 initial volumes removed.');
});

it('renders shared ancestors once and bounds cyclic provenance', () => {
  const file={id:'a',path:'a.nii.gz'};
  const history=provenanceJourney({artifact:file,artifacts:[file,{id:'b',path:'b.nii.gz'}],
    links:[{input:'a',output:'b',attempt:'one',relation:'conversion'}, {input:'b',output:'a',attempt:'two',relation:'defacing'}],attempts:[],truncated:false});
  expect(history.querySelectorAll('.history-step')).toHaveLength(2);
  expect(history.textContent).toContain('Cycle');
});


it('orders shared multi-output transformations after all of their dependencies', () => {
  const artifacts=['a','b','c','x1','x2','z'].map(id=>({id,path:id}));
  const links=[['a','x1','X'],['c','b','Y'],['b','x2','X'],['x1','z','Z'],['x2','z','Z']]
    .map(([input,output,attempt])=>({input,output,attempt,relation:attempt}));
  const history=provenanceJourney({artifact:artifacts[5],artifacts,links,attempts:[],truncated:false});
  expect(Array.from(history.querySelectorAll('.history-step h4')).map(n=>n.textContent)).toEqual(['Y','X','Z']);
});


it('does not mistake intermediates within one transformation for a cycle', () => {
  const artifacts=['a','b','c'].map(id=>({id,path:id}));
  const history=provenanceJourney({artifact:artifacts[2],artifacts,
    links:[{input:'a',output:'b',attempt:'one',relation:'conversion'},{input:'b',output:'c',attempt:'one',relation:'conversion'}],attempts:[],truncated:false});
  expect(history.querySelectorAll('.history-step')).toHaveLength(1);
  expect(history.textContent).not.toContain('Cycle');
});
