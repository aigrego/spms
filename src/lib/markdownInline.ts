/* 行内 markdown 匹配模式的唯一来源(TKT-255):React 渲染侧(components/Markdown.tsx)
   与飞书/Lark 粘贴 HTML 侧(lib/reportHtml.ts)由此拼装各自的 INLINE_RE,替代原来
   两处人肉同步的拷贝。两侧的链接/图片口径差异(粘贴侧不转图片、链接仅收绝对
   http(s) URL)保留在各自调用处。 */

/* 两侧完全一致的四个行内 token:`code`、**bold**、*italic*、~~strike~~。 */
const INLINE_TOKENS = ['(`[^`\\n]+`)', '(\\*\\*[^*\\n]+\\*\\*)', '(\\*[^*\\n]+\\*)', '(~~[^~\\n]+~~)'];

/* 拼装行内模式:共享 token 在前,各侧的链接/图片分支按 alternation 顺序跟在后。 */
export function inlineMarkdownRe(...extraBranches: string[]): RegExp {
  return new RegExp([...INLINE_TOKENS, ...extraBranches].join('|'), 'g');
}
