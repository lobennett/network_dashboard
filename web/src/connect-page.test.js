import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {describe,it,expect} from 'vitest';
const html=readFileSync(new URL('../public/connect.html',import.meta.url),'utf8');
function setup(){return new JSDOM(html,{url:'https://dashboard.example/connect.html',runScripts:'dangerously'});}
describe('personalized connection command',()=>{
 it('disables copying until a valid SUNet ID is entered',()=>{
  const dom=setup(),doc=dom.window.document;
  const input=doc.querySelector('#sunet'),button=doc.querySelector('#copy-launch');
  expect(button.disabled).toBe(true);
  input.value='pbissett';input.dispatchEvent(new dom.window.Event('input'));
  expect(button.disabled).toBe(false);
  expect(doc.querySelector('#launch').textContent).toContain('--ssh pbissett@login.sherlock.stanford.edu');
  expect(doc.querySelector('#launch').textContent).toContain('https://dashboard.example/downloads/');
  expect(doc.querySelector('#launch').textContent).not.toContain('YOUR_SUNET_ID');
  expect(dom.window.localStorage.getItem('network-sunet')).toBe('pbissett');
  input.value='name; echo wrong';input.dispatchEvent(new dom.window.Event('input'));
  expect(button.disabled).toBe(true);
  dom.window.close();
 });
 it('copies the generated command without editing',async()=>{
  const dom=setup(),doc=dom.window.document;let copied='';
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async(text)=>{copied=text;}}});
  const input=doc.querySelector('#sunet');input.value='logben';input.dispatchEvent(new dom.window.Event('input'));
  doc.querySelector('#copy-launch').click();await Promise.resolve();
  expect(copied).toBe(doc.querySelector('#launch').textContent.trim());
  expect(copied).toContain('--ssh logben@login.sherlock.stanford.edu');
  dom.window.close();
 });
});
