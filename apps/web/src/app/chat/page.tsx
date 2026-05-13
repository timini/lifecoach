import { ChatWindow } from '../../components/ChatWindow';

type ChatPageProps = {
  searchParams: Promise<{ prompt?: string | string[] }>;
};

// `searchParams.prompt` is set by the marketing/SEO funnel CTAs
// (`/how-it-helps/[topic]` → "Start this conversation"). Reading it here
// keeps ChatWindow URL-agnostic and avoids a Suspense wrapper for
// useSearchParams in the client tree. ChatWindow seeds its composer
// with the prompt so the user can adjust before sending — we don't
// auto-submit, because the user came from a static SEO page and the
// chat needs to spin up an anonymous Firebase session first.
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const raw = params.prompt;
  const initialPrompt = Array.isArray(raw) ? raw[0] : raw;
  return <ChatWindow initialPrompt={initialPrompt} />;
}
