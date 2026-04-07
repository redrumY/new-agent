"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface UploadedFile {
  name: string;
  content: string;
}

export default function AgentLoopPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<Array<{ role: string; content: string; type?: string }>>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setUploadedFiles((prev) => [...prev, { name: file.name, content }]);
      };
      reader.readAsText(file);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // TODO: 接入 Agent Loop API
    // 模拟响应
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Agent Loop API 尚未实现", type: "observation" },
      ]);
      setIsLoading(false);
    }, 1000);
  };

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header style={{ padding: "1rem 1.5rem", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Agent Loop Demo</h1>
          <p style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>
            Think → Act → Observe
          </p>
        </div>
        <button
          onClick={() => router.push("/")}
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
      <div style={{ flex: 1, overflowY: "auto", backgroundColor: "#fafafa" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "1.5rem" }}>
          {uploadedFiles.length > 0 && (
            <div style={{ marginBottom: "1.5rem", padding: "1rem", backgroundColor: "#f3f4f6", borderRadius: "0.5rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>
                已上传文件 ({uploadedFiles.length})
              </p>
              {uploadedFiles.map((file, idx) => (
                <div key={idx} style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  📄 {file.name}
                </div>
              ))}
            </div>
          )}

          {messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 0" }}>
              <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
                验证 Agent Loop 执行效果
              </p>
              <div style={{ textAlign: "left", fontSize: "0.875rem", color: "#6b7280" }}>
                <p style={{ marginBottom: "0.5rem" }}>你可以：</p>
                <ul style={{ paddingLeft: "1.5rem", lineHeight: "1.75" }}>
                  <li>上传代码文件（点击 📎 按钮）</li>
                  <li>让 Agent 分析代码结构</li>
                  <li>观察 Think → Act → Observe 循环</li>
                </ul>
              </div>
            </div>
          ) : (
            messages.map((message, idx) => (
              <div
                key={idx}
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
                    backgroundColor: message.role === "user" ? "#000" : "#fff",
                    color: message.role === "user" ? "#fff" : "#000",
                    border: message.role === "assistant" ? "1px solid #e5e7eb" : "none",
                    boxShadow: message.role === "assistant" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                  }}
                >
                  {message.type && (
                    <div style={{ fontSize: "0.65rem", fontWeight: 600, color: message.role === "user" ? "#9ca3af" : "#6b7280", marginBottom: "0.25rem", textTransform: "uppercase" }}>
                      {message.type}
                    </div>
                  )}
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {message.content}
                  </div>
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "1rem" }}>
              <div style={{ padding: "0.75rem 1rem", borderRadius: "0.5rem", backgroundColor: "#fff", border: "1px solid #e5e7eb" }}>
                <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>Thinking...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div style={{ padding: "1rem", borderTop: "1px solid #e5e7eb", backgroundColor: "#fff" }}>
        <form onSubmit={handleSubmit} style={{ maxWidth: "900px", margin: "0 auto", display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: "0.75rem",
              backgroundColor: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "1.25rem",
            }}
            title="上传文件"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入任务... (可上传代码文件)"
            disabled={isLoading}
            rows={1}
            style={{
              flex: 1,
              padding: "0.75rem 1rem",
              fontSize: "1rem",
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              outline: "none",
              resize: "none",
              minHeight: "42px",
              maxHeight: "120px",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
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
