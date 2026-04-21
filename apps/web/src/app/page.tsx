import { ChatWindow } from '../components/ChatWindow';

export default function HomePage() {
  // ChatWindow renders its own shell (header + messages + form). Page.tsx
  // stays minimal so ChatWindow can own the full layout and any future
  // state-machine-driven chrome.
  return <ChatWindow />;
}
