/* ArthurChat API checks — signup, signin, adding, messaging, and the privacy
 * boundaries between two accounts.
 *
 *   node routes/arthurchat/check-api.mjs
 *
 * Talks to the running server on :5001 and creates throwaway accounts.
 */
const BASE = 'http://127.0.0.1:5001/arthurchat/api';
let pass = true;
const check = (name, ok, detail='') => {
  if (!ok) pass = false;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function call(path, { method='GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body?{'Content-Type':'application/json'}:{}) , ...(token?{Authorization:`Bearer ${token}`}:{}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// --- signup two people
const a = await call('/signup', { method:'POST', body:{ name:'Arthur Dent', pin:'4242' } });
const b = await call('/signup', { method:'POST', body:{ name:'Ford Prefect', pin:'1979' } });
check('signup A', a.status===200 && !!a.data.token, a.data.me?.code);
check('signup B', b.status===200 && !!b.data.token, b.data.me?.code);
check('codes differ', a.data.me.code !== b.data.me.code);
check('code format', /^ARTH-[A-Z][0-9]{2}[A-Z]$/.test(a.data.me.code), a.data.me.code);

const A = a.data.token, B = b.data.token;

// --- validation
check('rejects short pin', (await call('/signup',{method:'POST',body:{name:'x',pin:'12'}})).status===400);
check('rejects empty name', (await call('/signup',{method:'POST',body:{name:'   ',pin:'1234'}})).status===400);

// --- auth
check('me requires token', (await call('/me')).status===401);
check('me works', (await call('/me',{token:A})).data.me.code===a.data.me.code);

// --- signin from "another device", incl. sloppy code entry
const again = await call('/signin', { method:'POST', body:{ code: a.data.me.code.toLowerCase().replace('-',' '), pin:'4242' } });
check('signin w/ sloppy code', again.status===200 && !!again.data.token);
check('wrong pin refused', (await call('/signin',{method:'POST',body:{code:a.data.me.code,pin:'9999'}})).status===401);

// --- add each other
check('cannot add self', (await call('/add',{method:'POST',token:A,body:{code:a.data.me.code}})).status===400);
check('unknown code 404s', (await call('/add',{method:'POST',token:A,body:{code:'ARTH-Z99Z'}})).status===404);

const add1 = await call('/add', { method:'POST', token:A, body:{ code: b.data.me.code } });
check('A adds B', add1.status===200, add1.data.thread?.id);
const add2 = await call('/add', { method:'POST', token:B, body:{ code: a.data.me.code } });
check('adding back is idempotent', add2.data.thread?.id === add1.data.thread?.id, 'same thread id');

const tid = add1.data.thread.id;

// --- messaging
await call(`/threads/${encodeURIComponent(tid)}/say`, { method:'POST', token:A, body:{ text:'Hello Ford.' } });
await call(`/threads/${encodeURIComponent(tid)}/say`, { method:'POST', token:B, body:{ text:'Time for a drink?' } });

const seenByA = await call(`/threads/${encodeURIComponent(tid)}`, { token:A });
check('A sees both messages', seenByA.data.messages.length===2, `${seenByA.data.messages.length}`);
check('ownership is per-viewer', seenByA.data.messages[0].mine===true && seenByA.data.messages[1].mine===false);
const seenByB = await call(`/threads/${encodeURIComponent(tid)}`, { token:B });
check('B sees them mirrored', seenByB.data.messages[0].mine===false && seenByB.data.messages[1].mine===true);
check('other party named', seenByA.data.who.name==='Ford Prefect', seenByA.data.who.name);

// --- since= polling
const last = seenByA.data.messages[1].at;
check('since= returns nothing new', (await call(`/threads/${encodeURIComponent(tid)}?since=${last}`,{token:A})).data.messages.length===0);
await call(`/threads/${encodeURIComponent(tid)}/say`, { method:'POST', token:B, body:{ text:'Bring a towel.' } });
const delta = await call(`/threads/${encodeURIComponent(tid)}?since=${last}`, { token:A });
check('since= returns only the new one', delta.data.messages.length===1 && delta.data.messages[0].text==='Bring a towel.');

// --- thread list + unread
await call(`/threads/${encodeURIComponent(tid)}/say`, { method:'POST', token:B, body:{ text:'Two towels.' } });
const listB = await call('/threads', { token:B });
check('list shows the thread', listB.data.threads.length===1, `${listB.data.threads.length}`);
check('last message summarised', listB.data.threads[0].last.text==='Two towels.');
check('sender has no unread', listB.data.threads[0].unread===0, `${listB.data.threads[0].unread}`);

// --- privacy: a stranger cannot read the thread
const c = await call('/signup', { method:'POST', body:{ name:'Zaphod', pin:'5555' } });
check('stranger cannot read thread', (await call(`/threads/${encodeURIComponent(tid)}`,{token:c.data.token})).status===404);
check('stranger cannot post', (await call(`/threads/${encodeURIComponent(tid)}/say`,{method:'POST',token:c.data.token,body:{text:'hi'}})).status===404);
check('no pin hash leaks', !JSON.stringify(seenByA.data).match(/pinHash|pinSalt/));

// --- limits
check('empty message refused', (await call(`/threads/${encodeURIComponent(tid)}/say`,{method:'POST',token:A,body:{text:'   '}})).status===400);
check('2001 chars refused', (await call(`/threads/${encodeURIComponent(tid)}/say`,{method:'POST',token:A,body:{text:'x'.repeat(2001)}})).status===400);

// --- signout
await call('/signout', { method:'POST', token:A });
check('token dies on signout', (await call('/me',{token:A})).status===401);

console.log(`\n${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass?0:1);
