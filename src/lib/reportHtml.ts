/* 日报汇总复制的富文本(HTML)一侧:飞书/Lark 粘贴时优先读 text/html,
   嵌套 <ol> 会渲染成 1. / a. / i. 的富文本序号,<b>/<code>/<a> 同步转换。
   这里只做最小 markdown → HTML 转换,与 components/Markdown.tsx 的行内模式保持一致。 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 与 Markdown.tsx 的 INLINE_RE 同款行内模式(先整体转义,再在转义后的文本上替换)。 */
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function inlineToHtml(text: string, depth = 0): string {
  if (depth > 3) return escapeHtml(text);
  const src = escapeHtml(text);
  let out = '';
  let last = 0;
  for (const m of src.matchAll(INLINE_RE)) {
    out += src.slice(last, m.index);
    const [tok, code, bold, italic, strike, linkLabel, linkUrl] = m;
    if (code) {
      out += `<code>${code.slice(1, -1)}</code>`;
    } else if (bold) {
      out += `<b>${inlineToHtml(bold.slice(2, -2), depth + 1)}</b>`;
    } else if (italic) {
      out += `<i>${inlineToHtml(italic.slice(1, -1), depth + 1)}</i>`;
    } else if (strike) {
      out += `<s>${inlineToHtml(strike.slice(2, -2), depth + 1)}</s>`;
    } else {
      out += `<a href="${linkUrl}">${linkLabel}</a>`;
    }
    last = m.index + tok.length;
  }
  out += src.slice(last);
  return out;
}

/* 行首列表标记:与 ReportsView.toTaskLines 同口径(- / * / • / 1. / a. 等)。 */
const MARKER_RE = /^(?:\d+[.、)]|[a-zA-Z][.)]|[-*•·])\s*/;

type Item = { depth: number; html: string };

/* entry content → 嵌套 <ol> 字符串:每个非空行一个 <li>。
   缩进按"出现过的缩进宽度栈"折算成相对层级(2 空格或 4 空格一级都适用),
   未见过的新浅缩进收编为顶层;深度上限 3。不做围栏代码块等复杂块级语法。 */
export function contentToHtmlList(content: string): string {
  const items: Item[] = [];
  const levels: number[] = [];
  for (const raw of content.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)![0].length;
    const text = raw.trim().replace(MARKER_RE, '');
    if (!text) continue;
    let depth = levels.lastIndexOf(indent);
    if (depth === -1) {
      if (levels.length === 0 || indent > levels[levels.length - 1]) {
        levels.push(indent);
        depth = levels.length - 1;
      } else {
        levels.length = 0;
        levels.push(indent);
        depth = 0;
      }
    } else {
      levels.length = depth + 1;
    }
    items.push({ depth: Math.min(depth, 3), html: inlineToHtml(text) });
  }
  if (items.length === 0) return '';

  /* 栈式组装:cur = 当前已打开的列表深度(0 = 顶层 <ol>)。 */
  let out = '<ol>';
  let cur = 0;
  let openLi = false;
  for (const it of items) {
    if (it.depth > cur) {
      /* 进入更深一层:嵌套 <ol> 挂在上一个 <li> 内。 */
      while (it.depth > cur) {
        out += '<ol>';
        cur++;
      }
      out += `<li>${it.html}`;
      openLi = true;
    } else {
      if (openLi) out += '</li>';
      while (it.depth < cur) {
        out += '</ol></li>';
        cur--;
      }
      out += `<li>${it.html}`;
      openLi = true;
    }
  }
  if (openLi) out += '</li>';
  while (cur > 0) {
    out += '</ol></li>';
    cur--;
  }
  out += '</ol>';
  return out;
}
