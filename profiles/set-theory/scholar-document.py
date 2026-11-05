"""Bounded extraction with explicit coverage; never silently call sampled pages full text."""
import json
import sys
from pathlib import Path

def ranges(numbers):
    result = []
    for n in numbers:
        if result and result[-1][1] + 1 == n:
            result[-1][1] = n
        else:
            result.append([n, n])
    return result

def extract(path):
    try:
        import pymupdf as fitz
    except ImportError:
        from pypdf import PdfReader
        document = PdfReader(str(path))
        count = len(document.pages)
        text = lambda i: document.pages[i].extract_text() or ""
    else:
        document = fitz.open(str(path))
        count = len(document)
        text = lambda i: document[i].get_text()
    selected = list(range(count)) if count <= 36 else list(range(24)) + list(range(count - 6, count))
    pages = []
    for i in selected:
        value = text(i)
        pages.append({"page": i + 1, "text": value[:20000], "truncated": len(value) > 20000})
    selected_set = set(selected)
    return {"pageCount": count, "pages": pages,
            "readRanges": ranges([i + 1 for i in selected]),
            "missingRanges": ranges([i + 1 for i in range(count) if i not in selected_set]),
            "truncatedPages": [p["page"] for p in pages if p["truncated"]]}

if __name__ == "__main__":
    path = Path(sys.argv[1]).resolve(strict=True)
    if path.suffix.lower() != ".pdf" or path.stat().st_size > 24 * 1024 * 1024:
        raise ValueError("PAPER_PDF_REQUIRED")
    print(json.dumps(extract(path), ensure_ascii=True))
