"use client";

import { useChat } from "@ai-sdk/react";

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
  });

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header style={{ padding: "1rem 1.5rem", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Z-Agent Chat</h1>
        <button
          onClick={() => window.location.href = "/"}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            backgroundColor: "transparent",
            border: "1px solid #e5e7eb",
            borderRadius: "0.375rem",
            cursor: "pointer",
          }}
        >
          Back
        </button>
      </header>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto", padding: "1.5rem" }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 0" }}>
              <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
                Start a conversation with Z-Agent
              </p>
              <div style={{ textAlign: "left", fontSize: "0.875rem", color: "#6b7280" }}>
                <p style={{ marginBottom: "0.5rem" }}>Try asking:</p>
                <ul style={{ paddingLeft: "1.5rem", lineHeight: "1.75" }}>
                  <li>"What can you help me with?"</li>
                  <li>"Explain how Agent Loop works"</li>
                  <li>"Help me understand Plan/Build architecture"</li>
                </ul>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                style={{
                  display: "flex",
                  justifyContent: message.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: "1rem",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "0.75rem 1rem",
                    borderRadius: "0.5rem",
                    backgroundColor: message.role === "user" ? "#000" : "#f3f4f6",
                    color: message.role === "user" ? "#fff" : "#000",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {message.content}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "1rem" }}>
              <div style={{ padding: "0.75rem 1rem", borderRadius: "0.5rem", backgroundColor: "#f3f4f6" }}>
                <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>Thinking...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div style={{ padding: "1rem", borderTop: "1px solid #e5e7eb" }}>
        <form onSubmit={handleSubmit} style={{ maxWidth: "800px", margin: "0 auto", display: "flex", gap: "0.5rem" }}>
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Type your message..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "0.75rem 1rem",
              fontSize: "1rem",
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              fontWeight: 500,
              color: "white",
              backgroundColor: !isLoading && input.trim() ? "#000" : "#9ca3af",
              border: "none",
              borderRadius: "0.5rem",
              cursor: !isLoading && input.trim() ? "pointer" : "not-allowed",
            }}
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
