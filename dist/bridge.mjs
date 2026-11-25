import { readLocalDiagnostics, readLocalStream } from './local-transport.mjs?v=9';

const publicOrigin = 'https://luke.lol';
const nonce = location.hash.slice(1);
const host = window.opener;
const allow = document.getElementById('allow');
const status = document.getElementById('pair-status');
const requests = new Set();
let paired = false;

if (host && /^[a-f0-9-]{36}$/i.test(nonce)) {
  allow.disabled = false;
  allow.addEventListener('click', () => {
    paired = true;
    allow.hidden = true;
    status.textContent = 'Connected to luke.lol for this session.';
    host.postMessage({ kind: 'magsafe-helper-ready', nonce }, publicOrigin);
  }, { once: true });
}

window.addEventListener('message', async event => {
  const { kind, nonce: key } = event.data || {};
  const port = event.ports[0];
  if (!paired || !port || event.source !== host || event.origin !== publicOrigin || key !== nonce || !['diagnostics', 'stream'].includes(kind)) return;
  const controller = new AbortController();
  requests.add(controller);
  port.onmessage = ({data}) => { if (data === 'cancel') controller.abort(); };
  try {
    if (kind === 'diagnostics') {
      const value = await readLocalDiagnostics(controller.signal);
      port.postMessage({ type: 'result', value });
    } else {
      await readLocalStream(controller.signal, message => port.postMessage(message));
      port.postMessage({ type: 'end' });
    }
  } catch (error) {
    if (!controller.signal.aborted) port.postMessage({ type: 'error', message: error.message });
  } finally {
    requests.delete(controller);
    port.close();
  }
});

function stopRequests() {
  paired = false;
  for (const controller of requests) controller.abort();
}
window.addEventListener('pagehide', stopRequests);
if (host) {
  const interval = setInterval(() => {
    if (!host.closed) return;
    stopRequests();
    clearInterval(interval);
    status.textContent = 'The monitor window has closed.';
  }, 500);
}
