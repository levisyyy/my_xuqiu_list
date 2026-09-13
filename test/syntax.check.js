// 语法检查：提取 index.html 内嵌 <script> 并用 new Function 验证 JS 语法
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('NO SCRIPT FOUND'); process.exit(1); }
try {
  new Function(m[1]);
  console.log('JS syntax OK (' + m[1].length + ' chars)');
} catch (e) {
  console.error('SYNTAX ERROR:', e.message);
  process.exit(1);
}
