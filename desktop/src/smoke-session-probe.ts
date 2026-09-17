/** Read-only probe executed inside the authenticated packaged renderer. */
export function createSmokeSessionProbe(sessionId: string, expectedText: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !expectedText || expectedText.length > 4096) {
    throw new Error("Invalid smoke session fixture");
  }
  return `(async () => {
    const id = ${JSON.stringify(sessionId)};
    const expectedText = ${JSON.stringify(expectedText)};
    const listResponse = await fetch('/api/sessions', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!listResponse.ok) throw new Error('Cannot list preserved sessions');
    const list = await listResponse.json();
    if (!list.sessions?.some(session => session.id === id)) throw new Error('Preserved session is not discoverable');
    const response = await fetch('/api/sessions/' + encodeURIComponent(id), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Cannot load preserved session');
    const detail = await response.json();
    const found = detail.sessionId === id && detail.context?.messages?.some(message => message.role === 'user'
      && (typeof message.content === 'string' ? message.content === expectedText
        : Array.isArray(message.content) && message.content.some(part => part.type === 'text' && part.text === expectedText)));
    if (!found) throw new Error('Preserved session message did not load');
    return { sessionId: id, listed: true, messageLoaded: true };
  })()`;
}
