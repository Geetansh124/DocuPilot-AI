"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { FileText, Plus, Send, Sparkles, Upload, Menu, X, Bot, User } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };
type Thread = { id: string; title: string; messages: Message[] };
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [document, setDocument] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadThreads(); }, []);
  async function loadThreads() { const response = await fetch(`${API}/api/threads`); if (!response.ok) return; const data=await response.json(); setThreads(data); if (!threadId) newChat(data); }
  function newChat(existing=threads) { const id=crypto.randomUUID(); setThreadId(id); setMessages([]); setDocument(null); setThreads(existing); }
  function selectThread(thread: Thread) { setThreadId(thread.id); setMessages(thread.messages); }
  async function send(event: FormEvent) { event.preventDefault(); const text=input.trim(); if (!text || busy) return; setInput(""); setMessages(current=>[...current,{role:"user",content:text}]); setBusy(true); try { const response=await fetch(`${API}/api/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text,thread_id:threadId})}); const data=await response.json(); if (!response.ok) throw new Error(data.detail || "Request failed"); setMessages(current=>[...current,{role:"assistant",content:data.message}]); setThreads(current=>[{id:threadId,title:text.slice(0,48),messages:[]},...current.filter(item=>item.id!==threadId)]); } catch(error) { setMessages(current=>[...current,{role:"assistant",content:error instanceof Error ? error.message : "Something went wrong."}]); } finally { setBusy(false); } }
  async function upload(file?: File) { if (!file || file.type!=="application/pdf") return; setUploading(true); try { const body=new FormData(); body.append("file",file); const response=await fetch(`${API}/api/threads/${threadId}/document`,{method:"POST",body}); const data=await response.json(); if (!response.ok) throw new Error(data.detail || "Upload failed"); setDocument(data); } catch(error) { setMessages(current=>[...current,{role:"assistant",content:error instanceof Error ? error.message : "Upload failed."}]); } finally { setUploading(false); } }
  return <main className="flex min-h-screen bg-[#090a10]">
    {sidebarOpen && <aside className="w-[310px] shrink-0 border-r border-white/10 bg-[#11131d] p-5 max-md:fixed max-md:inset-y-0 max-md:z-20">
      <div className="flex items-center justify-between"><div><div className="text-xl font-bold tracking-tight">DocuPilot <span className="text-violet-400">AI</span></div><p className="mt-1 text-xs text-slate-400">Your intelligent document workspace</p></div><button className="md:hidden" onClick={()=>setSidebarOpen(false)}><X size={18}/></button></div>
      <button onClick={()=>newChat()} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold transition hover:border-violet-400 hover:bg-violet-400/10"><Plus size={17}/> New chat</button>
      <div className="mt-8 text-[11px] font-bold uppercase tracking-[.18em] text-slate-500">Knowledge source</div>
      <button onClick={()=>fileRef.current?.click()} className="mt-3 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-violet-400/60 bg-violet-400/10 px-4 py-6 text-sm text-slate-300 transition hover:bg-violet-400/20"><Upload size={20} className="text-violet-300"/>{uploading ? "Indexing PDF…" : document ? `${document.filename}` : "Upload a PDF"}<span className="text-xs text-slate-500">PDF up to 200MB</span></button><input ref={fileRef} className="hidden" type="file" accept="application/pdf" onChange={event=>void upload(event.target.files?.[0])}/>
      {document && <div className="mt-3 rounded-lg bg-emerald-400/10 p-3 text-xs text-emerald-300"><FileText size={14} className="mb-1"/> {String(document.chunks)} chunks · {String(document.documents)} pages</div>}
      <div className="mt-8 text-[11px] font-bold uppercase tracking-[.18em] text-slate-500">Recent conversations</div><div className="mt-3 space-y-2">{threads.map(thread=><button key={thread.id} onClick={()=>selectThread(thread)} className={`w-full truncate rounded-lg px-3 py-2.5 text-left text-sm transition ${thread.id===threadId?"bg-violet-400/15 text-violet-200":"text-slate-400 hover:bg-white/5 hover:text-white"}`}>{thread.title || "New chat"}</button>)}</div>
    </aside>}
    <section className="flex min-w-0 flex-1 flex-col"><header className="flex items-center justify-between border-b border-white/10 px-6 py-4"><button className="md:hidden" onClick={()=>setSidebarOpen(true)}><Menu size={20}/></button><div className="hidden md:block"/><div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-400"/> Ready</div></header><div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-12"><div className="mb-10"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-400/15 p-3 text-violet-300"><Sparkles size={22}/></div><div><h1 className="text-4xl font-bold tracking-tight">What would you like to explore?</h1><p className="mt-2 text-slate-400">Ask questions, analyze documents, or use your AI tools.</p></div></div></div><div className="flex-1 space-y-6">{messages.length===0 && <div className="grid gap-3 sm:grid-cols-3">{["Summarize my PDF","What can you help with?","Calculate 125 × 8"].map(prompt=><button key={prompt} onClick={()=>setInput(prompt)} className="rounded-xl border border-white/10 bg-white/[.03] p-4 text-left text-sm text-slate-300 transition hover:border-violet-400/50 hover:bg-violet-400/10">{prompt}</button>)}</div>}{messages.map((message,index)=><div key={index} className={`flex gap-3 ${message.role==="user"?"justify-end":"justify-start"}`}><div className={`flex max-w-[80%] gap-3 rounded-2xl px-4 py-3 ${message.role==="user"?"bg-violet-500 text-white":"border border-white/10 bg-white/[.04] text-slate-200"}`}>{message.role==="assistant"?<Bot size={17} className="mt-1 shrink-0 text-violet-300"/>:<User size={17} className="mt-1 shrink-0"/>}<p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p></div></div>)}{busy&&<div className="text-sm text-slate-500">Thinking…</div>}</div><form onSubmit={send} className="mt-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#151824] p-2 shadow-2xl shadow-black/20"><input value={input} onChange={event=>setInput(event.target.value)} disabled={busy} placeholder="Ask about your document or use tools…" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500"/><button disabled={busy||!input.trim()} className="rounded-xl bg-violet-500 p-3 text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"><Send size={18}/></button></form></div></section>
  </main>;
}
