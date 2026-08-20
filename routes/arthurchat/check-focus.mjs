/* The bug: typing in a chat closed the input mid-sentence.
 *
 * Cause was re-rendering the screen on every poll — replacing a focused
 * <textarea> removes it from the document, and a removed element loses focus,
 * which on a phone dismisses the keyboard. This proves it stays put across a
 * poll that genuinely delivers a new message.
 */
import puppeteer from 'puppeteer';
// Run from a directory with puppeteer available:
//   npm i --no-save puppeteer && node routes/arthurchat/check-focus.mjs
// On this VPS Chrome also needs system libraries unpacked locally — see
// minibridge/scripts/shots.mjs for that recipe.

const APP = 'http://127.0.0.1:5001/arthurchat/';
const API = 'http://127.0.0.1:5001/arthurchat/api';
let pass = true;
const check = (n, ok, d='') => { if(!ok) pass=false; console.log(`  ${ok?'ok  ':'FAIL'}  ${n}${d?` — ${d}`:''}`); };

const call = async (p,{method='GET',body,token}={}) => {
  const r = await fetch(API+p,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  return { status:r.status, data: await r.json().catch(()=>({})) };
};

// A partner who will interrupt mid-typing, driven straight through the API.
const mate = (await call('/signup',{method:'POST',body:{name:'Trillian',pin:'8888'}})).data;

const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width:390, height:844, isMobile:true, hasTouch:true });
page.on('pageerror', e => console.log('  page error:', e.message));

await page.goto(APP,{waitUntil:'networkidle0'});
await page.click('.field'); await page.type('.field','Arthur');
await page.click('input[type=password]'); await page.type('input[type=password]','4242');
await page.click('.btn');
await page.waitForSelector('.fab',{timeout:8000});

// Add the partner via the + sheet — which also exercises the new flow.
await page.click('.fab');
await page.waitForSelector('.field--code',{timeout:8000});
await page.type('.field--code', mate.me.code);
await page.click('.btn--big');
await page.waitForSelector('.composer textarea',{timeout:8000});

const tid = await page.evaluate(async () => {
  const r = await fetch('/arthurchat/api/threads',{headers:{Authorization:`Bearer ${localStorage.getItem('arthurchat.token')}`}});
  return (await r.json()).threads[0].id;
});

// --- focus the composer and start typing, as a person would
await page.click('.composer textarea');
await page.type('.composer textarea','half a thought');

const before = await page.evaluate(() => ({
  focused: document.activeElement?.tagName,
  value: document.activeElement?.value,
  bubbles: document.querySelectorAll('.bubble').length
}));
check('composer focused while typing', before.focused==='TEXTAREA', before.focused);

// --- the other side says something; the 2.5s poll will pick it up
await call(`/threads/${encodeURIComponent(tid)}/say`,{method:'POST',token:mate.token,body:{text:'Interrupting you.'}});
await new Promise(r=>setTimeout(r,4200));

const after = await page.evaluate(() => ({
  focused: document.activeElement?.tagName,
  value: document.activeElement?.value ?? '',
  bubbles: document.querySelectorAll('.bubble').length,
  text: [...document.querySelectorAll('.bubble')].map(b=>b.textContent).join('|')
}));

check('new message did arrive', after.bubbles > before.bubbles, `${before.bubbles} -> ${after.bubbles}`);
check('message is the right one', after.text.includes('Interrupting you.'));
check('STILL focused after poll', after.focused==='TEXTAREA', after.focused);
check('draft survived the poll', after.value==='half a thought', JSON.stringify(after.value));

// --- and sending must not blow the field away either
await page.click('.send');
await new Promise(r=>setTimeout(r,1200));
const sent = await page.evaluate(() => ({
  focused: document.activeElement?.tagName,
  value: document.activeElement?.value ?? '',
  text: [...document.querySelectorAll('.bubble')].map(b=>b.textContent).join('|')
}));
check('sent message shows', sent.text.includes('half a thought'));
check('composer survives send', sent.focused==='TEXTAREA', sent.focused);
check('composer cleared', sent.value==='', JSON.stringify(sent.value));

// --- the chats list poll must not eat the add-code field either
await page.click('.bar .icon-btn');            // back
await page.waitForSelector('.fab',{timeout:8000});
await page.click('.fab');
await page.waitForSelector('.field--code',{timeout:8000});
await page.click('.field--code');
await page.type('.field--code','ARTH-');
await new Promise(r=>setTimeout(r,6500));      // longer than the 5s list poll
const adder = await page.evaluate(() => ({ focused: document.activeElement?.className, value: document.activeElement?.value ?? '' }));
check('code field survives list poll', adder.focused.includes('field--code'), adder.focused);
check('typed code survived', adder.value==='ARTH-', JSON.stringify(adder.value));

await browser.close();
console.log(`\n${pass?'PASS':'FAIL'}`);
process.exit(pass?0:1);
