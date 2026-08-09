from pathlib import Path
import os

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException,
)

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

import shutil

load_dotenv()


# ============================================================
# RAG IMPORTS
# ============================================================

from rag.pipeline import ingest_document
from rag.embeddings import (
    embed_query,
    embedding_model_name,
    embedding_provider,
    openai_enabled,
)
from rag.vector_store import collection_stats, list_documents, search


# ============================================================
# APP
# ============================================================

app = FastAPI(
    title="RAG SaaS API",
    description="Document upload and RAG API",
    version="1.0.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# STORAGE
# ============================================================

UPLOAD_DIR = Path("uploads")
ALLOWED_EXTENSIONS = {
    ".csv",
    ".docx",
    ".json",
    ".md",
    ".pdf",
    ".pptx",
    ".txt",
    ".xlsx",
}
CHAT_MODEL = os.getenv(
    "OPENAI_CHAT_MODEL",
    "gpt-5.6",
)

UPLOAD_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "RAG API is running",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "openai_configured": openai_enabled(),
        "embedding_provider": embedding_provider(),
        "embedding_model": embedding_model_name(),
        "chat_model": CHAT_MODEL,
        "allowed_file_types": sorted(ALLOWED_EXTENSIONS),
    }


# ============================================================
# CREATE UNIQUE ORIGINAL FILENAME
# ============================================================

def get_unique_filename(
    folder: Path,
    filename: str,
) -> Path:

    original_path = folder / filename

    # --------------------------------------------------------
    # Filename doesn't exist
    # --------------------------------------------------------

    if not original_path.exists():
        return original_path

    # --------------------------------------------------------
    # Filename already exists
    #
    # report.pdf
    # report (1).pdf
    # report (2).pdf
    # --------------------------------------------------------

    stem = original_path.stem
    suffix = original_path.suffix

    counter = 1

    while True:

        new_filename = (
            f"{stem} ({counter}){suffix}"
        )

        new_path = folder / new_filename

        if not new_path.exists():
            return new_path

        counter += 1


def validate_user_id(
    user_id: str,
) -> str:
    user_id = user_id.strip()

    if not user_id:
        raise HTTPException(
            status_code=400,
            detail="user_id is required",
        )

    return user_id


def validate_file_extension(
    filename: str,
) -> None:
    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported file type. Supported types: "
                + ", ".join(sorted(ALLOWED_EXTENSIONS))
            ),
        )


# ============================================================
# UPLOAD DOCUMENT
# ============================================================

@app.post("/upload")
async def upload_file(
    user_id: str = Form(...),
    file: UploadFile = File(...),
):

    # --------------------------------------------------------
    # Validate user ID
    # --------------------------------------------------------

    user_id = validate_user_id(user_id)

    # --------------------------------------------------------
    # Validate filename
    # --------------------------------------------------------

    if not file.filename:

        raise HTTPException(
            status_code=400,
            detail="File name is required",
        )

    # --------------------------------------------------------
    # Sanitize filename
    #
    # Prevent:
    #
    # ../../something.pdf
    #
    # from escaping the user's folder.
    # --------------------------------------------------------

    original_name = Path(
        file.filename
    ).name

    validate_file_extension(original_name)

    # --------------------------------------------------------
    # Create user directory
    # --------------------------------------------------------

    user_folder = UPLOAD_DIR / user_id

    user_folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    # --------------------------------------------------------
    # Determine final filename
    # --------------------------------------------------------

    file_path = get_unique_filename(
        user_folder,
        original_name,
    )

    # --------------------------------------------------------
    # Save original document
    # --------------------------------------------------------

    try:

        with file_path.open("wb") as buffer:

            shutil.copyfileobj(
                file.file,
                buffer,
            )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                f"Could not save file: {str(e)}"
            ),
        )

    # --------------------------------------------------------
    # RAG INGESTION
    # --------------------------------------------------------

    try:

        rag_result = ingest_document(
            file_path=file_path,
            user_id=user_id,
        )

    except Exception as e:

        # ----------------------------------------------------
        # If ingestion fails, the original file remains saved.
        #
        # This is useful because we can retry ingestion later.
        # ----------------------------------------------------

        raise HTTPException(
            status_code=500,
            detail=(
                f"Document processing failed: {str(e)}"
            ),
        )

    # --------------------------------------------------------
    # Response
    # --------------------------------------------------------

    return {
        "success": True,

        "user_id": user_id,

        "filename": original_name,

        "stored_as": file_path.name,

        "path": str(file_path),

        "rag": rag_result,
    }


# ============================================================
# QUERY MODEL
# ============================================================

