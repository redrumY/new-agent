"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: "800px", textAlign: "center" }}>
        <h1 style={{ fontSize: "4rem", fontWeight: "bold", marginBottom: "1rem" }}>
          Z-Agent
        </h1>
        <p style={{ fontSize: "1.5rem", color: "#666", marginBottom: "3rem" }}>
          Learn Agent Development with Plan/Build Architecture
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem", marginBottom: "3rem" }}>
          <div
            onClick={() => router.push("/agent-loop")}
            style={{ padding: "1.5rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", cursor: "pointer", transition: "all 0.2s", backgroundColor: "#fff" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f9fafb"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#fff"}
          >
            <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>Agent Loop</h3>
            <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
              Think → Act → Observe cycle
            </p>
          </div>
          <div
            onClick={() => router.push("/chat")}
            style={{ padding: "1.5rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", cursor: "pointer", transition: "all 0.2s", backgroundColor: "#fff" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f9fafb"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#fff"}
          >
            <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>Plan/Build</h3>
            <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
              Code scanning and task queue
            </p>
          </div>
          <div
            onClick={() => router.push("/chat")}
            style={{ padding: "1.5rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", cursor: "pointer", transition: "all 0.2s", backgroundColor: "#fff" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f9fafb"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#fff"}
          >
            <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>Tool Control</h3>
            <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
              Permission-based execution
            </p>
          </div>
        </div>

        <button
          onClick={() => router.push("/chat")}
          style={{
            padding: "0.75rem 2rem",
            fontSize: "1rem",
            fontWeight: 500,
            color: "white",
            backgroundColor: "#000",
            border: "none",
            borderRadius: "0.5rem",
            cursor: "pointer",
          }}
        >
          Start Chatting
        </button>

        <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "#6b7280" }}>
          Built with Next.js, Vercel AI SDK, and Anthropic Claude
        </p>
      </div>
    </main>
  );
}
