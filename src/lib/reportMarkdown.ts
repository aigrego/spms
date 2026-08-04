/* 日报内容的 Markdown 规整（TKT-14）：MCP spms_submit_report 上报的纯文本日志
   统一转成简单 Markdown —— 已是 Markdown 结构（列表/标题/代码围栏）的行原样保留，
   其余非空行加 `- ` 前缀变成无序列表项，空行保留。
   UI 手写日报不经过这里（用户自己写 Markdown）。 */

const MD_LIST = /^(?:[-*+]|\d+[.)])\s+/;
const MD_HEADING = /^#{1,6}\s/;
const MD_FENCE = /^```/;

export function formatReportContent(content: string): string {
  let inFence = false;
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const t = line.trim();
      // 围栏行原样保留并翻转围栏状态；围栏内的行（含空行）一律不动。
      if (MD_FENCE.test(t)) {
        inFence = !inFence;
        return t;
      }
      if (inFence) return line;
      if (!t) return '';
      if (MD_LIST.test(t) || MD_HEADING.test(t)) return t;
      return `- ${t}`;
    })
    .join('\n');
}
