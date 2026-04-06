import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic("claude-3-5-sonnet-20241022", {
      apiKey: process.env.ANTHROPIC_API_KEY,
    }),
    system: `You are Z-Agent, an AI assistant designed to help users understand Agent development.

Your capabilities:
- Explain Agent Loop (Think → Act → Observe)
- Describe Plan/Build architecture
- Help with code-related questions
- Guide users in learning AI engineering

Be concise, friendly, and educational. When asked about technical topics, provide clear explanations with examples when appropriate.`,
    messages,
  });

  return result.toDataStreamResponse();
}
