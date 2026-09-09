const $ = selector => document.querySelector(selector);
let tabs = [];
let busy = false;
let poll;
function status(message) { $('#status').textContent = message; }
async function request(message) {
  let timer;
  try {
    const result = await Promise.race([chrome.runtime.sendMessage(message), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Interlude is taking too long. Close and reopen this popup, then try again.')), 10000);
    })]);
    if (!result?.ok) throw new Error(result?.message || 'The extension did not respond. Close and reopen this popup.');
    const state = result.state;
    status(state.connected && state.selected
      ? `${state.mediaReady ? 'Player ready' : 'Tab selected · open a player'} · ${state.title}\n${state.message}`
      : state.message);
    $('#connect').hidden = state.connected;
    $('#disconnect').hidden = !state.connected;
    const previous = $('#tabs').value || String(state.tabId || '');
    tabs = result.tabs || [];
    $('#tabs').replaceChildren();
    if (!tabs.length) $('#tabs').add(new Option('Open YouTube or another media site first', ''));
    for (const tab of tabs) $('#tabs').add(new Option(`${tab.platformName} · ${tab.title}`, String(tab.id)));
    if ([...$('#tabs').options].some(option => option.value === previous)) $('#tabs').value = previous;
    $('#select').disabled = !tabs.length;
    $('#release').hidden = !state.gate;
    return true;
  } catch (error) { status(error.message || 'Could not connect to the extension.'); return false; }
  finally { clearTimeout(timer); }
}
async function operate(action) {
  if (busy) return;
  busy = true; clearTimeout(poll);
  for (const element of document.querySelectorAll('button')) element.disabled = true;
  try { await action(); }
  catch (error) { status(error.message || 'This action could not be completed.'); }
  finally {
    busy = false;
    for (const element of document.querySelectorAll('button')) element.disabled = false;
    $('#select').disabled = !tabs.length;
    schedule();
  }
}
$('#connect').addEventListener('click', () => operate(() => request({ type: 'connect' })));
$('#select').addEventListener('click', () => {
  const tab = tabs.find(item => item.id === Number($('#tabs').value));
  if (!tab) return;
  // Must be called directly from the click, before any await, to preserve the
  // browser's user gesture. Request only the exact site the user selected.
  const permission = chrome.permissions.request({ origins: tab.origins || [tab.origin] });
  operate(async () => {
    if (!await permission) { status('Site access was declined. Use this tab again when you are ready to allow it.'); return; }
    await request({ type: 'select', tabId: tab.id });
  });
});
$('#release').addEventListener('click', () => operate(() => request({ type: 'release' })));
$('#disconnect').addEventListener('click', () => operate(() => request({ type: 'disconnect' })));
function schedule() { poll = setTimeout(async () => { if (!busy) await request({ type: 'status' }); schedule(); }, 2500); }
request({ type: 'status' }).finally(schedule);
