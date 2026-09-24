from __future__ import annotations

import os
import uuid
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from langraph_rag_backend import chatbot, ingest_pdf, retrieve_all_threads, thread_document_metadata

app = FastAPI(title="DocuPilot AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FRONTEND_ORIGIN", "http://localhost:3000,http://localhost:3001").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)
    thread_id: str = Field(min_length=1, max_length=100)

class ChatResponse(BaseModel):
    thread_id: str
    message: str
    tools_used: list[str] = []


def _messages(thread_id: str) -> list[dict[str, str]]:
    state = chatbot.get_state(config={"configurable": {"thread_id": thread_id}})
    result=[]
    for message in state.values.get("messages", []):
        if isinstance(message, HumanMessage):
            result.append({"role":"user", "content":str(message.content)})
        elif isinstance(message, AIMessage) and message.content:
            result.append({"role":"assistant", "content":str(message.content)})
    return result

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

@app.get("/api/threads")
def threads() -> list[dict[str, Any]]:
    result=[]
    for thread_id in reversed(retrieve_all_threads()):
        messages=_messages(thread_id)
        first=next((m["content"] for m in messages if m["role"]=="user"), "New chat")
        result.append({"id":thread_id, "title": " ".join(first.split())[:48], "messages":messages})
    return result

@app.post("/api/threads")
def new_thread() -> dict[str, str]:
    return {"id": str(uuid.uuid4()), "title": "New chat"}

@app.get("/api/threads/{thread_id}")
def thread(thread_id: str) -> dict[str, Any]:
    return {"id": thread_id, "messages": _messages(thread_id), "document": thread_document_metadata(thread_id) or None}

@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    config={"configurable":{"thread_id":request.thread_id}, "metadata":{"thread_id":request.thread_id}, "run_name":"chat_turn"}
    parts=[]; tools=[]
    try:
        for chunk, _ in chatbot.stream({"messages":[HumanMessage(content=request.message)]}, config=config, stream_mode="messages"):
            if isinstance(chunk, ToolMessage):
                name=getattr(chunk, "name", None)
                if name and name not in tools: tools.append(name)
            elif isinstance(chunk, AIMessage) and chunk.content:
                parts.append(str(chunk.content))
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ChatResponse(thread_id=request.thread_id, message="".join(parts), tools_used=tools)

@app.post("/api/threads/{thread_id}/document")
async def upload_document(thread_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Only PDF files are supported.")
    data=await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF exceeds the 200MB limit.")
    try:
        return ingest_pdf(data, thread_id=thread_id, filename=file.filename)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
