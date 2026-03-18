import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { MessageType } from "../types";
import type { UIMessage as ChatMessage } from "ai";
import { connectChatWS, isUseChatResponseMessage } from "./test-utils";
import { getAgentByName } from "agents";

/**
 * Helper: connect to the StartEventAgent
 */
function connectStartEvent(room: string) {
  return connectChatWS(`/agents/start-event-agent/${room}`);
}

/**
 * Helper: send a chat request
 */
function sendChatRequest(
  ws: WebSocket,
  requestId: string,
  messages: ChatMessage[]
) {
  ws.send(
    JSON.stringify({
      type: MessageType.CF_AGENT_USE_CHAT_REQUEST,
      id: requestId,
      init: {
        method: "POST",
        body: JSON.stringify({ messages })
      }
    })
  );
}

/**
 * Helper: collect messages from a WebSocket until a done message arrives or timeout
 */
function collectMessages(
  ws: WebSocket,
  timeoutMs = 5000
): Promise<{ messages: unknown[]; timedOut: boolean }> {
  const messages: unknown[] = [];
  let resolve: (value: { messages: unknown[]; timedOut: boolean }) => void;
  const promise = new Promise<{ messages: unknown[]; timedOut: boolean }>(
    (r) => {
      resolve = r;
    }
  );

  const timeout = setTimeout(() => {
    ws.removeEventListener("message", handler);
    resolve({ messages, timedOut: true });
  }, timeoutMs);

  function handler(e: MessageEvent) {
    const data = JSON.parse(e.data as string);
    messages.push(data);
    if (isUseChatResponseMessage(data) && data.done) {
      clearTimeout(timeout);
      ws.removeEventListener("message", handler);
      resolve({ messages, timedOut: false });
    }
  }

  ws.addEventListener("message", handler);
  return promise;
}

const userMessage: ChatMessage = {
  id: "user-msg-1",
  role: "user",
  parts: [{ type: "text", text: "Hello" }]
};

describe("Duplicate assistant message bug", () => {
  it("should persist only ONE assistant message when server returns SSE with start event messageId", async () => {
    const room = crypto.randomUUID();
    const { ws } = await connectStartEvent(room);
    await new Promise((r) => setTimeout(r, 50));

    const requestId = "req-start-event";

    // Start collecting messages
    const collecting = collectMessages(ws);

    // Send a user message
    sendChatRequest(ws, requestId, [userMessage]);

    // Wait for streaming to complete
    const { timedOut } = await collecting;
    expect(timedOut).toBe(false);

    // Give a bit of time for persistence to complete
    await new Promise((r) => setTimeout(r, 100));

    // Check persisted messages via the agent stub
    const agentStub = await getAgentByName(env.StartEventAgent, room);
    const persistedMessages = await agentStub.getPersistedMessages();

    // Should have exactly 1 user message and 1 assistant message
    const userMessages = persistedMessages.filter(
      (m: ChatMessage) => m.role === "user"
    );
    const assistantMessages = persistedMessages.filter(
      (m: ChatMessage) => m.role === "assistant"
    );

    expect(userMessages.length).toBe(1);
    // This is the key assertion: there should be exactly ONE assistant message,
    // not two (one with temp ID and one with server ID).
    expect(assistantMessages.length).toBe(1);

    // The assistant message should have the server-assigned ID (not the temp ID)
    expect(assistantMessages[0].id).toMatch(/^server-msg-/);

    // The assistant message should have the correct text content
    const textParts = assistantMessages[0].parts.filter(
      (p: { type: string }) => p.type === "text"
    );
    expect(textParts.length).toBe(1);
    expect(textParts[0].text).toBe("Hello world!");

    ws.close(1000);
  });
});
