# ADR 0001: Messaging Channel Add-on for Telegram and WhatsApp

- **Status:** Proposed
- **Date:** 2026-05-15
- **Deciders:** Product + Platform Engineering
- **Related systems:** `apps/web`, `apps/agent_py`, Firebase Auth, Firestore, Cloud Run, Secret Manager
- **Supersedes:** PRs #124, #125, #126, and #127

## Context

Lifecoach currently has one user-facing conversation surface: the browser calls `apps/web`, which proxies authenticated chat turns to `apps/agent_py`. The agent service owns identity verification, prompt assembly, model execution, tool/state-machine behavior, persistence, usage enforcement, memory, and streamed SSE responses back to web.

We want signed-in users to talk to the same coach from messaging apps such as Telegram and WhatsApp without forking coaching logic, duplicating profile state, weakening auth/privacy guarantees, or teaching the LLM provider-specific routing rules.

Messaging channels differ from web in ways that shape the architecture:

1. **Ingress identity differs.** Web requests carry Firebase identity; Telegram and WhatsApp arrive as provider webhooks with provider-scoped account, conversation, sender, and message identifiers.
2. **Responses are asynchronous.** Messaging providers do not consume browser SSE streams; outbound replies must be delivered through provider APIs after the webhook is acknowledged.
3. **Provider rules differ.** Telegram and WhatsApp have different webhook verification, retry, media, formatting, command, status-webhook, and policy constraints. WhatsApp also has customer-care-window and template-message requirements.
4. **Routing must be deterministic.** A user may have web open while messaging from Telegram or WhatsApp. The platform must record which route/session/channel owns each turn rather than guessing from text or “last active client”.
5. **Privacy risk is higher.** Provider account IDs, chat IDs, phone numbers, and raw payloads are personal data and must not leak into prompts, logs, support tools, or plain Firestore documents unnecessarily.

## Decision

Build messaging support as a separate **Messaging Channel Add-on** Cloud Run service, tentatively `apps/messaging`, in front of the existing agent. The add-on owns provider transport concerns and adapts provider webhooks into a shared internal channel contract. The existing agent remains the source of truth for coaching behavior, prompt/runtime logic, state machines, profile, goals, memory, usage, billing-tier enforcement, and session persistence.

Messaging traffic will use a new internal, non-SSE agent turn endpoint such as `POST /channel-turn` or `POST /internal/chat-turn`. This endpoint should reuse the same core turn runner as `/chat`, but return a complete structured assistant response that the messaging add-on can render into provider-native messages. Web traffic continues to use `/api/chat` and `/chat` SSE for low-latency browser streaming.

The add-on will be responsible for:

- accepting provider webhooks on dedicated provider routes;
- verifying webhook authenticity before parsing or storing trusted business content;
- normalizing provider payloads into canonical channel events;
- deduplicating provider events with collision-safe idempotency keys;
- resolving provider conversations to Lifecoach users, sessions, route records, and reply channels;
- invoking the agent through internal service authentication with explicit channel context;
- enqueueing outbound provider messages in a durable outbox;
- formatting and sending messages through Telegram Bot API and WhatsApp Cloud API adapters;
- recording route decisions, event state, delivery attempts, and failures for support/audit.

The LLM must not choose the delivery channel, see provider credentials, or receive raw phone numbers/chat IDs. It may receive bounded channel capabilities, such as whether the channel supports markdown, buttons, attachments, voice, and streaming.

## Architecture

