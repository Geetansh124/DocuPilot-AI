from __future__ import annotations

import os
import json
import subprocess
import sqlite3
import tempfile
from typing import Annotated, Any, Dict, Optional, TypedDict

from dotenv import load_dotenv

load_dotenv()
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader
from langchain_community.tools import DuckDuckGoSearchRun
from langchain_community.vectorstores import FAISS
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.tools import tool

from aws_storage import storage

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
import requests

# -------------------
# 1. LLM + embeddings
# -------------------
from langchain_nvidia_ai_endpoints import ChatNVIDIA

# Load these lazily so the Streamlit UI can boot even when the model or API key
# is unavailable. This avoids crashing the app during import.
llm = None
embeddings = None


from langchain_huggingface import HuggingFaceEmbeddings


def get_llm():
    """Create the LLM client only when the app actually needs it."""
    global llm
    if llm is None:
        api_key = os.getenv("NVIDIA_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Missing NVIDIA_API_KEY. Set it in your environment or .env before using chat features."
            )
        llm = ChatNVIDIA(model="nvidia/nemotron-3-ultra-550b-a55b", api_key=api_key, timeout=120, max_tokens=1024)
    return llm


def get_embeddings():
    """Create the embedding model lazily to avoid import-time startup crashes."""
    global embeddings
    if embeddings is None:
        embeddings = HuggingFaceEmbeddings(model='sentence-transformers/all-MiniLM-L6-v2')
    return embeddings


# -------------------
# 2. PDF retriever store (per thread)
# -------------------
_THREAD_RETRIEVERS: Dict[str, Any] = {}
_THREAD_METADATA: Dict[str, dict] = {}


def _get_retriever(thread_id: Optional[str]):
    """Fetch a retriever from memory, restoring it from S3 when configured."""
    if not thread_id:
        return None
    if thread_id in _THREAD_RETRIEVERS:
        return _THREAD_RETRIEVERS[thread_id]
    if storage.enabled:
        retriever_store = storage.load_vector_store(thread_id, get_embeddings())
        if retriever_store is not None:
            _THREAD_RETRIEVERS[thread_id] = retriever_store.as_retriever(
                search_type="mmr", search_kwargs={"k": 5, "fetch_k": 15, "lambda_mult": 0.7}
            )
            return _THREAD_RETRIEVERS[thread_id]
    return None


def ingest_pdf(file_bytes: bytes, thread_id: str, filename: Optional[str] = None) -> dict:
    """
    Build a FAISS retriever for the uploaded PDF and store it for the thread.

    Returns a summary dict that can be surfaced in the UI.
    """
    if not file_bytes:
        raise ValueError("No bytes received for ingestion.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_file.write(file_bytes)
        temp_file.flush()
        temp_path = temp_file.name

    try:
        loader = PyPDFLoader(temp_path)
        docs = loader.load()

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, chunk_overlap=200, separators=["\n\n", "\n", " ", ""]
        )
        chunks = splitter.split_documents(docs)

        vector_store = FAISS.from_documents(chunks, get_embeddings())
        retriever = vector_store.as_retriever(
            search_type="mmr", search_kwargs={"k": 5, "fetch_k": 15, "lambda_mult": 0.7}
        )

        metadata = {
            "filename": filename or os.path.basename(temp_path),
            "documents": len(docs),
            "chunks": len(chunks),
        }
        _THREAD_RETRIEVERS[str(thread_id)] = retriever
        _THREAD_METADATA[str(thread_id)] = metadata
        storage.save_document(
            str(thread_id), metadata["filename"], file_bytes, vector_store, metadata
        )
        return metadata
    finally:
        # The FAISS store keeps copies of the text, so the temp file is safe to remove.
        try:
            os.remove(temp_path)
        except OSError:
            pass


# -------------------
# 3. Tools
# -------------------
search_tool = DuckDuckGoSearchRun(region="us-en")