class QueryRequest(BaseModel):

    user_id: str

    question: str

    limit: int = 5


def build_context(
    results: list[dict],
) -> str:
    context_blocks = []

    for index, result in enumerate(results, start=1):
        metadata = result.get("metadata") or {}
        filename = metadata.get("filename", "Untitled document")
        page = metadata.get("page")
        page_label = f", page {page}" if page else ""

        context_blocks.append(
            (
                f"[{index}] {filename}{page_label}\n"
                f"{result.get('text', '')}"
            )
        )

    return "\n\n".join(context_blocks)


def fallback_answer(
    question: str,
    results: list[dict],
    notice: str | None = None,
) -> dict:
    if not results:
        answer = (
            "I could not find relevant document context yet. "
            "Upload a document, wait for indexing to finish, then ask again."
        )
    else:
        excerpts = []

        for index, result in enumerate(results[:3], start=1):
            text = " ".join(
                result.get("text", "").split()
            )
            excerpts.append(
                f"[{index}] {text[:600]}"
            )

        answer = (
            "I found relevant source material, but OpenAI answer generation "
            "is not available in this environment. Here are the strongest "
            f"matches for: {question}\n\n"
            + "\n\n".join(excerpts)
        )

    return {
        "answer": answer,
        "mode": "retrieval_fallback",
        "notice": notice,
    }


def generate_answer(
    question: str,
    results: list[dict],
) -> dict:
    if not results:
        return fallback_answer(question, results)

    if not openai_enabled():
        return fallback_answer(
            question,
            results,
            "Set OPENAI_API_KEY in backend/.env to enable OpenAI-generated answers.",
        )

    client = OpenAI()
    context = build_context(results)

    try:
        response = client.responses.create(
            model=CHAT_MODEL,
            instructions=(
                "You are a concise SaaS knowledge-base assistant. "
                "Answer only from the provided source excerpts. "
                "When a claim comes from a source, cite it with [1], [2], etc. "
                "If the sources do not answer the question, say what is missing."
            ),
            input=(
                f"Question:\n{question}\n\n"
                f"Source excerpts:\n{context}"
            ),
        )

        usage = None

        if getattr(response, "usage", None):
            usage = response.usage.model_dump()

        return {
            "answer": response.output_text,
            "mode": "openai_responses",
            "model": CHAT_MODEL,
            "usage": usage,
            "notice": None,
        }

    except Exception as exc:
        return fallback_answer(
            question,
            results,
            f"OpenAI generation failed: {str(exc)}",
        )


def source_payload(
    results: list[dict],
) -> list[dict]:
    sources = []

    for index, result in enumerate(results, start=1):
        metadata = result.get("metadata") or {}

        sources.append(
            {
                "index": index,
                "text": result.get("text", ""),
                "filename": metadata.get(
                    "filename",
                    "Untitled document",
                ),
                "page": metadata.get("page"),
                "document_id": metadata.get("document_id"),
                "chunk_index": metadata.get("chunk_index"),
                "distance": result.get("distance"),
            }
        )

    return sources


@app.get("/documents")
def documents(
    user_id: str,
):
    user_id = validate_user_id(user_id)

    documents = list_documents(user_id)

    return {
        "success": True,
        "user_id": user_id,
        "documents": documents,
        "stats": collection_stats(user_id),
    }


# ============================================================
# RAG QUERY
# ============================================================

@app.post("/query")
async def query_documents(
    request: QueryRequest,
):
    request.user_id = validate_user_id(
        request.user_id
    )


    # --------------------------------------------------------
    # Validate question
    # --------------------------------------------------------

    if not request.question.strip():

        raise HTTPException(
            status_code=400,
            detail="Question is required",
        )

    # --------------------------------------------------------
    # Generate query embedding
    # --------------------------------------------------------

    try:

        query_embedding = embed_query(
            request.question
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to generate query embedding: {str(e)}"
            ),
        )

    # --------------------------------------------------------
    # Search user's documents
    # --------------------------------------------------------

    try:

        results = search(
            user_id=request.user_id,
            query_embedding=query_embedding,
            limit=max(
                1,
                min(request.limit, 10),
            ),
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=(
                f"Vector search failed: {str(e)}"
            ),
        )

    generated = generate_answer(
        request.question,
        results,
    )

    return {
        "success": True,

        "question": request.question,

        "answer": generated["answer"],

        "mode": generated["mode"],

        "model": generated.get("model"),

        "notice": generated.get("notice"),

        "usage": generated.get("usage"),

        "sources": source_payload(results),

        "stats": collection_stats(request.user_id),
    }
