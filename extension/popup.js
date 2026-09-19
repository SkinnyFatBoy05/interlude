const $ = selector => document.querySelector(selector);
let tabs = [];
let aiTabs = [];
let webEnabled = false;
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
    aiTabs = result.aiTabs || [];
    const previousAI = $('#ai-tabs').value;
    $('#ai-tabs').replaceChildren();
    if (!aiTabs.length) $('#ai-tabs').add(new Option('Open Claude or Codex in this browser', ''));
    for (const tab of aiTabs) $('#ai-tabs').add(new Option(`${tab.name} · ${tab.title}`, String(tab.id)));
    if (aiTabs.some(tab => String(tab.id) === previousAI)) $('#ai-tabs').value = previousAI;
    $('#watch').disabled = !aiTabs.length;
    webEnabled = result.web?.enabled === true;
    $('#web-toggle').textContent = webEnabled ? 'Turn off website monitoring' : 'Turn on website monitoring';
    $('#web-mode').value = result.web?.mode || 'fun';
    $('#web-status').textContent = result.web?.notice || '';
    const tasks = Object.values(result.web?.tasks || {});
    $('#web-ack').hidden = !tasks.some(t => ['attention', 'complete', 'failed'].includes(t.status) && !t.acknowledged);
    $('#web-tasks').replaceChildren();
    for (const task of tasks) {
      const item = document.createElement('li');
      const remove = document.createElement('button'); remove.className = 'link'; remove.textContent = 'Stop watching';
      remove.addEventListener('click', () => operate(() => request({ type: 'web-remove', tabId: task.id })));
      item.append(document.createTextNode(`${task.title || task.name} · ${task.status} `), remove); $('#web-tasks').append(item);
    }
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
    $('#watch').disabled = !aiTabs.length;
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
$('#watch').addEventListener('click', () => {
  const tab = aiTabs.find(t => t.id === Number($('#ai-tabs').value)); if (!tab) return;
  const permission = chrome.permissions.request({ origins: [tab.origin] });
  operate(async () => { if (!await permission) { status('AI site access was declined.'); return; } await request({ type: 'web-watch', tabId: tab.id }); });
});
$('#web-toggle').addEventListener('click', () => operate(() => request({ type: 'web-configure', enabled: !webEnabled })));
$('#web-mode').addEventListener('change', () => operate(() => request({ type: 'web-configure', mode: $('#web-mode').value })));
$('#web-ack').addEventListener('click', () => operate(() => request({ type: 'web-acknowledge' })));
function schedule() { poll = setTimeout(async () => { if (!busy) await request({ type: 'status' }); schedule(); }, 2500); }
request({ type: 'status' }).finally(schedule);