@tool
def calculator(first_num: float, second_num: float, operation: str) -> dict:
    """
    Perform a basic arithmetic operation on two numbers.
    Supported operations: add, sub, mul, div
    """
    try:
        if operation == "add":
            result = first_num + second_num
        elif operation == "sub":
            result = first_num - second_num
        elif operation == "mul":
            result = first_num * second_num
        elif operation == "div":
            if second_num == 0:
                return {"error": "Division by zero is not allowed"}
            result = first_num / second_num
        else:
            return {"error": f"Unsupported operation '{operation}'"}

        return {
            "first_num": first_num,
            "second_num": second_num,
            "operation": operation,
            "result": result,
        }
    except Exception as e:
        return {"error": str(e)}


@tool
def get_stock_price(symbol: str) -> dict:
    """
    Fetch latest stock price for a given symbol (e.g. 'AAPL', 'TSLA') 
    using Alpha Vantage with API key in the URL.
    """
    api_key = os.getenv("ALPHAVANTAGE_API_KEY")
    if not api_key:
        return {"error": "Stock price lookup is not configured."}

    normalized_symbol = symbol.strip().upper()
    if not normalized_symbol.isalnum() or len(normalized_symbol) > 10:
        return {"error": "Invalid stock symbol."}

    try:
        response = requests.get(
            "https://www.alphavantage.co/query",
            params={
                "function": "GLOBAL_QUOTE",
                "symbol": normalized_symbol,
                "apikey": api_key,
            },
            timeout=15,
        )
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        return {"error": f"Stock price lookup failed: {exc}"}


@tool
def rag_tool(query: str, thread_id: Optional[str] = None) -> dict:
    """
    Retrieve relevant information from the uploaded PDF for this chat thread.
    Always include the thread_id when calling this tool.
    """
    retriever = _get_retriever(thread_id)
    if retriever is None:
        return {
            "error": "No document indexed for this chat. Upload a PDF first.",
            "query": query,
        }

    result = retriever.invoke(query)
    context = [doc.page_content for doc in result]
    metadata = [doc.metadata for doc in result]

    return {
        "query": query,
        "context": context,
        "metadata": metadata,
        "source_file": _THREAD_METADATA.get(str(thread_id), {}).get("filename"),
    }


tools = [rag_tool, search_tool, get_stock_price, calculator]


def _route_with_ruflo(task: str) -> dict:
    """Route a request through the project-local Ruflo MCP tool."""
    import shutil
    extra_paths = [
        os.path.dirname(shutil.which("node") or ""),
        os.path.expanduser("~/.local/node-v20.20.2/current/bin"),
        "/usr/local/bin",
        "/usr/bin"
    ]
    current_path = os.environ.get("PATH", "")
    path_dirs = [p for p in extra_paths if p and os.path.isdir(p)] + [current_path]
    full_path = ":".join(dict.fromkeys(path_dirs))
    env = {**os.environ, "PATH": full_path}

    npx_bin = shutil.which("npx", path=full_path) or "npx"
    command = [
        npx_bin,
        "--yes",
        "ruflo",
        "mcp",
        "exec",
        "-t",
        "hooks_route",
        "-p",
        json.dumps({"task": task}),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"error": "Ruflo routing timed out after 30 seconds.", "task": task}
    except OSError as exc:
        return {"error": f"Ruflo is unavailable: {exc}", "task": task}

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        return {
            "error": f"Ruflo routing failed (exit {completed.returncode}): {detail}",
            "task": task,
        }

    marker = "Result:"
    output = completed.stdout
    if marker not in output:
        return {
            "error": "Ruflo returned no routing result.",
            "task": task,
            "raw_output": output[-2000:],
        }
    try:
        return json.loads(output.split(marker, 1)[1].strip())
    except json.JSONDecodeError as exc:
        return {
            "error": f"Ruflo returned invalid routing JSON: {exc}",
            "task": task,
            "raw_output": output[-2000:],
        }


@tool
def ruflo_route(task: str) -> dict:
    """Route a task through Ruflo's semantic agent router."""
    return _route_with_ruflo(task)


tools.append(ruflo_route)
llm_with_tools = None


def get_llm_with_tools():
    """Bind tools lazily so startup does not block on model loading."""
    global llm_with_tools
    if llm_with_tools is None:
        llm_with_tools = get_llm().bind_tools(tools)
    return llm_with_tools


