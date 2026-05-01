import type * as React from 'react';
import { ChatShell } from '../organisms/chat-shell';

export interface ChatPageTemplateProps {
  /** Title row + AccountMenu / SessionsDrawerTrigger / LocationBadge live here. */
  header: React.ReactNode;
  /** Stream of bubbles + tool-call badges + auth/workspace/upgrade prompts. */
  children: React.ReactNode;
  /** ChatComposer (Input + send IconButton) or starter cards / "Back to today". */
  footer: React.ReactNode;
  /** Optional drawer/dialog mounted alongside the page (SessionsDrawer slot). */
  drawer?: React.ReactNode;
  className?: string;
}

/**
 * Page-level skeleton for the chat surface. Composes the ChatShell organism
 * with explicit slots so the consuming page only needs to wire data — not
 * spacing, sticky-positioning, or backdrop-blur.
 */
export function ChatPageTemplate({
  header,
  children,
  footer,
  drawer,
  className,
}: ChatPageTemplateProps) {
  return (
    <>
      {drawer}
      <ChatShell header={header} footer={footer} className={className}>
        {children}
      </ChatShell>
    </>
  );
}
