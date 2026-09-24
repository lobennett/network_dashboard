// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {get} from './api';

vi.mock('./api', () => ({get: vi.fn()}));
vi.mock('./viewer', () => ({viewFile: vi.fn()}));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function responses(lineage: (path: string) => Promise<unknown>) {
  vi.mocked(get).mockImplementation((path: string) => {
    if (path === 'metadata') return Promise.resolve({stale: false, built_at: new Date(Date.now() - 899_000).toISOString()});
    if (path === 'subjects') return Promise.resolve([{subject:'s03'}]);
    if (path.startsWith('subjects/')) return Promise.resolve({entities:[], attempts:[], decisions:[], findings:[]});
    if (path.startsWith('artifacts?q=')) return Promise.resolve([{id:'a',path:'a.json'}, {id:'b',path:'b.json'}]);
    return lineage(path);
  });
}

it('an obsolete file error cannot replace the newer selected file', async () => {
  let rejectOld!: (error: Error) => void;
  const old = new Promise((_, reject) => { rejectOld = reject; });
  responses(path => path.includes('/a/') ? old : Promise.resolve({
    artifact:{id:'b',path:'b.json'}, artifacts:[], links:[], attempts:[], ancestry:'unrecorded',
  }));
  await import('./main');
  await vi.waitFor(() => expect(document.querySelectorAll('.file-button')).toHaveLength(2));
  const buttons = document.querySelectorAll<HTMLButtonElement>('.file-button');
  buttons[0].click();
  buttons[1].click();
  await vi.waitFor(() => expect(document.querySelector('#file-detail h2')?.textContent).toBe('b.json'));
  rejectOld(new Error('old request failed'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.querySelector('#file-detail h2')?.textContent).toBe('b.json');
});

it('an open page marks an aging index as stale', async () => {
  vi.useFakeTimers();
  responses(() => Promise.reject(new Error('unexpected request')));
  await import('./main');
  await vi.waitFor(() => expect(document.getElementById('freshness')?.textContent).toContain('Index refreshed'));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(document.getElementById('freshness')?.textContent).toContain('Stale snapshot');
});
