const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://example.test' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const ts = require('typescript');
const cache = {};
function load(relative) {
  if (cache[relative]) return cache[relative].exports;
  const filename = path.join(repo, relative);
  const m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(repo); cache[relative] = m;
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.endsWith('.css')) return {};
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), id).replace(/\.js$/, '');
      const file = ['.tsx', '.ts'].map(ext => base + ext).find(fs.existsSync);
      if (file) return load(path.relative(repo, file));
    }
    return orig(id);
  };
  let source = fs.readFileSync(filename, 'utf8');
  if (relative === 'src/App.tsx') source += '\nexport { FamilyScheduleEditor };';
  m._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return m.exports;
}
const { FamilyScheduleEditor } = load('src/App.tsx');
const { WeeklyRoutine, EmailStatus } = load('src/FamilyPlanning.tsx');
const root = createRoot(document.getElementById('root'));
const click = async (label) => {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes(label));
  assert(button, `Missing button: ${label}`);
  await React.act(async () => button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
};
const text = () => document.body.textContent;
const event = { id: 'today', title: 'Today appointment', forWho: 'Mary', category: 'appointment', date: new Date().toISOString().slice(0, 10).replaceAll('-', '') + 'T120000', dayLabel: 'Today', time: '12:00', endTime: '13:00', details: '', helpNeeded: 'No help needed' };
(async () => {
  let decisions = 0; let routines = 0;
  await React.act(async () => root.render(React.createElement(FamilyScheduleEditor, { events: [event, { ...event, id: 'future', title: 'Future appointment', date: '20991101T120000' }], needs: [{ ...event, title: 'Unfilled task', helpNeeded: 'Need a ride' }], requestsCount: 2, onReviewRequests: () => decisions++, onRoutines: () => routines++, onEdit: () => {}, onAdd: () => {} })));
  assert(text().includes('Today appointment')); assert(!text().includes('Future appointment'));
  await click('See all upcoming'); assert(text().includes('Future appointment'));
  await click('Unfilled help'); assert(text().includes('Unfilled task')); assert(!text().includes('Future appointment'));
  await click('Need a decision'); assert.equal(decisions, 1);
  await click('Copy a week'); assert.equal(routines, 1);
  let retries = 0;
  await React.act(async () => root.render(React.createElement(EmailStatus, { notices: [{ id: 'email1', subject: 'Confirmation', recipient: 'helper@example.com', status: 'bounced', lastError: 'Mailbox not found' }], request: async () => { retries++; return {}; }, onRefresh: async () => {} })));
  assert(text().includes('1 need attention')); assert(text().includes('Not delivered')); await click('Retry email'); assert.equal(retries, 1);
  const calls = [];
  await React.act(async () => root.render(React.createElement(WeeklyRoutine, { events: [], templates: [{ id: 'routine', name: 'Saved routine', items: [{}] }], onSaved: async () => {}, request: async body => { calls.push(body); return body.action === 'previewScheduleTemplate' ? { items: [{ ...event, id: 'copy1', exists: false, conflict: false }, { ...event, id: 'copy2', exists: false, conflict: true }] } : { added: 1 }; } })));
  await React.act(async () => { const select = document.getElementById('routine-select'); select.value = 'routine'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await click('Preview week'); assert(text().includes('Overlaps another item')); assert.equal(document.querySelectorAll('input[type="checkbox"]:disabled').length, 1);
  await click('Add 1 items'); assert(calls.some(call => call.action === 'applyScheduleTemplate' && call.selectedIds.length === 1 && call.selectedIds[0] === 'copy1'));
  assert(text().includes('1 items added'));
  await React.act(async () => root.unmount());
  console.log('PASS: interactive family today/upcoming/open views, request and routine navigation, failed-email retry, routine preview excludes conflicts and submits only selected safe items.');
})().catch(error => { console.error(error); process.exitCode = 1; });
