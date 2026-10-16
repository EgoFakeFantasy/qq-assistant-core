"""Bounded text extraction from a public paper downloaded into a private workspace."""
import json, sys
from pathlib import Path

path = Path(sys.argv[1]).resolve(strict=True)
if path.suffix.lower() != ".pdf" or path.stat().st_size > 24 * 1024 * 1024:
    raise ValueError("PAPER_PDF_LIMIT")
try:
    import pymupdf as fitz
    document = fitz.open(str(path))
    count = document.page_count
    selected = list(range(count)) if count <= 36 else list(range(24)) + list(range(max(24, count - 6), count))
    pages = [{"page": i + 1, "text": document[i].get_text()[:20000]} for i in selected]
    document.close()
except ImportError:
    from pypdf import PdfReader
    document = PdfReader(str(path))
    count = len(document.pages)
    selected = list(range(count)) if count <= 36 else list(range(24)) + list(range(max(24, count - 6), count))
    pages = [{"page": i + 1, "text": (document.pages[i].extract_text() or "")[:20000]} for i in selected]
# No OCR guessing: image-only papers keep their abstract as the usable reading scope.
print(json.dumps({"pageCount": count, "pages": pages}, ensure_ascii=True))
