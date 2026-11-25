const helperOrigin = 'http://127.0.0.1:8778';

export function pairHelper() {
  const nonce = crypto.randomUUID();
  const popup = window.open(`${helperOrigin}/bridge.html#${nonce}`, '_blank', 'popup,width=520,height=360');
  if (!popup) return Promise.reject(new Error('Allow the helper popup, then try again.'));

  return new Promise((resolve, reject) => {
    const finish = (result, error) => {
      clearTimeout(timeout);
      clearInterval(watch);
      window.removeEventListener('message', ready);
      if (error) reject(error);
      else resolve(result);
    };
    const ready = event => {
      if (event.origin !== helperOrigin || event.source !== popup || event.data?.nonce !== nonce || event.data?.kind !== 'magsafe-helper-ready') return;
      finish({
        diagnostics: signal => request('diagnostics', signal),
        stream: (signal, publish) => request('stream', signal, publish),
      });
    };
    const timeout = setTimeout(() => {
      popup.close();
      finish(undefined, new Error('The Mac helper did not respond. Start it locally and try again.'));
    }, 45000);
    const watch = setInterval(() => {
      if (popup.closed) finish(undefined, new Error('The Mac helper window closed.'));
    }, 500);
    window.addEventListener('message', ready);
  });

  function request(kind, signal, publish) {
    return new Promise((resolve, reject) => {
      if (popup.closed || signal.aborted) {
        reject(signal.reason || new Error('The Mac helper window closed.'));
        return;
      }
      const channel = new MessageChannel();
      const finish = (value, error) => {
        clearInterval(watch);
        signal.removeEventListener('abort', cancel);
        channel.port1.close();
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = () => {
        channel.port1.postMessage('cancel');
        finish(undefined, signal.reason);
      };
      const watch = setInterval(() => {
        if (popup.closed) finish(undefined, new Error('The Mac helper window closed.'));
      }, 500);
      signal.addEventListener('abort', cancel, { once: true });
      channel.port1.onmessage = ({data}) => {
        if (data.type === 'report' || data.type === 'ready' || data.type === 'heartbeat') {
          try { publish?.(data); }
          catch (error) {
            channel.port1.postMessage('cancel');
            finish(undefined, error);
          }
        } else if (data.type === 'result' || data.type === 'end') finish(data.value);
        else if (data.type === 'error') finish(undefined, new Error(data.message));
      };
      popup.postMessage({ kind, nonce }, helperOrigin, [channel.port2]);
    });
  }
}
