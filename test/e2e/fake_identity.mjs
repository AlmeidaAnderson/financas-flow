// TEST-ONLY stand-in for site/vendor/netlify-identity.js (served by Playwright route in e2e_netlify.py).
// Same exported names the store uses; "login" sets the nf_jwt cookie to `test-<id>`, which only the
// test harness (test/e2e/netlify_harness.mjs) accepts. Never deployed.
const KEY = 'fake-identity-user';
let fns = [];
const cur = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
const emit = (ev, u) => fns.slice().forEach((f) => { try { f(ev, u); } catch (e) { console.error(e); } });
export async function getUser() { const u = cur(); return u && /(?:^|; )nf_jwt=/.test(document.cookie) ? u : null; }
export async function login(email, password) {
  if (password !== 'senha-certa-123') { const e = new Error('invalid_grant: Invalid login'); e.status = 400; throw e; }
  const id = String(email).split('@')[0].replace(/[^A-Za-z0-9_-]/g, '');
  const u = { id, email };
  localStorage.setItem(KEY, JSON.stringify(u));
  document.cookie = 'nf_jwt=test-' + id + '; path=/; SameSite=Lax';
  emit('login', u); return u;
}
export async function logout() { localStorage.removeItem(KEY); document.cookie = 'nf_jwt=; Max-Age=0; path=/'; emit('logout', null); }
export function onAuthChange(f) { fns.push(f); return () => { fns = fns.filter((x) => x !== f); }; }
export async function refreshSession() { return null; }
export async function handleAuthCallback() { return null; }
export async function getSettings() { return { providers: {} }; }
export async function requestPasswordRecovery() {}
export async function acceptInvite() { throw new Error('n/a'); }
export async function updateUser() { throw new Error('n/a'); }
export function oauthLogin() { throw new Error('n/a'); }
