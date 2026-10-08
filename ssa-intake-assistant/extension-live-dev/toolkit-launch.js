export const TOOLKIT_SOURCES = Object.freeze([
  'https://packardtoolkit.vercel.app/intake-checker/',
  'http://localhost:5173/intake-checker/',
  'http://127.0.0.1:5173/intake-checker/',
]);

export function isToolkitLaunchRequest(message, sender) {
  if (!message || Object.keys(message).length !== 1 || message.type !== 'open-ssa-application'
      || !Number.isInteger(sender?.tab?.id) || sender.frameId !== 0
      || !TOOLKIT_SOURCES.includes(sender.url)) return false;
  try {
    const source = new URL(sender.url);
    return !sender.origin || sender.origin === source.origin;
  } catch { return false; }
}
