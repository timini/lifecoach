import { ChatWindow } from '../../components/ChatWindow';

export default function ChatPage() {
  // ChatWindow renders its own shell (header + messages + form). The route
  // stays minimal so ChatWindow can own the full layout and any future
  // state-machine-driven chrome.
  return <ChatWindow />;
}