```mermaid
flowchart LR
  subgraph Clients[User devices]
    Browser[Web browser]
    Telegram[Telegram]
    WhatsApp[WhatsApp]
  end

  subgraph Web[Cloud Run: apps/web]
    WebChat[/api/chat SSE]
    Settings[Settings / Connections]
  end

  subgraph Messaging[Cloud Run: apps/messaging]
    Webhooks[Provider webhook endpoints]
    Verify[Signature / secret verification]
    Normalize[Provider adapters]
    Idempotency[Idempotency + audit]
    Router[Conversation router]
    Renderer[Channel renderer]
    Outbox[Durable outbound outbox]
    Dispatcher[Delivery workers]
  end

  subgraph Agent[Cloud Run: apps/agent_py]
    Chat[/chat SSE]
    ChannelTurn[/channel-turn non-SSE]
    Runtime[Shared turn runner + tools + persistence]
  end

  subgraph Cloud[Google Cloud]
    Auth[Firebase Auth]
    Firestore[(Firestore)]
    Tasks[Cloud Tasks or Pub/Sub]
    Secrets[Secret Manager]
  end

  Browser -- Firebase ID token --> WebChat
  Browser --> Settings
  WebChat --> Chat
  Chat --> Runtime

  Telegram -- HTTPS webhook --> Webhooks
  WhatsApp -- HTTPS webhook --> Webhooks
  Webhooks --> Verify --> Normalize --> Idempotency --> Router
  Verify --> Secrets
  Router <--> Firestore
  Router -- service-to-service IAM + channel context --> ChannelTurn
  ChannelTurn --> Runtime
  Runtime <--> Firestore
  ChannelTurn -- assistant response envelope --> Router
  Router --> Renderer --> Outbox --> Tasks --> Dispatcher
  Dispatcher --> Secrets
  Dispatcher --> Telegram
  Dispatcher --> WhatsApp
  Dispatcher --> Firestore
```

## Component boundaries

| Component | Responsibilities | Must not do |
| --- | --- | --- |
| `apps/web` | Browser UI, Firebase-authenticated web chat proxy, SSE delivery, channel-linking settings UI, disconnect controls. | Parse provider webhooks, own provider account secrets, or decide messenger delivery from text. |
| `apps/messaging` | Webhook verification, provider adapters, route lookup, account linking, idempotency, outbox queueing, provider send APIs, provider status events. | Build prompts, bypass usage policy, store long-lived tokens in Firestore, or make coaching decisions. |
| `apps/agent_py` | Channel-agnostic turn runtime, state machines, prompt assembly, model calls, tools, persistence, usage enforcement. | Verify Telegram/WhatsApp signatures, call provider send APIs, or store raw provider identifiers in prompts. |
| Firestore | Channel accounts, links, routes, event/idempotency rows, outbound status, redacted audit metadata. | Store provider access tokens or raw unredacted provider payloads indefinitely. |
| Secret Manager | Bot tokens, webhook verify tokens, WhatsApp app secrets/access tokens, internal signing material. | Store conversation content or user routing preferences. |

## Canonical channel contract

Every provider adapter should normalize inbound and outbound work into a canonical envelope before routing:

```ts
type Channel = "web" | "telegram" | "whatsapp";

type ChannelMessage = {
  channel: Channel;
  direction: "inbound" | "outbound";

  // Provider tenant/account that received or will send the message.
  // Examples: Telegram bot id, WhatsApp phone_number_id.
  providerTenantId: string;

  // Provider-scoped conversation target.
  // Examples: Telegram chat.id, WhatsApp wa_id or conversation key.
  externalConversationId: string;

  // Provider event/message/update identifier, if present.
  externalMessageId: string;

  uid?: string;
  sessionId?: string;
  routeId?: string;
  text?: string;
  media?: Array<{
    kind: "image" | "audio" | "voice" | "document" | "location" | "contact" | "unknown";
    providerMediaId: string;
    mimeType?: string;
  }>;
  receivedAt: string;
  providerPayloadRef?: string;
};
```

The agent receives a smaller `channelContext`, not raw provider identity:

```ts
type ChannelContext = {
  channel: Channel;
  routeId?: string;
  inboundEventId?: string;
  capabilities: {
    markdown: boolean;
    buttons: boolean;
    attachments: boolean;
    images: boolean;
    voice: boolean;
    streaming: boolean;
  };
  locale?: string;
  timezone?: string;
};
```

## Firestore model

Implementation can adjust collection names, but it must preserve these invariants.

| Collection | Suggested key | Purpose |
| --- | --- | --- |
| `messagingAccounts/{accountId}` | Stable internal account id | Provider account/tenant metadata, environment, display name, enabled status, and Secret Manager references. |
| `channelLinkCodes/{codeHash}` | Hash of short-lived code/nonce | One-time link codes for web-first and messenger-first linking. |
| `channelLinks/{linkId}` | Hash of `(channel, providerTenantId, externalConversationId)` | Verified binding between a provider conversation and a Firebase UID. |
| `conversationRoutes/{routeId}` | Stable encoded `(channel, providerTenantId, externalConversationId)` | Deterministic route from provider conversation to `uid`, `sessionId`, route status, and preferred reply behavior. |
| `channelEvents/{eventId}` | Hash of `(channel, providerTenantId, externalConversationId, providerEventId)` | Idempotency and audit trail for inbound/outbound provider events. |
| `messageOutbox/{outboxId}` | Generated delivery job id | Durable provider delivery task with payload, attempts, next retry, provider response ids, and final status. |

