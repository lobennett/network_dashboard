// @vitest-environment jsdom
import { expect, it } from 'vitest';
import recovery from '../public/recovery.js?raw';
it('offers one reload action when an obsolete deployment chunk fails',()=>{
 document.body.innerHTML='<div id="app">Study</div>';
 window.eval(recovery);
 const event=new Event('vite:preloadError',{cancelable:true});
 window.dispatchEvent(event);
 window.dispatchEvent(new Event('vite:preloadError',{cancelable:true}));
 expect(event.defaultPrevented).toBe(true);
 expect(document.querySelectorAll('#site-update-notice')).toHaveLength(1);
 expect(document.querySelector('#site-update-notice')?.textContent).toContain('Reload site');
 expect(document.querySelector('#app')?.textContent).toBe('Study');
});
