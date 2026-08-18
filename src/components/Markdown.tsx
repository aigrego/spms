'use client';

import * as React from 'react';

/* Minimal markdown renderer for issue descriptions and comments. Supports:
   fenced code blocks, inline code, bold, italic, strikethrough, links,
   images (pasted comment attachments — TKT-36), headings (#–####),
   unordered/ordered lists, and soft line breaks.
   Everything is emitted as React nodes (no innerHTML), so raw HTML in the
   source is inert by construction. */

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function renderInline(text: string, depth = 0): React.ReactNode[] {
  if (depth > 3) return [text];
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = n++;
    const [tok, code, bold, italic, strike, imgAlt, imgUrl, linkLabel, linkUrl] = m;
    if (code) {
      out.push(
        <code key={key} className="rounded bg-surface-sunken px-1 py-px font-mono text-[0.88em]">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      out.push(
        <strong key={key} className="font-semibold">
          {renderInline(bold.slice(2, -2), depth + 1)}
        </strong>,
      );
    } else if (italic) {
      out.push(<em key={key}>{renderInline(italic.slice(1, -1), depth + 1)}</em>);
    } else if (strike) {
      out.push(<s key={key}>{renderInline(strike.slice(2, -2), depth + 1)}</s>);
    } else if (imgUrl) {
      out.push(
        <img
          key={key}
          src={imgUrl}
          alt={imgAlt}
          className="my-1 block max-h-56 max-w-full rounded-[8px] border border-border"
        />,
      );
    } else {
      out.push(
        <a key={key} href={linkUrl} target="_blank" rel="noreferrer" className="text-brand-blue hover:underline">
          {linkLabel}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST_UL = /^\s*[-*]\s+/;
const LIST_OL = /^\s*\d+\.\s+/;
const HEADING = /^(#{1,4})\s+/;
const FENCE = /^```/;

function isSpecial(line: string) {
  return FENCE.test(line) || HEADING.test(line) || LIST_UL.test(line) || LIST_OL.test(line);
}

function renderBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (FENCE.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // skip closing fence (or run off the end)
      out.push(
        <pre
          key={n++}
          className="my-2 overflow-x-auto whitespace-pre rounded-[8px] bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed text-fg-1"
        >
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const big = heading[1].length <= 2;
      out.push(
        <div
          key={n++}
          className={
            big
              ? 'mb-1 mt-3 text-[15px] font-semibold text-fg-1 first:mt-0'
              : 'mb-1 mt-2 text-[13.5px] font-semibold text-fg-1 first:mt-0'
          }
        >
          {renderInline(heading[2])}
        </div>,
      );
      i++;
      continue;
    }

    if (LIST_UL.test(line) || LIST_OL.test(line)) {
      const ordered = LIST_OL.test(line);
      const re = ordered ? LIST_OL : LIST_UL;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={n++} className={`my-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, k) => (
            <li key={k}>{renderInline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // paragraph: consecutive plain lines, soft-wrapped like GitHub comments
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isSpecial(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(
      <p key={n++} className="my-1 first:mt-0 last:mb-0">
        {para.map((l, k) => (
          <React.Fragment key={k}>
            {k > 0 && <br />}
            {renderInline(l)}
          </React.Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => renderBlocks(text), [text]);
  return <div className={className}>{blocks}</div>;
}
