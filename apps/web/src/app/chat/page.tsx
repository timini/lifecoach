import { ChatWindow } from '../../components/ChatWindow';

export default function ChatPage() {
  // Keep the live coaching surface on a dedicated route so the homepage can
  // explain the product before starting an anonymous chat session.
  return <ChatWindow />;
}
