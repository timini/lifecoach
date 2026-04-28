'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';

export interface MarkdownProps {
  /** The raw markdown source. */
  children: string;
  className?: string;
}

/**
 * Inline markdown renderer for assistant chat bubbles. Supports GFM
 * (lists, tables, strikethrough, autolinks). Plays nice with our dark
 * theme — overrides whitespace-pre-wrap from the parent Bubble so
 * paragraph breaks render correctly instead of as extra blank lines.
 *
 * Intentionally narrow component set: anything the coach actually
 * uses in conversational replies. Code blocks, lists, bold, italics,
 * links — yes. Headings exist but are styled small (the coach is
 * texting, not writing an article). HTML in markdown is sanitised by
 * react-markdown's default skipHtml.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('whitespace-normal', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: c }) => <p className="my-2 first:mt-0 last:mb-0">{c}</p>,
          strong: ({ children: c }) => <strong className="font-semibold">{c}</strong>,
          em: ({ children: c }) => <em className="italic">{c}</em>,
          a: ({ href, children: c }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:text-accent/80"
            >
              {c}
            </a>
          ),
          ul: ({ children: c }) => <ul className="my-2 list-disc pl-5 space-y-1">{c}</ul>,
          ol: ({ children: c }) => <ol className="my-2 list-decimal pl-5 space-y-1">{c}</ol>,
          li: ({ children: c }) => <li className="leading-relaxed">{c}</li>,
          code: ({ children: c, ...props }) => {
            const inline = !('data-language' in (props as Record<string, unknown>));
            return inline ? (
              <code className="rounded bg-background/60 px-1 py-0.5 text-[13px] font-mono">
                {c}
              </code>
            ) : (
              <code className="font-mono text-[13px]">{c}</code>
            );
          },
          pre: ({ children: c }) => (
            <pre className="my-2 overflow-x-auto rounded bg-background/60 p-3 text-[13px]">{c}</pre>
          ),
          h1: ({ children: c }) => <h1 className="my-2 text-base font-semibold">{c}</h1>,
          h2: ({ children: c }) => <h2 className="my-2 text-base font-semibold">{c}</h2>,
          h3: ({ children: c }) => <h3 className="my-2 text-[15px] font-semibold">{c}</h3>,
          blockquote: ({ children: c }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
              {c}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