Idempotency keys must include both provider tenant/account and conversation scope. This addresses the review feedback from the superseded PRs: keys such as `{provider}:{provider_event_id}`, `channelEvents/{channel}/{providerEventId}`, or `hash(channel + providerTenantId + externalMessageId)` are unsafe because provider IDs can collide across tenants and Telegram `message_id` is only unique within a chat. Telegram inbound idempotency should prefer `update_id` when available; if a provider event id is only conversation-scoped, the idempotency key must include `externalConversationId`.

Raw provider payloads may be retained only as redacted, short-lived audit/debug records with an explicit retention policy. Lookup identifiers should be hashed; delivery targets that must be reversible should be encrypted or otherwise protected according to the platform's secrets/privacy model.

## Routing model

Routing is based on explicit records, never on LLM instructions or client-side heuristics.

### Web routing

1. Browser obtains a Firebase ID token.
2. `apps/web` proxies `/api/chat` to `apps/agent_py` with the bearer token.
3. The agent verifies the token and resolves the Firebase UID.
4. The request carries `channel = "web"` and a web session id.
5. Replies stream back on the same SSE connection.

### Messenger routing

1. Provider posts a webhook to a dedicated route such as `/messaging/webhooks/telegram` or `/messaging/webhooks/whatsapp`.
2. `apps/messaging` verifies authenticity:
   - Telegram: validate the configured webhook secret token and deduplicate by `update_id` where available.
   - WhatsApp: support setup challenge verification, validate `x-hub-signature-256`, and deduplicate by a tenant/conversation-scoped event/message key.
3. The provider adapter extracts `(channel, providerTenantId, externalConversationId, externalMessageId)` and normalizes content.
4. The add-on calculates a collision-safe idempotency key and records/claims the event before invoking the agent.
5. The router reads `conversationRoutes/{routeId}` and `channelLinks/{linkId}`.
6. If the route is active and linked, the router resolves `uid`, `sessionId`, capabilities, locale/timezone hints, and reply channel.
7. If the route is missing, revoked, disabled, or unverified, the router does not invoke the agent. It sends a safe linking/help response or no-ops according to provider policy and records the ignored event.
8. The add-on calls the agent's internal non-SSE endpoint with service-to-service auth and `channelContext`.
9. The agent response is persisted by the agent/runtime and returned to the add-on as structured assistant output.
10. The add-on renders the response for the provider and writes `messageOutbox/{outboxId}` for asynchronous delivery.

### Session policy

The first implementation should use per-channel sessions by default, for example `{uid}:{channel}:{routeId}:{YYYY-MM-DD}` or another deterministic route-scoped scheme, while still sharing profile, goals, memory, workspace state, and usage metering through the same UID. This avoids surprising cross-channel race conditions while preserving continuity at the user-memory layer.

A future product iteration may expose messenger turns in the web session drawer with channel badges. The session/event records should therefore store `originatingChannel`, `routeId`, and outbound delivery metadata from the start.

### Outbound routing precedence

Replies to a turn should return to the channel that produced that turn unless provider policy prevents delivery.

Recommended precedence:

1. **Turn affinity:** reply through the inbound route that produced the current turn.
2. **Explicit user choice:** settings-page preferences or trusted commands such as `/use telegram`, `/use whatsapp`, or `/disconnect` update route records before affecting routing.
3. **Provider constraints:** WhatsApp replies outside the allowed customer-care window require approved templates or must fall back/no-op according to consent and policy.
4. **Fallback:** if delivery fails permanently, use the route's configured fallback such as web notification or no delivery.

The platform must not infer delivery from user text such as “send this to WhatsApp” until an application action has persisted the routing preference.

## Linking and revocation

Use web as the primary control plane because it already has Firebase Auth, account settings, billing/profile affordances, and privacy disclosures.

### Web-first linking

