from pathlib import Path
import re

import chromadb

from .embeddings import embedding_model_name, embedding_provider


CHROMA_DIR = Path("chroma")

client = chromadb.PersistentClient(
    path=str(CHROMA_DIR)
)


def safe_collection_part(value: str) -> str:
    value = re.sub(
        r"[^a-zA-Z0-9_-]+",
        "_",
        value,
    ).strip("_")

    return value or "default"


def collection_name_for_user(
    user_id: str,
) -> str:
    provider = safe_collection_part(
        embedding_provider()
    )
    model = safe_collection_part(
        embedding_model_name()
    )
    user = safe_collection_part(user_id)

    return f"kb_{provider}_{model}_{user}"[:512]


def get_collection(
    user_id: str,
):
    """
    Each user and embedding model gets its own collection.
    """

    return client.get_or_create_collection(
        name=collection_name_for_user(user_id),
        metadata={
            "hnsw:space": "cosine",
            "provider": embedding_provider(),
            "model": embedding_model_name(),
        },
    )


def add_chunks(
    user_id: str,
    chunks: list[str],
    embeddings: list[list[float]],
    metadatas: list[dict],
    ids: list[str],
):
    collection = get_collection(user_id)

    collection.add(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
    )


def search(
    user_id: str,
    query_embedding: list[float],
    limit: int = 5,
):
    collection = get_collection(user_id)

    if collection.count() == 0:
        return []

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(
            limit,
            collection.count(),
        ),
        include=[
            "documents",
            "metadatas",
            "distances",
        ],
    )

    output = []

    documents = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]

    for document, metadata, distance in zip(
        documents,
        metadatas,
        distances,
    ):
        output.append(
            {
                "text": document,
                "metadata": metadata,
                "distance": distance,
            }
        )

    return output


def list_documents(
    user_id: str,
) -> list[dict]:
    collection = get_collection(user_id)

    if collection.count() == 0:
        return []

    records = collection.get(
        include=[
            "metadatas",
        ],
    )

    documents: dict[str, dict] = {}

    for metadata in records.get("metadatas", []):
        if not metadata:
            continue

        document_id = metadata.get("document_id")

        if not document_id:
            continue

        document = documents.setdefault(
            document_id,
            {
                "document_id": document_id,
                "filename": metadata.get(
                    "filename",
                    "Untitled document",
                ),
                "chunks": 0,
                "pages": set(),
            },
        )

        document["chunks"] += 1

        page = metadata.get("page")

        if page:
            document["pages"].add(page)

    output = []

    for document in documents.values():
        pages = sorted(document.pop("pages"))
        document["pages"] = pages
        document["page_count"] = len(pages)
        output.append(document)

    return sorted(
        output,
        key=lambda item: item["filename"].lower(),
    )


def collection_stats(
    user_id: str,
) -> dict:
    documents = list_documents(user_id)

    return {
        "documents": len(documents),
        "chunks": sum(
            document["chunks"]
            for document in documents
        ),
        "embedding_provider": embedding_provider(),
        "embedding_model": embedding_model_name(),
    }