# -------------------
# 4. State
# -------------------
class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


# -------------------
# 5. Nodes
# -------------------
def chat_node(state: ChatState, config=None):
    """LLM node that may answer or request a tool call."""
    thread_id = None
    if config and isinstance(config, dict):
        thread_id = config.get("configurable", {}).get("thread_id")

    has_document = thread_has_document(str(thread_id)) if thread_id else False
    document_context = ""
    latest_user_message = next(
        (
            message.content
            for message in reversed(state["messages"])
            if getattr(message, "type", None) == "human"
        ),
        "",
    )
    ruflo_routing = _route_with_ruflo(str(latest_user_message))

    if has_document and state["messages"]:
        retriever = _get_retriever(str(thread_id))
        if retriever and latest_user_message:
            retrieved_docs = retriever.invoke(latest_user_message)
            document_context = "\n\n".join(
                f"[Page {doc.metadata.get('page', 'unknown') + 1}]\n{doc.page_content}"
                for doc in retrieved_docs
            )

    if has_document:
        document_priority = (
            "This chat is PDF-grounded. If the user asks about the uploaded document, "
            "you must use `rag_tool` first and answer using the returned PDF context. "
            "Do not rely on general web search or stock tools unless the user explicitly asks "
            "for outside knowledge. Keep the answer grounded in the document and cite the "
            "relevant parts from the retrieved chunks when possible."
        )
    else:
        document_priority = (
            "No PDF is indexed for this thread yet. Ask the user to upload a PDF before "
            "answering document-based questions."
        )

    system_message = SystemMessage(
        content=(
            "You are a helpful assistant. "
            f"{document_priority} "
            + (
                "The following context was automatically retrieved from the uploaded PDF. "
                "Use it as the primary source of truth. If it does not contain the answer, "
                "say that the answer was not found in the PDF instead of guessing.\n\n"
                f"PDF CONTEXT:\n{document_context}"
                if document_context
                else ""
            )
            + "\nRUFLO ROUTING RESULT:\n"
            + json.dumps(ruflo_routing, default=str)
            + "\nUse this routing result to choose the most suitable response approach. "
            + "For document questions, call `rag_tool` with the `thread_id` "
            f"`{thread_id}` and use its context as the primary source of truth. "
            "You may use the web search, stock price, and calculator tools only when the user "
            "explicitly asks for them or they are necessary for a non-document question."
        )
    )

    messages = [system_message, *state["messages"]]
    response = get_llm_with_tools().invoke(messages, config=config)
    return {"messages": [response]}


tool_node = ToolNode(tools)

# -------------------
# 6. Checkpointer
# -------------------
conn = sqlite3.connect(database="chatbot.db", check_same_thread=False)
checkpointer = SqliteSaver(conn=conn)

# -------------------
# 7. Graph
# -------------------
graph = StateGraph(ChatState)
graph.add_node("chat_node", chat_node)
graph.add_node("tools", tool_node)

graph.add_edge(START, "chat_node")
graph.add_conditional_edges("chat_node", tools_condition)
graph.add_edge("tools", "chat_node")

chatbot = graph.compile(checkpointer=checkpointer)

# -------------------
# 8. Helpers
# -------------------
def retrieve_all_threads():
    """Retrieve distinct thread IDs directly from SQLite database in O(N_threads) time.

    Optimized: Replaced slow O(N_checkpoints) checkpointer.list(None) iteration
    with direct SQL SELECT DISTINCT thread_id query to eliminate checkpoint deserialization overhead.
    """
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT thread_id FROM checkpoints")
        return [row[0] for row in cursor.fetchall()]
    except Exception:
        # Fallback to checkpointer.list for mock or non-sqlite checkpointer backends
        all_threads = set()
        for checkpoint in checkpointer.list(None):
            all_threads.add(checkpoint.config["configurable"]["thread_id"])
        return list(all_threads)


def thread_has_document(thread_id: str) -> bool:
    return str(thread_id) in _THREAD_RETRIEVERS


def thread_document_metadata(thread_id: str) -> dict:
    return _THREAD_METADATA.get(str(thread_id), {})