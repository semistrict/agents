import type { UIMessage } from "ai";

function hasFinishReason(message: UIMessage): boolean {
  const metadata = message.metadata as
    | { finishReason?: unknown }
    | undefined;
  return metadata?.finishReason != null;
}

function textLength(message: UIMessage): number {
  return message.parts
    .filter((part) => part.type === "text")
    .reduce((sum, part) => sum + part.text.length, 0);
}

function messageScore(message: UIMessage): number {
  let score = 0;
  if (hasFinishReason(message)) score += 1_000_000;
  score += message.parts.length * 1_000;
  score += textLength(message);
  return score;
}

export function deduplicateConsecutiveAssistants<
  T extends UIMessage
>(messages: T[]): T[] {
  const result: T[] = [];

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];

    if (current?.role === "assistant") {
      let best = current;
      let j = i + 1;
      while (j < messages.length && messages[j]?.role === "assistant") {
        if (messageScore(messages[j]) >= messageScore(best)) {
          best = messages[j];
        }
        j++;
      }
      result.push(best);
      i = j - 1;
      continue;
    }

    result.push(current);
  }

  return result;
}
