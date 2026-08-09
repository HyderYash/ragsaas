import os

from openai import OpenAI
from sentence_transformers import SentenceTransformer


OPENAI_MODEL_NAME = os.getenv(
    "OPENAI_EMBEDDING_MODEL",
    "text-embedding-3-small",
)

LOCAL_MODEL_NAME = "all-MiniLM-L6-v2"

_model = None
_client = None


def openai_enabled() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def embedding_provider() -> str:
    if openai_enabled():
        return "openai"

    return "local"


def embedding_model_name() -> str:
    if openai_enabled():
        return OPENAI_MODEL_NAME

    return LOCAL_MODEL_NAME


def get_openai_client() -> OpenAI:
    global _client

    if _client is None:
        _client = OpenAI()

    return _client


def get_model():
    global _model

    if _model is None:
        print(
            f"Loading embedding model: {LOCAL_MODEL_NAME}"
        )

        _model = SentenceTransformer(
            LOCAL_MODEL_NAME
        )

    return _model


def embed_texts_with_openai(
    texts: list[str],
) -> list[list[float]]:
    client = get_openai_client()
    embeddings: list[list[float]] = []

    batch_size = 64

    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]

        response = client.embeddings.create(
            model=OPENAI_MODEL_NAME,
            input=batch,
        )

        sorted_data = sorted(
            response.data,
            key=lambda item: item.index,
        )

        embeddings.extend(
            item.embedding
            for item in sorted_data
        )

    return embeddings


def embed_texts_locally(
    texts: list[str],
) -> list[list[float]]:
    model = get_model()

    embeddings = model.encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    return embeddings.tolist()


def embed_texts(
    texts: list[str],
) -> list[list[float]]:
    if not texts:
        return []

    if openai_enabled():
        return embed_texts_with_openai(texts)

    return embed_texts_locally(texts)


def embed_query(
    query: str,
) -> list[float]:

    return embed_texts([query])[0]
