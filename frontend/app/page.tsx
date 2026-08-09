"use client";

import { Show, SignInButton, useUser } from "@clerk/nextjs";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LibraryBooksOutlinedIcon from "@mui/icons-material/LibraryBooksOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SUPPORTED_TYPES = ".pdf,.docx,.txt,.md,.csv,.json,.xlsx,.pptx";

type UploadStatus = "queued" | "uploading" | "success" | "error";

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: UploadStatus;
  error?: string;
  documentId?: string;
  chunks?: number;
};

type Health = {
  status: string;
  openai_configured: boolean;
  embedding_provider: string;
  embedding_model: string;
  chat_model: string;
};

type KnowledgeDocument = {
  document_id: string;
  filename: string;
  chunks: number;
  pages: number[];
  page_count: number;
};

type WorkspaceStats = {
  documents: number;
  chunks: number;
  embedding_provider: string;
  embedding_model: string;
};

type Source = {
  index: number;
  text: string;
  filename: string;
  page?: number | null;
  distance?: number | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  notice?: string | null;
  mode?: string;
};

type QueryResponse = {
  success: boolean;
  answer: string;
  mode: string;
  notice?: string | null;
  sources: Source[];
  stats?: WorkspaceStats;
};

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const { user, isLoaded } = useUser();

  const userId = useMemo(() => {
    if (isLoaded && user?.id) return user.id;
    return "demo_workspace";
  }, [isLoaded, user?.id]);

  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Upload your company docs, then ask a question. I will answer with cited source excerpts from your workspace.",
    },
  ]);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/health`);

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      setHealth(await response.json());
      setHealthError(null);
    } catch (error) {
      setHealth(null);
      setHealthError(error instanceof Error ? error.message : "Backend offline");
    }
  }, []);

  const refreshDocuments = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_URL}/documents?user_id=${encodeURIComponent(userId)}`
      );

      if (!response.ok) return;

      const payload = await response.json();
      setDocuments(payload.documents ?? []);
      setStats(payload.stats ?? null);
    } catch {
      setDocuments([]);
    }
  }, [userId]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

  const addFiles = useCallback((newFiles: File[]) => {
    setUploads((current) => [
      ...current,
      ...newFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: "queued" as const,
      })),
    ]);
  }, []);

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;
    addFiles(Array.from(event.target.files));
    event.target.value = "";
  };

  const uploadFile = (item: UploadItem) => {
    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();

      formData.append("file", item.file);
      formData.append("user_id", userId);

      xhr.open("POST", `${API_URL}/upload`);

      setUploads((current) =>
        current.map((upload) =>
          upload.id === item.id
            ? { ...upload, status: "uploading", progress: 5, error: undefined }
            : upload
        )
      );

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;

        const progress = Math.max(
          5,
          Math.min(95, Math.round((event.loaded / event.total) * 100))
        );

        setUploads((current) =>
          current.map((upload) =>
            upload.id === item.id ? { ...upload, progress } : upload
          )
        );
      };

      xhr.onload = () => {
        let payload: {
          detail?: string;
          rag?: { document_id?: string; chunks?: number };
        } = {};

        try {
          payload = JSON.parse(xhr.responseText || "{}");
        } catch {
          payload = {};
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          setUploads((current) =>
            current.map((upload) =>
              upload.id === item.id
                ? {
                    ...upload,
                    progress: 100,
                    status: "success",
                    documentId: payload.rag?.document_id,
                    chunks: payload.rag?.chunks,
                  }
                : upload
            )
          );
          refreshDocuments();
        } else {
          setUploads((current) =>
            current.map((upload) =>
              upload.id === item.id
                ? {
                    ...upload,
                    status: "error",
                    error: payload.detail ?? `Upload failed (${xhr.status})`,
                  }
                : upload
            )
          );
        }

        resolve();
      };

      xhr.onerror = () => {
        setUploads((current) =>
          current.map((upload) =>
            upload.id === item.id
              ? { ...upload, status: "error", error: "Backend connection failed" }
              : upload
          )
        );
        resolve();
      };

      xhr.send(formData);
    });
  };

  const uploadQueued = async () => {
    const queued = uploads.filter((item) => item.status === "queued");
    await Promise.all(queued.map((item) => uploadFile(item)));
  };

  const askQuestion = async () => {
    const trimmed = question.trim();
    if (!trimmed || isAsking) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setIsAsking(true);

    try {
      const response = await fetch(`${API_URL}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          question: trimmed,
          limit: 5,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.detail ?? `Query failed (${response.status})`);
      }

      const data = payload as QueryResponse;

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer,
          sources: data.sources,
          notice: data.notice,
          mode: data.mode,
        },
      ]);

      if (data.stats) {
        setStats(data.stats);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "I could not reach the knowledge API.",
          notice: "Check that the FastAPI backend is running on port 8000.",
        },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const queuedCount = uploads.filter((item) => item.status === "queued").length;
  const uploadingCount = uploads.filter((item) => item.status === "uploading").length;
  const successCount = uploads.filter((item) => item.status === "success").length;

  return (
    <main className="min-h-screen bg-[#f6f7fb] text-zinc-950">
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <AutoAwesomeOutlinedIcon fontSize="inherit" />
              OpenAI RAG workspace
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-normal md:text-5xl">
              AI support, sales, and ops answers from your private documents.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 md:text-base">
              Upload files, index them into a per-user vector store, and chat with
              cited answers generated from your knowledge base.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[520px]">
            <Metric label="Documents" value={stats?.documents ?? documents.length} />
            <Metric label="Chunks" value={stats?.chunks ?? 0} />
            <Metric label="Uploaded" value={successCount} />
            <Metric label="Queued" value={queuedCount + uploadingCount} />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-5 xl:grid-cols-[360px_1fr_340px]">
        <aside className="space-y-5">
          <Panel>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">System</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {healthError
                    ? "Backend connection needs attention"
                    : "Backend and indexing status"}
                </p>
              </div>
              <StatusPill healthy={!healthError && health?.status === "ok"} />
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <HealthRow
                icon={
                  healthError ? (
                    <CloudOffOutlinedIcon fontSize="small" />
                  ) : (
                    <CloudDoneOutlinedIcon fontSize="small" />
                  )
                }
                label="API"
                value={healthError ?? "Connected"}
              />
              <HealthRow
                icon={<AutoAwesomeOutlinedIcon fontSize="small" />}
                label="OpenAI"
                value={health?.openai_configured ? "Configured" : "Needs API key"}
              />
              <HealthRow
                icon={<StorageOutlinedIcon fontSize="small" />}
                label="Embeddings"
                value={health?.embedding_model ?? "Checking"}
              />
            </div>
          </Panel>

          <Panel>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Upload</p>
                <p className="mt-1 text-xs text-zinc-500">PDF, DOCX, PPTX, XLSX, CSV, JSON, TXT</p>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                onClick={() => inputRef.current?.click()}
                title="Choose files"
              >
                <CloudUploadOutlinedIcon fontSize="small" />
              </button>
            </div>

            <div
              className={`flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition ${
                isDragging
                  ? "border-emerald-400 bg-emerald-50"
                  : "border-zinc-300 bg-zinc-50"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                addFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <CloudUploadOutlinedIcon className="text-zinc-500" />
              <p className="mt-3 text-sm font-medium">Drop files here</p>
              <p className="mt-1 text-xs text-zinc-500">or use the upload button</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                accept={SUPPORTED_TYPES}
                onChange={handleSelect}
              />
            </div>

            <button
              type="button"
              disabled={queuedCount === 0}
              onClick={uploadQueued}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              <CloudUploadOutlinedIcon fontSize="small" />
              {uploadingCount > 0 ? "Indexing..." : "Upload queued"}
            </button>

            <div className="mt-4 space-y-2">
              <AnimatePresence initial={false}>
                {uploads.map((item) => (
                  <UploadRow key={item.id} item={item} />
                ))}
              </AnimatePresence>
            </div>
          </Panel>
        </aside>

        <section id="chat" className="min-h-[720px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Chat</p>
              <p className="mt-1 text-xs text-zinc-500">
                Workspace: {user?.primaryEmailAddress?.emailAddress ?? userId}
              </p>
            </div>
            <Show when="signed-out">
              <SignInButton>
                <button className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  Sign in
                </button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                Private
              </div>
            </Show>
          </div>

          <div className="h-[570px] space-y-4 overflow-y-auto px-5 py-5">
            {messages.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}

            {isAsking && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-500">
                  Thinking through your sources...
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          <div className="border-t border-zinc-200 p-4">
            <form
              className="flex gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                askQuestion();
              }}
            >
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask about policies, contracts, docs, decks..."
                className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-200 px-4 text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-500"
              />
              <button
                type="submit"
                disabled={!question.trim() || isAsking}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                title="Send"
              >
                <SendOutlinedIcon fontSize="small" />
              </button>
            </form>
          </div>
        </section>

        <aside className="space-y-5">
          <div id="documents">
            <Panel>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Knowledge Base</p>
                <p className="mt-1 text-xs text-zinc-500">{documents.length} indexed documents</p>
              </div>
              <LibraryBooksOutlinedIcon className="text-zinc-500" />
            </div>

            <div className="space-y-2">
              {documents.length === 0 ? (
                <EmptyState />
              ) : (
                documents.map((document) => (
                  <DocumentRow key={document.document_id} document={document} />
                ))
              )}
            </div>
            </Panel>
          </div>

          <Panel>
            <p className="text-sm font-semibold">SaaS Readiness</p>
            <div className="mt-4 space-y-3">
              <ChecklistItem checked label="Per-user workspaces" />
              <ChecklistItem checked label="Document ingestion" />
              <ChecklistItem checked label="Vector retrieval" />
              <ChecklistItem checked label="Cited AI answers" />
              <ChecklistItem checked={Boolean(health?.openai_configured)} label="OpenAI API key" />
            </div>
          </Panel>
        </aside>
      </section>
    </main>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-[#fbfbfd] px-4 py-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs font-medium text-zinc-500">{label}</p>
    </div>
  );
}

function StatusPill({ healthy }: { healthy: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
        healthy ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${healthy ? "bg-emerald-500" : "bg-rose-500"}`} />
      {healthy ? "Online" : "Offline"}
    </div>
  );
}

function HealthRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2">
      <span className="text-zinc-500">{icon}</span>
      <span className="w-20 shrink-0 text-xs font-medium text-zinc-500">{label}</span>
      <span className="min-w-0 truncate text-xs font-semibold text-zinc-800">{value}</span>
    </div>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const extension = item.file.name.split(".").pop()?.toUpperCase() ?? "FILE";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-lg border border-zinc-200 px-3 py-3"
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
            item.status === "success"
              ? "bg-emerald-100 text-emerald-700"
              : item.status === "error"
                ? "bg-rose-100 text-rose-700"
                : "bg-zinc-100 text-zinc-600"
          }`}
        >
          {item.status === "success" ? <CloudDoneOutlinedIcon fontSize="small" /> : extension.slice(0, 4)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{item.file.name}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {item.status === "error"
              ? item.error
              : item.status === "success"
                ? `${item.chunks ?? 0} chunks indexed`
                : `${item.progress}%`}
          </p>
        </div>
      </div>
      {item.status !== "queued" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <div
            className={`h-full rounded-full ${
              item.status === "error" ? "bg-rose-500" : "bg-emerald-500"
            }`}
            style={{ width: `${item.status === "error" ? 100 : item.progress}%` }}
          />
        </div>
      )}
    </motion.div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-lg px-4 py-3 text-sm leading-6 ${
          isUser ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-900"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {message.notice && (
          <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <ErrorOutlineOutlinedIcon fontSize="small" />
            <span>{message.notice}</span>
          </div>
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.sources.slice(0, 3).map((source) => (
              <div key={`${source.index}-${source.filename}`} className="rounded-lg bg-white px-3 py-2 text-xs text-zinc-700">
                <p className="font-semibold">
                  [{source.index}] {source.filename}
                  {source.page ? `, page ${source.page}` : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-zinc-500">{source.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentRow({ document }: { document: KnowledgeDocument }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 px-3 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
        <ArticleOutlinedIcon fontSize="small" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{document.filename}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {document.chunks} chunks
          {document.page_count > 0 ? `, ${document.page_count} pages` : ""}
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center">
      <InsertDriveFileOutlinedIcon className="text-zinc-400" />
      <p className="mt-2 text-sm font-medium">No documents yet</p>
      <p className="mt-1 text-xs text-zinc-500">Upload files to start chatting.</p>
    </div>
  );
}

function ChecklistItem({ checked, label }: { checked: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-zinc-600">{label}</span>
      <span
        className={`rounded-full px-2 py-1 text-xs font-medium ${
          checked ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
        }`}
      >
        {checked ? "Ready" : "Setup"}
      </span>
    </div>
  );
}
