import { ChatWindow } from '../components/ChatWindow';

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '2rem 1rem',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Lifecoach</h1>
        <p style={{ color: '#888', marginTop: 4, fontSize: 14 }}>
          Chat with a coach who remembers.
        </p>
      </header>
      <ChatWindow />
    </main>
  );
}
