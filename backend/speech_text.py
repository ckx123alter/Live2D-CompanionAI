import re
from html import escape


ELLIPSIS_PAUSE_MS = 600
ELLIPSIS = re.compile(r"(?:…|\.{3,})+")


def doubao_ssml(text: str) -> str | None:
    """Keep displayed text intact; normalize each ellipsis run to one pause."""
    if not ELLIPSIS.search(text):
        return None
    pause = f'<break time="{ELLIPSIS_PAUSE_MS}ms"/>'
    # Escape all dialogue so model/user text cannot inject SSML instructions.
    return "<speak>" + pause.join(escape(part) for part in ELLIPSIS.split(text)) + "</speak>"
