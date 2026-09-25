"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  FileText,
  Plus,
  Send,
  Sparkles,
  Upload,
  Menu,
  X,
  Bot,
  User,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  Download,
} from "lucide-react";
import { exportChatAsJSON, exportChatAsMarkdown } from "./exportUtils";
import { TOOL_CONFIG } from "./toolConfig";

type Message = {
  role: "user" | "assistant";
  content: string;
  tools_used?: string[];
};

type Thread = { id: string; title: string; messages: Message[] };
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [document, setDocument] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    void loadThreads();
    return () => {
      if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, isTyping]);

  async function loadThreads() {
    const response = await fetch(`${API}/api/threads`);
    if (!response.ok) return;
    const data = await response.json();
    setThreads(data);
    if (!threadId) newChat(data);
  }

  function newChat(existing = threads) {
    if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    setIsTyping(false);
    setBusy(false);
    const id = crypto.randomUUID();
    setThreadId(id);
    setMessages([]);
    setDocument(null);
    setThreads(existing);
  }

  function selectThread(thread: Thread) {
    if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    setIsTyping(false);
    setBusy(false);
    setThreadId(thread.id);
    setMessages(thread.messages);
  }

  function copyText(text: string, idx: number) {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  function streamOneByOne(fullText: string, currentThreadId: string, promptText: string, toolsUsed: string[] = []) {
    if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    setIsTyping(true);

    const tokens = fullText.split(/(\s+)/);
    let index = 0;

    setMessages(current => [...current, { role: "assistant", content: "", tools_used: toolsUsed }]);
    const speed = Math.max(12, Math.min(24, Math.floor(1600 / Math.max(tokens.length, 1))));

    typingTimerRef.current = setInterval(() => {
      index++;
      if (index >= tokens.length) {
        if (typingTimerRef.current) clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
        setIsTyping(false);
        setBusy(false);
        setMessages(current => {
          const next = [...current];
          if (next.length > 0 && next[next.length - 1].role === "assistant") {
            next[next.length - 1] = { role: "assistant", content: fullText, tools_used: toolsUsed };
          }
          return next;
        });
        setThreads(current => [
          { id: currentThreadId, title: promptText.slice(0, 48), messages: [] },
          ...current.filter(item => item.id !== currentThreadId),
        ]);
      } else {
        const partial = tokens.slice(0, index).join("");
        setMessages(current => {
          const next = [...current];
          if (next.length > 0 && next[next.length - 1].role === "assistant") {
            next[next.length - 1] = { role: "assistant", content: partial, tools_used: toolsUsed };
          }
          return next;
        });
      }
    }, speed);
  }

  async function executeChat(text: string) {
    let activeThreadId = threadId;
    if (!activeThreadId) {
      activeThreadId = crypto.randomUUID();
      setThreadId(activeThreadId);
    }

    setBusy(true);
    const doFetch = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await fetch(`${API}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, thread_id: activeThreadId }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        return response;
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    };

    try {
      let response;
      try {
        response = await doFetch();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error("Request timed out. The AI is still processing — please try again.");
        }
        response = await doFetch();
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Request failed");
      streamOneByOne(data.message, activeThreadId, text, data.tools_used || []);
    } catch (error) {
      setBusy(false);
      setIsTyping(false);
      const msg = error instanceof Error ? error.message : "Something went wrong.";
      const errorContent = msg.includes("Failed to fetch")
        ? "Could not reach server (free tier waking up). Please try again in 30 seconds."
        : msg;
      setMessages(current => [...current, { role: "assistant", content: errorContent }]);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || isTyping) return;
    setInput("");
    setMessages(current => [...current, { role: "user", content: text }]);
    await executeChat(text);
  }

  function regenerate() {
    if (busy || isTyping) return;
    const userPrompts = messages.filter(m => m.role === "user");
    if (!userPrompts.length) return;
    const lastPrompt = userPrompts[userPrompts.length - 1].content;
    setMessages(current => {
      if (current.length && current[current.length - 1].role === "assistant") {
        return current.slice(0, -1);
      }
      return current;
    });
    void executeChat(lastPrompt);
  }

  async function upload(file?: File) {
    if (!file) return;
    const validExts = [".pdf", ".txt", ".md", ".csv", ".json", ".log"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!validExts.includes(ext) && !file.type.includes("pdf") && !file.type.includes("text")) {
      setMessages(current => [
        ...current,
        { role: "assistant", content: `Please select a supported document (${validExts.join(", ")}).` },
      ]);
      return;
    }

    let activeThreadId = threadId;
    if (!activeThreadId) {
      activeThreadId = crypto.randomUUID();
      setThreadId(activeThreadId);
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await fetch(`${API}/api/threads/${activeThreadId}/document`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed");
      setDocument(data);
      setMessages(current => [
        ...current,
        {
          role: "assistant",
          content: `📄 **${data.filename || file.name}** indexed successfully (${data.chunks || 0} chunks, ${data.documents || 1} parts).\n\nYou can now ask questions about this document!`,
        },
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Upload failed.";
      setMessages(current => [...current, { role: "assistant", content: `Upload error: ${msg}` }]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-[#090a10]">
      {sidebarOpen && (
        <aside className="w-[310px] shrink-0 border-r border-white/10 bg-[#11131d] p-5 max-md:fixed max-md:inset-y-0 max-md:z-20">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xl font-bold tracking-tight">
                DocuPilot <span className="text-violet-400">AI</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">Intelligent agent & document workspace</p>
            </div>
            <button className="md:hidden" onClick={() => setSidebarOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <button
            onClick={() => newChat()}
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold transition hover:border-violet-400 hover:bg-violet-400/10"
          >
            <Plus size={17} /> New chat
          </button>

          <div className="mt-8 text-[11px] font-bold uppercase tracking-[.18em] text-slate-500">Knowledge source</div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="mt-3 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-violet-400/60 bg-violet-400/10 px-4 py-5 text-sm text-slate-300 transition hover:bg-violet-400/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload size={20} className={`text-violet-300 ${uploading ? "animate-pulse" : ""}`} />
            <span className="truncate max-w-[240px] font-medium">{uploading ? "Indexing…" : document ? `${document.filename}` : "Upload Document"}</span>
            <span className="text-[11px] text-slate-500">PDF, TXT, MD, CSV, JSON</span>
          </button>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept=".pdf,.txt,.md,.csv,.json,.log"
            onChange={event => {
              const selected = event.target.files?.[0];
              if (selected) void upload(selected);
              event.target.value = "";
            }}
          />

          {document && (
            <div className="mt-3 rounded-lg bg-emerald-400/10 p-3 text-xs text-emerald-300">
              <FileText size={14} className="mb-1" /> {String(document.chunks)} chunks · {String(document.documents)} sections
            </div>
          )}

          <div className="mt-8 text-[11px] font-bold uppercase tracking-[.18em] text-slate-500">Recent conversations</div>
          <div className="mt-3 space-y-2">
            {threads.map(thread => (
              <button
                key={thread.id}
                onClick={() => selectThread(thread)}
                className={`w-full truncate rounded-lg px-3 py-2.5 text-left text-sm transition ${
                  thread.id === threadId ? "bg-violet-400/15 text-violet-200 font-medium" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {thread.title || "New chat"}
              </button>
            ))}
          </div>
        </aside>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Model: Nemotron-3 550B
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <>
                <button
                  onClick={() => exportChatAsMarkdown(threads.find(t => t.id === threadId)?.title || "chat", messages)}
                  title="Export Markdown"
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-violet-400/50 hover:bg-violet-400/10 hover:text-violet-200"
                >
                  <Download size={13} /> Export MD
                </button>
                <button
                  onClick={() => exportChatAsJSON(threads.find(t => t.id === threadId)?.title || "chat", messages)}
                  title="Export JSON"
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-violet-400/50 hover:bg-violet-400/10 hover:text-violet-200"
                >
                  <Download size={13} /> JSON
                </button>
              </>
            )}
            <button
              onClick={() => newChat()}
              title="Clear Chat"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-300"
            >
              <Trash2 size={13} /> Clear
            </button>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-12">
          <div className="mb-10">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-violet-400/15 p-3 text-violet-300">
                <Sparkles size={22} />
              </div>
              <div>
                <h1 className="text-4xl font-bold tracking-tight">What would you like to explore?</h1>
                <p className="mt-2 text-slate-400">Ask questions, analyze documents, run Python code, or use agent tools.</p>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-6">
            {messages.length === 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  "Summarize my document",
                  "Search web for latest tech news",
                  "Run Python to calculate compound interest",
                  "What tools can you use?",
                ].map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="rounded-xl border border-white/10 bg-white/[.03] p-4 text-left text-sm text-slate-300 transition hover:border-violet-400/50 hover:bg-violet-400/10"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message, index) => {
              const isLastAssistant = message.role === "assistant" && index === messages.length - 1;
              return (
                <div key={index} className={`flex flex-col gap-2 ${message.role === "user" ? "items-end" : "items-start"}`}>
                  {message.tools_used && message.tools_used.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-1">
                      {message.tools_used.map(toolKey => {
                        const cfg = TOOL_CONFIG[toolKey] || { label: toolKey, icon: Bot, style: "text-slate-300 border-white/10 bg-white/5" };
                        const Icon = cfg.icon;
                        return (
                          <span key={toolKey} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${cfg.style}`}>
                            <Icon size={11} /> {cfg.label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div
                    className={`group relative flex max-w-[85%] gap-3 rounded-2xl px-4 py-3 ${
                      message.role === "user"
                        ? "bg-violet-500 text-white"
                        : "border border-white/10 bg-white/[.04] text-slate-200"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <Bot size={17} className="mt-1 shrink-0 text-violet-300" />
                    ) : (
                      <User size={17} className="mt-1 shrink-0" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="whitespace-pre-wrap text-sm leading-6">
                        {message.content}
                        {isLastAssistant && isTyping && (
                          <span className="inline-block h-4 w-2 ml-1 rounded-sm bg-violet-400 animate-pulse align-middle" />
                        )}
                      </div>

                      {message.role === "assistant" && message.content && !isTyping && (
                        <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-2 opacity-70 group-hover:opacity-100 transition">
                          <button
                            onClick={() => copyText(message.content, index)}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition"
                          >
                            {copiedIndex === index ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                            {copiedIndex === index ? "Copied" : "Copy"}
                          </button>
                          {isLastAssistant && (
                            <button
                              onClick={regenerate}
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition disabled:opacity-40"
                            >
                              <RotateCcw size={12} /> Regenerate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {busy && !isTyping && (
              <div className="flex gap-3 justify-start">
                <div className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-white/10 bg-white/[.04] text-slate-400 text-sm">
                  <Bot size={17} className="shrink-0 text-violet-300 animate-pulse" />
                  <span className="animate-pulse">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={send}
            className="mt-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#151824] p-2 shadow-2xl shadow-black/20"
          >
            <input
              value={input}
              onChange={event => setInput(event.target.value)}
              disabled={busy || isTyping}
              placeholder="Ask questions, query document, run Python code..."
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <button
              disabled={busy || isTyping || !input.trim()}
              className="rounded-xl bg-violet-500 p-3 text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