1. Signed-in user opens Settings → Connections or Settings → Messaging.
2. User selects Telegram or WhatsApp.
3. Web creates a short-lived, single-use `channelLinkCodes/{codeHash}` with `uid`, channel, expiry, nonce, and requested provider tenant.
4. UI shows a provider-specific deep link, QR code, or click-to-chat link containing the code.
5. User sends `/start <code>` or a prefilled connect phrase in the provider app.
6. `apps/messaging` verifies the webhook, consumes the nonce transactionally, creates/activates `channelLinks` and `conversationRoutes`, and sends confirmation.

### Messenger-first linking

1. Unknown sender messages the bot/account.
2. The add-on verifies the webhook and replies with a one-time HTTPS link to sign in on web.
3. User signs in with Firebase Auth.
4. Web consumes the nonce and attaches the provider conversation to the signed-in UID.
5. Provider receives confirmation.

The first release should not create durable coaching profiles from arbitrary phone numbers or chat IDs. A limited anonymous trial can be reconsidered later, but linking before coaching is the safer default.

### Revocation

Users must be able to disconnect from web settings and through provider commands such as `/disconnect`. Revocation marks the link/route revoked or disabled, stops pending outbox delivery for that route, retains historical audit records according to retention policy, and requires a fresh nonce to reconnect.

## Provider-specific handling

### Telegram

- Use Bot API webhooks over HTTPS.
- Validate the `X-Telegram-Bot-Api-Secret-Token` configured by `setWebhook`.
- Prefer `update_id` for inbound idempotency; if using `message_id`, include chat/conversation scope because message IDs are only unique within a chat.
- Treat `chat.id` and user identifiers as external personal data scoped to a bot account.
- Support `/start`, `/help`, `/settings`, and `/disconnect` commands.
- Telegram is the preferred MVP provider because session initiation and bot interactions are simpler than WhatsApp policy flows.

### WhatsApp

- Use WhatsApp Cloud API webhooks and Meta Graph webhook challenge verification.
- Validate POST signatures with `x-hub-signature-256` before trusting payload fields.
- Scope sender IDs by business phone number / `phone_number_id`.
- Respect customer-care windows and template-message requirements.
- Do not send proactive coaching nudges unless the user has explicitly opted in and the message type is policy-compliant.
- Store only the minimum phone/account identifiers required for routing; hash for lookup and protect delivery targets.

## Outbound delivery and rendering

Outbound provider sends must be asynchronous:

1. Agent returns a normalized assistant response envelope.
2. `apps/messaging` renders provider-appropriate text, buttons, media, and deep links.
3. The add-on writes `messageOutbox/{outboxId}`.
4. Cloud Tasks or Pub/Sub invokes delivery workers.
5. Delivery workers call provider APIs, record provider response ids, and update retry/failure state.

The outbox prevents provider downtime or rate limits from rerunning agent turns. It also separates “agent completed” from “provider delivery completed” in observability.

Rich web UI directives, such as choice prompts or connection prompts, should degrade to channel-native buttons when supported or to short text plus signed deep links back to web.

## Security, privacy, and compliance

- Verify every webhook before parsing business content or claiming idempotency rows.
- Use Cloud Run service-to-service IAM for `apps/messaging → apps/agent_py` calls.
- Keep provider credentials and access tokens in Secret Manager, not Firestore.
- Never send provider tokens, raw provider payloads, phone numbers, chat IDs, or webhook signatures to the agent/LLM.
- Re-check usage tier and product policy inside the agent for every turn; messaging must not bypass billing or safety policy.
- Use Firestore transactions for nonce consumption, route creation, and idempotency claims.
- Redact raw provider payloads in logs and retain debug payloads only with short TTLs.
- Support tooling should show route decisions, event status, and failure reasons without exposing raw phone/chat identifiers by default.

## Failure handling

