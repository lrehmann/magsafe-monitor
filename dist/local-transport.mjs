export async function readLocalDiagnostics(signal) {
  const response = await fetch('/api/charger-info', { method: 'POST', signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not read the charger.');
  return result;
}

export async function readLocalStream(signal, publish) {
  let response = await fetch('/api/live', { method: 'POST', signal });
  // A previous tab's disconnect can take a heartbeat to reach the native probe.
  for (let attempt = 0; response.status === 409 && attempt < 5; attempt++) {
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 350));
    response = await fetch('/api/live', { method: 'POST', signal });
  }
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Could not open the USB stream.');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      const lines = (pending + value).split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const message = JSON.parse(line);
        if (message.type === 'error') throw new Error(message.message);
        publish(message);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
