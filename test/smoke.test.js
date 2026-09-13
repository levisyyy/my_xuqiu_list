// 端到端冒烟测试：用 jsdom 驱动真实 UI 交互（点击/表单提交/blur/keydown），断言 DOM + localStorage
// 运行：npm test（需先 npm install 安装 jsdom）
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const flush = () => new Promise(r => setTimeout(r, 0)); // 等待确认框 Promise.then 回调执行

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/', // localStorage 需要非 opaque origin
  pretendToBeVisual: true
});
const { window } = dom;
const { document } = window;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const ev = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' | ' + extra : '')); }
}

(async function main() {

console.log('== 1. 初始空状态 ==');
check('空状态显示', !!$('.empty'));
check('空状态含添加按钮', !!$('.empty [data-action="empty-add"]'));
check('摘要显示 0 条', $('#summary').textContent.includes('共 0 条'), $('#summary').textContent);

console.log('== 2. 通过 UI 添加需求 ==');
click($('#btnAdd'));
check('模态框打开', !$('#reqModal').classList.contains('hidden'));
const form = $('#reqForm');
form.elements.title.value = '支持批量导出月度报表';
form.elements.proposer.value = '张三';
form.elements.createdAt.value = '2026-08-28'; // 补录历史：应生成多周
form.elements.status.value = 'doing';
form.querySelector('input[name=priority][value=high]').checked = true;
ev(form, 'submit');
check('模态框关闭', $('#reqModal').classList.contains('hidden'));
check('表格已渲染', !!$('#grid'));
const weekHeads = $$('.week-head');
console.log('   周列组: ' + weekHeads.map(w => w.textContent.trim()).join(' | '));
check('生成多个周列组(08-24起至今>=4周)', weekHeads.length >= 4, '实际 ' + weekHeads.length);
check('最后一个周是当前周', weekHeads[weekHeads.length - 1].classList.contains('current'));
const row = $('#grid tbody tr');
check('需求行存在', !!row);
check('首列标题正确', row.querySelector('.req-title').textContent === '支持批量导出月度报表');
check('提出人显示', row.querySelector('.proposer').textContent.includes('张三'));
check('优先级徽章=高', row.querySelector('.badge.prio-high') !== null);
const dayCells = Array.from(row.querySelectorAll('td.day-cell'));
check('日格子数 = 周数x7', dayCells.length === weekHeads.length * 7, dayCells.length + ' vs ' + weekHeads.length * 7);
const beforeCells = dayCells.filter(td => td.classList.contains('before-create'));
check('创建前格子为灰壳 (08-24~08-27 共4个)', beforeCells.length === 4, '实际 ' + beforeCells.length);
check('灰壳无 checkbox', beforeCells.every(td => !td.querySelector('input')));
check('今天列存在', $$('.day-head.today').length === 1);
check('每周有统计列', row.querySelectorAll('.week-stat').length === weekHeads.length);

console.log('== 3. 添加第二条需求(XSS测试) ==');
click($('#btnAdd'));
form.elements.title.value = '<img src=x onerror=alert(1)>支付改版';
form.elements.proposer.value = '李四"<b>';
form.elements.createdAt.value = '2026-09-14';
ev(form, 'submit');
let rows = $$('#grid tbody tr');
check('两行需求', rows.length === 2);
check('XSS 内容以文本呈现', rows[1].querySelector('.req-title').textContent.includes('<img src=x'), rows[1].querySelector('.req-title').textContent);
check('无真实 img 元素注入', rows[1].querySelector('img') === null);

console.log('== 4. 勾选完成 checkbox ==');
let todayCell = Array.from(rows[0].querySelectorAll('td.day-cell')).find(td => td.classList.contains('today-col'));
check('找到今天的格子', !!todayCell);
const cb = todayCell.querySelector('input[type=checkbox]');
cb.checked = true;
ev(cb, 'change');
check('格子获得 done 类', todayCell.classList.contains('done'));
let ls = JSON.parse(window.localStorage.getItem('prd-tracker:v1'));
const tKey = todayCell.dataset.date;
const rec0 = ls.records[rows[0].dataset.req + '|' + tKey];
check('localStorage 写入 record', rec0 && rec0.done === true, JSON.stringify(ls.records));
const curWeekStats = Array.from(rows[0].querySelectorAll('.week-stat'));
const lastStat = curWeekStats[curWeekStats.length - 1];
check('当前周统计 chip 更新为 1/7', lastStat.textContent.trim() === '1/7', lastStat.textContent);
check('摘要本周完成=1', $('#summary').textContent.includes('本周完成 1 天'), $('#summary').textContent);
check('累计完成天数=1', rows[0].querySelector('.req-total-days').textContent === '1');

console.log('== 5. 备注 click-to-edit ==');
click(todayCell.querySelector('.note'));
const ta = todayCell.querySelector('textarea.note-editor');
check('点击后出现 textarea', !!ta);
ta.value = '完成初稿，待评审';
ta.dispatchEvent(new window.Event('blur'));
check('blur 后 textarea 消失', !todayCell.querySelector('textarea.note-editor'));
check('备注文本显示', todayCell.querySelector('.note').textContent === '完成初稿，待评审');
ls = JSON.parse(window.localStorage.getItem('prd-tracker:v1'));
const rec1 = ls.records[rows[0].dataset.req + '|' + tKey];
check('备注持久化且 done 保留', rec1 && rec1.note === '完成初稿，待评审' && rec1.done === true, JSON.stringify(rec1));
click(todayCell.querySelector('.note'));
const ta1b = todayCell.querySelector('textarea.note-editor');
ta1b.value = '完成初稿，待评审 v2';
ta1b.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
check('Ctrl+Enter 保存', todayCell.querySelector('.note').textContent === '完成初稿，待评审 v2');
const tomorrowCell = Array.from(rows[0].querySelectorAll('td.day-cell')).find(td => td.dataset.date > tKey);
click(tomorrowCell.querySelector('.note'));
const ta2 = tomorrowCell.querySelector('textarea.note-editor');
ta2.value = '不应保存';
ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
check('Esc 取消编辑', tomorrowCell.querySelector('.note').textContent === '＋' && !tomorrowCell.querySelector('textarea'));
ls = JSON.parse(window.localStorage.getItem('prd-tracker:v1'));
check('Esc 后无记录写入', !ls.records[rows[0].dataset.req + '|' + tomorrowCell.dataset.date]);

console.log('== 6. 取消勾选且备注为空时删除记录 ==');
click(todayCell.querySelector('.note'));
const ta3 = todayCell.querySelector('textarea.note-editor');
ta3.value = '';
ta3.dispatchEvent(new window.Event('blur'));
const cb3 = todayCell.querySelector('input[type=checkbox]');
cb3.checked = false;
ev(cb3, 'change');
ls = JSON.parse(window.localStorage.getItem('prd-tracker:v1'));
check('空记录被删除', Object.keys(ls.records).length === 0, JSON.stringify(ls.records));
check('chip 回到 0/7', Array.from(rows[0].querySelectorAll('.week-stat')).pop().textContent.trim() === '0/7');

console.log('== 7. 编辑需求 ==');
click(rows[0].querySelector('[data-action="edit-req"]'));
check('编辑模态框打开', !$('#reqModal').classList.contains('hidden') && $('#reqModalTitle').textContent === '编辑需求');
check('表单带入原值', form.elements.title.value === '支持批量导出月度报表' && form.elements.proposer.value === '张三');
form.elements.status.value = 'done';
ev(form, 'submit');
check('状态徽章更新为已完成', !!$('#grid tbody tr .badge.st-done'));

console.log('== 8. 删除需求(确认框+级联, 异步) ==');
rows = $$('#grid tbody tr');
const cell2 = Array.from(rows[1].querySelectorAll('td.day-cell')).find(td => !td.classList.contains('before-create'));
const cb2 = cell2.querySelector('input');
cb2.checked = true;
ev(cb2, 'change');
ls = JSON.parse(window.localStorage.getItem('prd-tracker:v1'));
check('删除前有 1 条记录', Object.keys(ls.records).length === 1);
const id2 = rows[1].dataset.req;
click(rows[1].querySelector('[data-action="del-req"]'));
const confirmMask = Array.from(document.querySelectorAll('.modal-mask')).find(m => !m.classList.contains('hidden') && m.textContent.includes('删除需求'));
check('删除确认框出现', !!confirmMask);
click(confirmMask.querySelector('button[data-v="1"]'));
await flush(); // 浏览器中点击后微任务立即执行；同步测试需手动让出事件循环
check('确认框已关闭', !document.body.contains(confirmMask));
check('删除后剩 1 行', $$('#grid tbody tr').length === 1);
ls = JSON.parse(window.localStorage.getItem('prd-tracker:v1'));
check('存储中剩 1 条需求', ls.requirements.length === 1);
check('级联删除其记录', Object.keys(ls.records).filter(k => k.startsWith(id2 + '|')).length === 0);
click($$('#grid tbody tr')[0].querySelector('[data-action="del-req"]'));
const mask2 = Array.from(document.querySelectorAll('.modal-mask')).find(m => !m.classList.contains('hidden'));
click(mask2.querySelector('button[data-v="0"]'));
await flush();
check('取消删除保留数据', $$('#grid tbody tr').length === 1);

console.log('== 9. 刷新页面数据恢复 ==');
const saved = window.localStorage.getItem('prd-tracker:v1');
const dom4 = new JSDOM(html, {
  runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
  beforeParse(w) { w.localStorage.setItem('prd-tracker:v1', saved); }
});
const d4 = dom4.window.document;
check('重新加载后需求恢复(1行)', d4.querySelectorAll('#grid tbody tr').length === 1);
check('重新加载后标题正确', d4.querySelector('.req-title').textContent === '支持批量导出月度报表');
check('重新加载后状态徽章=已完成', !!d4.querySelector('.badge.st-done'));

console.log('== 10. 未来格子可交互 / 表单校验 ==');
const futureCells = Array.from(d4.querySelectorAll('td.day-cell.future'));
check('未来格子存在且可交互', futureCells.length > 0 && futureCells.every(td => td.querySelector('input')));
const before = d4.querySelectorAll('#grid tbody tr').length;
const f4 = d4.querySelector('#reqForm');
d4.querySelector('#btnAdd').dispatchEvent(new dom4.window.MouseEvent('click', { bubbles: true }));
f4.elements.title.value = '   ';
f4.elements.proposer.value = '';
f4.dispatchEvent(new dom4.window.Event('submit', { bubbles: true, cancelable: true }));
check('空表单被拒绝', d4.querySelectorAll('#grid tbody tr').length === before && !d4.querySelector('#reqModal').classList.contains('hidden'));

console.log('== 11. 存储结构兼容(模拟导入后数据) ==');
const dom5 = new JSDOM(html, {
  runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
  beforeParse(w) {
    w.localStorage.setItem('prd-tracker:v1', JSON.stringify({
      version: 1,
      requirements: [
        { id: 'r-a', title: '导入的需求A', proposer: '王五', priority: 'low', status: 'doing', createdAt: '2026-09-07', updatedAt: '2026-09-07' },
        { id: 'r-b', title: '导入的需求B', proposer: '赵六', priority: 'medium', status: 'paused', createdAt: '2026-09-10', updatedAt: '2026-09-10' }
      ],
      records: { 'r-a|2026-09-08': { done: true, note: '需求评审通过' }, 'r-a|2026-09-09': { done: false, note: '等待设计稿' } }
    }));
  }
});
const d5 = dom5.window.document;
check('渲染 2 行', d5.querySelectorAll('#grid tbody tr').length === 2);
const noteCell = Array.from(d5.querySelectorAll('td.day-cell')).find(td => td.dataset.req === 'r-a' && td.dataset.date === '2026-09-08');
check('历史记录勾选+备注正确渲染', noteCell && noteCell.classList.contains('done') && noteCell.querySelector('.note').textContent === '需求评审通过');
const statsA = Array.from(d5.querySelectorAll('tr[data-req="r-a"] .week-stat'));
// r-a 创建于 09-07(第37周周一); 记录在 09-08 → 第37周(第一组)统计 1/7, 第38周(当前,最后) 0/7
check('第37周统计=1/7', statsA[0].textContent.trim() === '1/7', statsA[0] && statsA[0].textContent);
check('第38周统计=0/7', statsA[statsA.length - 1].textContent.trim() === '0/7', statsA[statsA.length - 1] && statsA[statsA.length - 1].textContent);
check('r-b 创建前格子灰壳(09-07~09-09 共3个)', Array.from(d5.querySelectorAll('tr[data-req="r-b"] td.before-create')).length === 3);
check('暂停状态徽章', !!d5.querySelector('.badge.st-paused'));
check('摘要统计正确', d5.querySelector('#summary').textContent.includes('共 2 条'), d5.querySelector('#summary').textContent);

console.log('== 12. 损坏数据自愈 ==');
const dom6 = new JSDOM(html, {
  runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
  beforeParse(w) { w.localStorage.setItem('prd-tracker:v1', '{{{not json'); }
});
const d6 = dom6.window.document;
check('损坏数据不崩溃, 显示空状态', !!d6.querySelector('.empty'));
check('损坏数据提示 banner', !d6.querySelector('#banner').classList.contains('hidden'));
const corruptKeys = Object.keys(dom6.window.localStorage).filter(k => k.includes('corrupt'));
check('损坏数据已备份到 corrupt 键', corruptKeys.length === 1, corruptKeys.join(','));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('TEST ERROR:', e); process.exit(2); });
