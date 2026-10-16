"""Local-only PDF text-layer index. No OCR, network, model, or credentials."""
import argparse
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader


def build(source, output, report):
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError('source must be a directory')
    pages, books = [], []
    for file in sorted(source.glob('*.pdf')):
        if file.is_symlink() or file.resolve().parent != source:
            raise ValueError('linked source refused')
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        reader = PdfReader(str(file))
        summary = dict(title=file.name, bookId=digest, totalPages=len(reader.pages),
                       textPages=0, emptyPages=0, failedPages=[], ocrPerformed=False)
        for number, page in enumerate(reader.pages, 1):
            try:
                text = page.extract_text() or ''
            except Exception:
                summary['failedPages'].append(number)
                continue
            if len(text.strip()) >= 40:
                pages.append(dict(bookId=digest, title=file.stem, page=number, text=text))
                summary['textPages'] += 1
            else:
                summary['emptyPages'] += 1
        summary['status'] = 'text-layer-only-not-math-validated' if summary['textPages'] else 'requires-page-images-or-OCR'
        books.append(summary)
    if not books:
        raise ValueError('no PDFs found')
    for target, data in [(output, dict(version=1, pages=pages)), (report, dict(version=1, books=books, indexedPages=len(pages)))]:
        target.parent.mkdir(parents=True, exist_ok=True)
        # Refuse accidental overwrite. Private index is deliberately excluded from the handoff archive.
        with target.open('x', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False)
    print(json.dumps(dict(books=len(books), indexedPages=len(pages), ocrPerformed=False)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    build(args.source, args.output, args.report)
