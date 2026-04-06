"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-4xl w-full text-center space-y-8">
        {/* Header */}
        <div className="space-y-4">
          <h1 className="text-6xl font-bold tracking-tight">
            Z-Agent
          </h1>
          <p className="text-xl text-muted-foreground">
            Learn Agent Development with Plan/Build Architecture
          </p>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mt-12">
          <div className="p-6 border rounded-lg">
            <h3 className="font-semibold text-lg mb-2">Agent Loop</h3>
            <p className="text-sm text-muted-foreground">
              Think → Act → Observe cycle powered by Vercel AI SDK
            </p>
          </div>
          <div className="p-6 border rounded-lg">
            <h3 className="font-semibold text-lg mb-2">Plan/Build</h3>
            <p className="text-sm text-muted-foreground">
              Code scanning and task queue generation
            </p>
          </div>
          <div className="p-6 border rounded-lg">
            <h3 className="font-semibold text-lg mb-2">Tool Control</h3>
            <p className="text-sm text-muted-foreground">
              Permission-based tool execution
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="pt-8">
          <button
            onClick={() => router.push("/chat")}
            className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Start Chatting
          </button>
        </div>

        {/* Tech Stack */}
        <div className="pt-8 text-sm text-muted-foreground">
          <p>Built with Next.js, Vercel AI SDK, and Anthropic Claude</p>
        </div>
      </div>
    </main>
  );
}
