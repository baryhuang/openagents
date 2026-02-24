"""Shared utilities for adapter implementations."""
import re

SESSION_DEFAULT_RE = re.compile(r"^Session \d+$")


def generate_session_title(message: str, max_words: int = 6) -> str:
    """Generate a short session title from the first user message.

    Strategy:
    1. Strip markdown/code fences
    2. Take the first sentence (up to sentence-ending punctuation)
    3. Fall back to first max_words words
    4. Strip leading filler words
    5. Capitalize first letter, cap at 50 chars
    """
    # Collapse whitespace, strip code blocks
    text = re.sub(r"\s+", " ", message).strip()
    text = re.sub(r"```[\s\S]*?```", "", text).strip()
    text = re.sub(r"`[^`]+`", "", text).strip()

    if not text:
        return ""

    # Try to get first sentence
    sentence_match = re.match(r"^(.+?[.!?])\s", text)
    if sentence_match:
        text = sentence_match.group(1).rstrip(".!?").strip()

    # Take first max_words words
    words = text.split()
    if len(words) > max_words:
        words = words[:max_words]
        text = " ".join(words)

    # Strip common filler prefixes
    filler_re = re.compile(
        r"^(hey|hi|hello|please|can you|could you|"
        r"i need you to|i want you to)\s+",
        re.IGNORECASE,
    )
    text = filler_re.sub("", text).strip()

    # Capitalize first letter
    if text:
        text = text[0].upper() + text[1:]

    # Hard cap at 50 characters
    if len(text) > 50:
        text = text[:47] + "..."

    return text
