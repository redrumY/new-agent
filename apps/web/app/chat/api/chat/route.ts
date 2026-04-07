import { streamText, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

const model = anthropic(process.env.MODEL_ID || "claude-3-5-sonnet-20241022");

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model,
    system: `You are Z-Agent, an AI assistant designed to help users understand Agent development.

Your capabilities:
- Explain Agent Loop (Think → Act → Observe)
- Describe Plan/Build architecture
- Help with code-related questions
- Guide users in learning AI engineering

Be concise, friendly, and educational. When asked about technical topics, provide clear explanations with examples when appropriate.`,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
