import re


def clean_text(text: str) -> str:
    """
    Basic text cleanup.
    """

    text = text.replace("\x00", "")

    # Normalize excessive whitespace
    text = re.sub(
        r"[ \t]+",
        " ",
        text,
    )

    # Normalize excessive newlines
    text = re.sub(
        r"\n{3,}",
        "\n\n",
        text,
    )

    return text.strip()


def chunk_text(
    text: str,
    chunk_size: int = 1200,
    overlap: int = 200,
) -> list[str]:
    """
    Character-based chunking for the first version.

    Later you can replace this with token-aware
    or semantic chunking.
    """

    text = clean_text(text)

    if not text:
        return []

    chunks = []

    start = 0
    text_length = len(text)

    while start < text_length:

        end = min(
            start + chunk_size,
            text_length,
        )

        chunk = text[start:end]

        # Try not to cut directly in the middle
        # of a sentence.
        if end < text_length:

            last_period = chunk.rfind(". ")

            if last_period > chunk_size * 0.6:
                end = start + last_period + 1
                chunk = text[start:end]

        chunks.append(chunk.strip())

        next_start = end - overlap

        if next_start <= start:
            next_start = end

        start = next_start

    return [
        chunk
        for chunk in chunks
        if chunk
    ]