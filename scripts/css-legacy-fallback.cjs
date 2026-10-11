// 构建后 CSS 降级：让 Tailwind v4 产物在 Electron 22 / Chromium 108（Windows 7）下颜色正常。
// 根因：Tailwind v4 给 bg-x/80 这类透明度类生成的静态回退取的是 @theme 浅色值（如 #fffc=白80%），
// 深色主题依赖 @supports color-mix 运行时切换；Chromium 108 不支持 color-mix/oklch，于是回退成白色（白条/白按钮）。
// 做法：
//  1) oklch()/oklab() 字面量 -> hex（调色板变量）
//  2) 给每个 --color-X 补一份 RGB 通道变量 --color-X-rgb（:root 与 .dark 各一份，跟随主题）
//  3) @supports 内 color-mix(var(--color-X) P%, transparent) -> rgb(var(--color-X-rgb) / P%)，去掉 @supports 包裹
//  4) currentcolor 混合保留 currentColor（仅 placeholder 一处，丢透明度无影响）
const fs = require('fs');
const path = require('path');

// ---------- 颜色转换 ----------
function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const srgbGamma = (x) => { x = Math.max(0, Math.min(1, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
function oklchToRgb(L, C, hDeg) {
  const hr = (hDeg || 0) * Math.PI / 180;
  return oklabToLinearSrgb(L, C * Math.cos(hr), C * Math.sin(hr)).map((v) => Math.round(srgbGamma(v) * 255));
}
function oklabToRgb(L, a, b) { return oklabToLinearSrgb(L, a, b).map((v) => Math.round(srgbGamma(v) * 255)); }
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
function parseColor(v) {
  v = String(v).trim();
  let m;
  if ((m = /^#([0-9a-f]{3,4})$/i.exec(v))) {
    const t = m[1].split('').map((c) => c + c).join('');
    return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
  }
  if ((m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v))) {
    return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  }
  if ((m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(v))) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  if ((m = /^hsl\(\s*([\d.]+)[ ,]+([\d.]+)%?[ ,]+([\d.]+)%?/i.exec(v))) return hslToRgb(+m[1], +m[2], +m[3]);
  if ((m = /^oklch\(\s*([\d.]+)%?\s+([-.\d]+)\s+(none|[\d.]+)/i.exec(v))) return oklchToRgb(+m[1] > 1 ? +m[1] / 100 : +m[1], +m[2], m[3] === 'none' ? 0 : +m[3]);
  if ((m = /^oklab\(\s*([\d.]+)%?\s+([-.\d]+)\s+([-.\d]+)/i.exec(v))) return oklabToRgb(+m[1] > 1 ? +m[1] / 100 : +m[1], +m[2], +m[3]);
  return null;
}
const rgbHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
const fmtA = (a) => { a = Math.max(0, Math.min(1, a)); return Math.abs(a - 1) < 1e-4 ? '1' : String(Math.round(a * 1000) / 1000); };

// 平衡括号：从 s[start]（应为 '('）找到匹配 ')' 的下标（含）
function matchParen(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return s.length - 1;
}
// 按顶层逗号切分（括号内逗号不切）
function splitTopCommas(s) {
  const parts = []; let depth = 0, buf = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; } else buf += ch;
  }
  parts.push(buf);
  return parts.map((x) => x.trim());
}
// 解析单个混合参数 "<颜色> [P%]"
function parseMixArg(arg) {
  const m = /^(.+?)\s+(\d+(?:\.\d+)?)%$/.exec(arg.trim());
  if (m) return { color: m[1].trim(), pct: +m[2] };
  return { color: arg.trim(), pct: 100 };
}
// 颜色 token -> CSS 表达式；outerAlpha 为外层再乘的不透明度
function colorToExpr(token, outerAlpha) {
  let m;
  if ((m = /^var\((--color-[a-z0-9-]+)\)$/i.exec(token.trim()))) {
    return `rgb(var(${m[1]}-rgb)/${fmtA(outerAlpha)})`;
  }
  // 嵌套转换结果：rgb(var(--x-rgb)/a) —— 合并 alpha
  if ((m = /^rgb\(var\((--color-[a-z0-9-]+)-rgb\)\/([\d.]+)\)$/i.exec(token.trim()))) {
    return `rgb(var(${m[1]}-rgb)/${fmtA(outerAlpha * +m[2])})`;
  }
  if ((m = /^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/i.exec(token.trim()))) {
    return `rgba(${m[1]},${m[2]},${m[3]},${fmtA(outerAlpha)})`;
  }
  if (/^currentcolor$/i.test(token.trim())) return 'currentColor';
  const rgb = parseColor(token);
  if (rgb) return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${fmtA(outerAlpha)})`;
  return token;
}
// 递归转换一个 color-mix(...) 表达式（可能嵌套）
function convertMixExpr(expr) {
  const open = expr.indexOf('(');
  const head = expr.slice(0, open).trim().toLowerCase();
  if (head !== 'color-mix') return expr; // 非 color-mix（如 var/rgb），原样
  const close = matchParen(expr, open);
  const inner = expr.slice(open + 1, close);
  const args = splitTopCommas(inner);
  // args[0] = in oklab；其余为颜色参数
  const colorArgs = args.slice(1).map(parseMixArg);
  // 先递归转换参数里嵌套的 color-mix
  colorArgs.forEach((a) => { if (/color-mix/i.test(a.color)) a.color = convertMixExpr(a.color); });
  // Tailwind 全部是「主色 P% + transparent」；若第二参数是 transparent，主色乘 P%
  const c1 = colorArgs[0], c2 = colorArgs[1];
  if (c2 && /^transparent$/i.test(c2.color)) return colorToExpr(c1.color, c1.pct / 100);
  if (c1 && /^transparent$/i.test(c1.color) && c2) return colorToExpr(c2.color, c2.pct / 100);
  // 两实色混合（理论上 Tailwind 不产生）：按比例插值需要静态值，这里退化为取 c1
  if (c1) return colorToExpr(c1.color, c1.pct / 100);
  return expr;
}
// 扫描整段文本，把所有 color-mix(...) 转换掉（从最外层逐个平衡提取）
function convertAllMix(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const k = s.toLowerCase().indexOf('color-mix', i);
    if (k < 0) { out += s.slice(i); break; }
    const paren = s.indexOf('(', k);
    if (paren < 0) { out += s.slice(i); break; }
    out += s.slice(i, k);
    const end = matchParen(s, paren);
    const expr = s.slice(k, end + 1);
    out += convertMixExpr(expr);
    i = end + 1;
  }
  return out;
}

// 1) 独立 oklch()/oklab() 字面量 -> hex
function convertLiterals(css) {
  return css.replace(/oklch\([^)]*\)|oklab\([^)]*\)/gi, (tok) => { const rgb = parseColor(tok); return rgb ? rgbHex(rgb) : tok; });
}
function matchBlockEnd(s, braceAt) {
  let depth = 0;
  for (let i = braceAt; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth === 0) return i; } }
  return s.length - 1;
}
// 2) :root/.dark 内为每个 --color-X 补 --color-X-rgb
function injectRgbChannelsV2(css) {
  let out = '', i = 0;
  const re = /:root\{|\.dark\{/g;
  let m, last = 0;
  while ((m = re.exec(css))) {
    out += css.slice(last, m.index);
    const brace = m.index + m[0].length - 1;
    const end = matchBlockEnd(css, brace);
    const body = css.slice(brace + 1, end);
    const nb = body.replace(/(--color-[a-z0-9-]+)\s*:\s*([^;}]+);/gi, (decl, name, val) => {
      if (/-rgb$/.test(name)) return decl;
      const rgb = parseColor(val);
      return rgb ? `${decl}${name}-rgb:${rgb[0]} ${rgb[1]} ${rgb[2]};` : decl;
    });
    out += css.slice(m.index, brace + 1) + nb;
    last = end;
    re.lastIndex = end;
  }
  out += css.slice(last);
  return out;
}
// 3) @supports(color-mix) 块：内部 color-mix 全部降级，去掉 @supports 包裹；嵌套 @supports 递归处理
function flattenSupports(css) {
  let out = '', i = 0;
  while (true) {
    const k = css.indexOf('@supports', i);
    if (k < 0) { out += css.slice(i); break; }
    out += css.slice(i, k);
    const brace = css.indexOf('{', k);
    const cond = css.slice(k + 9, brace).trim();
    const end = matchBlockEnd(css, brace);
    let body = css.slice(brace + 1, end);
    body = flattenSupports(body); // 先递归处理嵌套 @supports
    // 仅「正向支持 color-mix」的块才平铺降级；`@supports not (color-mix)` 是给老浏览器的
    // 静态回退，必须保留 @supports 包裹（否则会被无条件平铺、以高特异性干扰正常规则）
    const isPositiveColorMix = /color-mix/.test(cond) && !/\bnot\b/.test(cond);
    if (isPositiveColorMix) out += convertAllMix(body);
    else out += `@supports ${cond}{${body}}`;
    i = end + 1;
  }
  return out;
}

function processCss(css) {
  let s = convertLiterals(css);
  // 渐变插值空间声明（in oklab/oklch/lab）Chromium 108 会整条忽略，去掉后回退默认 srgb
  s = s.replace(/\s+in\s+(?:oklab|oklch|lab|srgb-linear)(?=\s*[;,}])/gi, '');
  s = flattenSupports(s);
  s = injectRgbChannelsV2(s);
  return s;
}
function processFile(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = processCss(before);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    const stat = {
      colorMixLeft: (after.match(/color-mix/gi) || []).length,
      oklchLeft: (after.match(/oklch\(/gi) || []).length,
      rgbChannels: (after.match(/--color-[a-z0-9-]+-rgb:/gi) || []).length,
    };
    console.log('[css-legacy]', path.basename(file), stat);
    return stat;
  }
  return null;
}
module.exports = { processCss, processFile };
if (require.main === module) process.argv.slice(2).forEach((f) => processFile(path.resolve(f)));
