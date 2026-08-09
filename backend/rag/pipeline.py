from pathlib import Path
import uuid

from .parser import parse_document
from .chunker import chunk_text
from .embeddings import embed_texts
from .vector_store import add_chunks


def ingest_document(
    file_path: Path,
    user_id: str,
) -> dict:

    # ========================================================
    # 1. Parse document
    # ========================================================

    pages = parse_document(
        file_path
    )

    if not pages:
        raise ValueError(
            "No text could be extracted from document"
        )

    # ========================================================
    # 2. Chunk
    # ========================================================

    chunks = []

    for page in pages:

        page_chunks = chunk_text(
            page["text"]
        )

        for chunk in page_chunks:

            chunks.append(
                {
                    "text": chunk,
                    "page": page["page"],
                }
            )

    if not chunks:
        raise ValueError(
            "Document produced no chunks"
        )

    # ========================================================
    # 3. Generate embeddings
    # ========================================================

    texts = [
        chunk["text"]
        for chunk in chunks
    ]

    embeddings = embed_texts(
        texts
    )

    # ========================================================
    # 4. Metadata
    # ========================================================

    document_id = str(
        uuid.uuid4()
    )

    ids = []

    metadatas = []

    for index, chunk in enumerate(chunks):

        chunk_id = (
            f"{document_id}_{index}"
        )

        ids.append(chunk_id)

        metadatas.append(
            {
                "user_id": user_id,
                "document_id": document_id,
                "filename": file_path.name,
                "page": chunk["page"] or 0,
                "chunk_index": index,
            }
        )

    # ========================================================
    # 5. Store vectors
    # ========================================================

    add_chunks(
        user_id=user_id,
        chunks=texts,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=ids,
    )

    # ========================================================
    # 6. Return result
    # ========================================================

    return {
        "document_id": document_id,
        "filename": file_path.name,
        "chunks": len(chunks),
    }