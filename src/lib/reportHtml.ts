/* 日报汇总复制的富文本(HTML)一侧:飞书/Lark 粘贴时优先读 text/html。
   分组的成员/产品层级用嵌套 <ol>(渲染为 1. / a. / i. 富文本序号);
   任务内容里带列表标记的行编成嵌套 <ul>(保留多层级条目,TKT-29),
   无标记的标题/段落行输出 <p>;<b>/<code>/<a> 同步转换。
   这里只做最小 markdown → HTML 转换,与 components/Markdown.tsx 的行内模式保持一致。 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 与 Markdown.tsx 的 INLINE_RE 同款行内模式(先整体转义,再在转义后的文本上替换)。 */
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/* src 必须是已转义的文本:递归下钻时片段已随外层转义过,不能再 escape 一遍。 */
function inlineEscapedToHtml(src: string, depth: number): string {
  if (depth > 3) return src;
  let out = '';
  let last = 0;
  for (const m of src.matchAll(INLINE_RE)) {
    out += src.slice(last, m.index);
    const [tok, code, bold, italic, strike, linkLabel, linkUrl] = m;
    if (code) {
      out += `<code>${code.slice(1, -1)}</code>`;
    } else if (bold) {
      out += `<b>${inlineEscapedToHtml(bold.slice(2, -2), depth + 1)}</b>`;
    } else if (italic) {
      out += `<i>${inlineEscapedToHtml(italic.slice(1, -1), depth + 1)}</i>`;
    } else if (strike) {
      out += `<s>${inlineEscapedToHtml(strike.slice(2, -2), depth + 1)}</s>`;
    } else {
      out += `<a href="${linkUrl}">${linkLabel}</a>`;
    }
    last = m.index + tok.length;
  }
  out += src.slice(last);
  return out;
}

export function inlineToHtml(text: string): string {
  return inlineEscapedToHtml(escapeHtml(text), 0);
}

/* 行首列表标记:与 Markdown.tsx 渲染口径一致(- / * / • / 1. / a. 等)。
   标记后必须跟空白,避免 `**加粗**` 行被吃掉一个 `*`(TKT-29)。 */
const MARKER_RE = /^(?:\d+[.、)]|[a-zA-Z][.)]|[-*•·])\s+/;

/* ATX 标题(# 到 ######,井号后必须跟空白)。 */
const HEADING_RE = /^(#{1,6})\s+/;

export type ContentLine = { list: boolean; depth: number; text: string; heading?: number };

/* entry content → 结构化行(TKT-29):带列表标记的行是「列表项」,按"出现过的缩进
   宽度栈"折算相对层级(2 空格或 4 空格一级都适用),未见过的新浅缩进收编为顶层,
   深度上限 3;ATX 标题行是「标题行」(去掉 # 前缀,记录层级);其余无标记行是
   「段落行」。标题/段落行会重置缩进层级栈。空行跳过;不做围栏代码块等复杂块级语法。 */
export function parseContentLines(content: string): ContentLine[] {
  const out: ContentLine[] = [];
  const levels: number[] = [];
  for (const raw of content.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    const h = t.match(HEADING_RE);
    if (h) {
      levels.length = 0;
      out.push({ list: false, depth: 0, heading: Math.min(h[1].length, 4), text: t.slice(h[0].length) });
      continue;
    }
    if (!MARKER_RE.test(t)) {
      levels.length = 0;
      out.push({ list: false, depth: 0, text: t });
      continue;
    }
    const text = t.replace(MARKER_RE, '');
    if (!text) continue;
    const indent = raw.match(/^ */)![0].length;
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
    out.push({ list: true, depth: Math.min(depth, 3), text });
  }
  return out;
}

/* entry content → HTML 片段:连续列表项编成嵌套 <ul>(缩进层级保留,粘贴进飞书
   后多级条目仍为多级);标题行输出加粗 <p>(不用 h 标签:IM 粘贴兼容性更好,
   与分组名的 `<p><b>` 一致);段落行输出 <p>,都不并入列表编号。 */
export function contentToHtmlList(content: string): string {
  let out = '';
  let openUls = 0; // 当前打开的 <ul> 层数;嵌套 <ul> 挂在上一层未闭合的 <li> 内
  let openLi = false;
  const closeLists = () => {
    if (openLi) {
      out += '</li>';
      openLi = false;
    }
    while (openUls > 0) {
      out += '</ul>';
      openUls--;
      if (openUls > 0) out += '</li>';
    }
  };
  for (const ln of parseContentLines(content)) {
    if (!ln.list) {
      closeLists();
      out += ln.heading ? `<p><b>${inlineToHtml(ln.text)}</b></p>` : `<p>${inlineToHtml(ln.text)}</p>`;
      continue;
    }
    const target = ln.depth + 1;
    if (target > openUls) {
      while (openUls < target) {
        out += '<ul>';
        openUls++;
      }
    } else {
      if (openLi) out += '</li>';
      while (openUls > target) {
        out += '</ul></li>';
        openUls--;
      }
      openLi = false;
    }
    out += `<li>${inlineToHtml(ln.text)}`;
    openLi = true;
  }
  closeLists();
  return out;
}