| Failure | Handling |
| --- | --- |
| Duplicate webhook | Return 2xx after idempotency hit; do not rerun the agent. |
| Idempotency collision risk | Key by channel, provider tenant/account, conversation, and event/message id; prefer provider-global ids where available. |
| Webhook verification fails | Return 401/403 and emit a security metric; do not write a user event. |
| Missing or revoked route | Send linking/help copy if allowed, otherwise record `ignored`; do not invoke the agent. |
| Link nonce expired/consumed | Reject link transactionally and send a fresh-link instruction. |
| Agent timeout | Acknowledge provider webhook, record failure, optionally enqueue product-approved “still working”/failure copy, and alert after threshold. |
| Provider transient delivery failure | Retry from outbox with backoff and provider-aware rate limiting. |
| Provider permanent delivery failure | Mark route/channel degraded and apply configured fallback. |
| User disconnects mid-turn | Cancel or skip pending outbox items for the revoked route before delivery. |
| Unsupported media/input | Store an audit event and send a channel-safe explanation or web deep link. |

## Rollout plan

1. **Contracts and schemas:** define `ChannelMessage`, `ChannelContext`, route/link/event/outbox records, collision-safe idempotency helpers, and test fixtures.
2. **Agent endpoint:** factor the existing chat turn runner and add an internal non-SSE channel-turn endpoint with service auth.
3. **Telegram MVP:** implement webhook verification, web-first linking, deterministic routing, text-only turns, outbox delivery, `/disconnect`, and route/audit views.
4. **Settings UX:** add web settings for connect, disconnect, fallback channel, and visibility into linked channels.
5. **Observability:** add route-decision logs, idempotency metrics, delivery dashboards, channel health, and support-safe identifiers.
6. **WhatsApp:** implement Cloud API verification, tenant-scoped routing, templates/onboarding copy, care-window handling, compliance review, and delivery status webhooks.
7. **Richer inputs:** add images, voice notes, location, contacts, and richer prompt rendering only after text routing is stable.
8. **Proactive messaging:** evaluate only after consent, quiet hours, fallback, opt-out, and provider policy controls exist.

## Alternatives considered

### Add provider webhooks to `apps/web`

Rejected. The web app should remain a browser UI and authenticated web-chat proxy. Provider secrets, webhook verification, asynchronous outbox workers, retry logic, and provider adapters would make it a backend integration service and couple messaging deploy risk to web UI deploys.

### Add provider webhooks directly to `apps/agent_py`

Rejected. This would mix provider transport with coaching/runtime concerns, encourage provider-specific branching in prompt/tool logic, and increase the risk of exposing provider credentials or raw identifiers to the LLM-facing service.

### Use a third-party omnichannel inbox first

Deferred. A broker may help later, especially for WhatsApp operations, but Lifecoach still needs canonical route records, identity linking, idempotency, consent, audit, and agent contracts. Starting with a minimal owned gateway keeps the domain model explicit.

### Route replies to the last active channel

Rejected. It is surprising, hard to audit, and unsafe for private coaching content. Turn affinity plus explicit route preferences are more predictable.

### Share one global session across all channels by default

Deferred. Shared memory/profile is valuable, but a hidden global transport session can create race conditions and confusing history. Per-channel sessions with shared user memory are safer for v1.

## Consequences

### Positive

- Preserves the current web SSE experience while adding asynchronous messaging channels.
- Keeps the agent focused on coaching behavior and platform policy.
- Provides deterministic, explainable, supportable routing.
- Makes Telegram, WhatsApp, and future channels share route/idempotency/outbox primitives.
- Isolates provider downtime, retries, rate limits, and policy constraints from model execution.
- Addresses idempotency collision risks before implementation.

### Negative / trade-offs

- Adds a new deployable service, Firestore records, outbox infrastructure, and support tooling.
- Requires a new internal non-SSE agent contract.
- Makes local development more complex because provider webhooks need tunnels, fixtures, or replay tools.
- Requires product decisions for WhatsApp templates, media support, cross-channel history, and fallback notifications.
- Introduces additional privacy/compliance obligations for provider identifiers and payload retention.

## Open questions

1. Should any anonymous messenger trial exist, or must every coaching turn require a linked Firebase user?
2. What exact per-channel session id format should be used for v1?
3. How much messenger history should appear in the web session drawer, and should updates be real-time or refresh-based?
4. Which WhatsApp templates are required for onboarding, re-engagement, failures, and out-of-window replies?
5. Which fallback should apply when WhatsApp delivery is blocked: web notification, email, no-op, or template message?
6. Which media types should v1 support after text: images, voice notes, documents, contacts, or location?
7. What TTLs should apply to redacted raw payloads, channel events, and failed outbox jobs?
8. Should route preferences be per user, per session, per provider route, or a combination?
