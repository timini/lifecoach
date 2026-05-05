import type * as React from 'react';
import { ChatShell } from '../organisms/chat-shell';

export interface SettingsPageTemplateProps {
  /** Title row, "Back to chat" link, optional saving indicator. */
  header: React.ReactNode;
  /** Tab strip (Connections / Practices / Profile / Goals / Account). */
  tabs: React.ReactNode;
  /** Active tab content. */
  children: React.ReactNode;
  /** Optional footer status line. */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Page-level skeleton for /settings. Reuses the ChatShell organism for the
 * header/body/footer chrome, with a dedicated `tabs` slot above the content
 * stream so each settings page renders the same sticky tab bar without
 * re-implementing it.
 */
export function SettingsPageTemplate({
  header,
  tabs,
  children,
  footer,
  className,
}: SettingsPageTemplateProps) {
  return (
    <ChatShell header={header} footer={footer ?? null} className={className}>
      {tabs}
      {children}
    </ChatShell>
  );
}
