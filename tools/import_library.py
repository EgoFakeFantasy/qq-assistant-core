"""Build a private, resumable PDF corpus with native text, OCR and original pages."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[1]

def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".pending")
    pending.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(pending, path)

def recognize(page, destination, engine, language):
    destination.mkdir(parents=True, exist_ok=True)
    image, result = destination / "page.png", destination / "result.json"
    scale = min(180 / 72, 2500 / max(page.rect.width, page.rect.height))
    page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False).save(image)
    if engine == "windows":
        executable = shutil.which("powershell.exe")
        if not executable:
            raise RuntimeError("WINDOWS_OCR_UNAVAILABLE")
        command = [executable, "-NoProfile", "-File", str(ROOT / "deployment/windows-ocr.ps1"),
                   "-Image", str(image), "-Output", str(result), "-Language", language]
        subprocess.run(command, check=True, capture_output=True, timeout=90)
        data = json.loads(result.read_text(encoding="utf-8-sig"))
        return "\n".join(data.get("lines", [])) or data.get("text", ""), data.get("engine", "Windows.Media.Ocr")
    if engine == "tesseract":
        executable = shutil.which("tesseract")
        if not executable:
            raise RuntimeError("TESSERACT_UNAVAILABLE")
        prefix = destination / "tesseract"
        subprocess.run([executable, str(image), str(prefix), "-l", language],
                       check=True, capture_output=True, timeout=90)
        return prefix.with_suffix(".txt").read_text(encoding="utf-8"), "tesseract/" + language
    raise RuntimeError("OCR_NOT_CONFIGURED")

def build(source, output, ocr="none", language=None, allow_unsupported=False, ocr_page=None):
    source, output = Path(source).resolve(strict=True), Path(output).resolve()
    if not source.is_dir() or output == source or source in output.parents:
        raise ValueError("SEPARATE_SOURCE_AND_OUTPUT_DIRECTORIES_REQUIRED")
    if Path(output).is_symlink():
        raise ValueError("LINKED_OUTPUT_REFUSED")
    files, unsupported = [], []
    for base, directories, names in os.walk(source, followlinks=False):
        for name in list(directories):
            entry = Path(base) / name
            if entry.is_symlink():
                unsupported.append({"file": entry.relative_to(source).as_posix(), "reason": "linked-directory"})
                directories.remove(name)
        for name in names:
            file = Path(base) / name
            if file.is_symlink() or not file.resolve().is_relative_to(source):
                unsupported.append({"file": file.relative_to(source).as_posix(), "reason": "linked-file"})
            elif file.suffix.lower() != ".pdf":
                unsupported.append({"file": file.relative_to(source).as_posix(), "reason": "not-pdf-use-group-document-reader"})
            elif file.stat().st_size > 100 * 1024 * 1024:
                unsupported.append({"file": file.relative_to(source).as_posix(), "reason": "file-size-limit"})
            else:
                files.append(file)
    output.mkdir(parents=True, exist_ok=True)
    if unsupported and not allow_unsupported:
        atomic(output / "inventory.json", {"unsupported": unsupported, "complete": False})
        raise ValueError("UNSUPPORTED_INPUTS_REVIEW_INVENTORY_JSON")
    if not files:
        raise ValueError("NO_PDF_FILES")
    if ocr == "auto":
        ocr = "windows" if sys.platform == "win32" else "tesseract" if shutil.which("tesseract") else "none"
    language = language or ("zh-Hans-CN" if ocr == "windows" else "eng")
    corpus, cache = output / "corpus", output / "ocr"
    corpus.mkdir(exist_ok=True)
    books, pages, inventory, pending, blank = [], [], [], [], 0
    by_hash = {}
    for file in sorted(files):
        with file.open("rb") as handle:
            book_id = hashlib.file_digest(handle, "sha256").hexdigest()
        alias = file.relative_to(source).as_posix()
        if book_id in by_hash:
            by_hash[book_id]["sourceNames"].append(alias)
            by_hash[book_id]["aliases"].extend([file.name, file.stem])
            inventory.append({"file": alias, "bookId": book_id, "duplicate": True})
            continue
        target = corpus / (book_id + ".pdf")
        if target.is_symlink():
            raise ValueError("LINKED_CORPUS_FILE")
        if target.exists():
            with target.open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != book_id:
                    raise ValueError("CORPUS_HASH_MISMATCH")
        else:
            shutil.copyfile(file, target)
        with fitz.open(target) as document:
            if not 0 < len(document) <= 6000 or document.needs_pass:
                raise ValueError("UNREADABLE_OR_OVERSIZE_PDF")
            title = (document.metadata.get("title") or file.stem).strip()[:300]
            book = {"bookId": book_id, "title": title, "pages": len(document), "file": target.name,
                    "sourceNames": [alias], "aliases": [file.name, file.stem, title],
                    "pdfToc": [{"level": a, "title": b, "pdfPage": c} for a, b, c in document.get_toc()
                               if 1 <= c <= len(document)]}
            by_hash[book_id] = book
            books.append(book)
            for number, page in enumerate(document, 1):
                text, kind, engine = page.get_text(sort=True).strip(), "text-layer", None
                if len("".join(text.split())) < 30:
                    if not text and not page.get_images() and not page.get_drawings():
                        blank += 1
                        continue
                    saved = cache / book_id / (str(number) + ".json")
                    if saved.is_symlink():
                        raise ValueError("LINKED_OCR_CACHE")
                    if saved.exists():
                        data = json.loads(saved.read_text(encoding="utf-8"))
                        text, engine = data["text"], data["engine"]
                    elif ocr != "none" or ocr_page:
                        try:
                            text, engine = (ocr_page or recognize)(page, cache / "work" / book_id / str(number), ocr, language)
                            atomic(saved, {"text": text, "engine": engine, "formulaAccuracyVerified": False})
                        except Exception:
                            text = ""
                    else:
                        text = ""
                    kind = "ocr"
                    if not text.strip():
                        pending.append({"bookId": book_id, "page": number, "reason": "ocr-required-or-empty"})
                        continue
                entry = {"bookId": book_id, "title": title, "page": number, "text": text[:16000], "sourceType": kind}
                if kind == "ocr":
                    entry.update(ocrEngine=engine, formulaAccuracyVerified=False)
                pages.append(entry)
            inventory.append({"file": alias, "bookId": book_id, "pages": len(document), "duplicate": False})
    report = {"version": 1, "complete": not pending and not unsupported, "pdfFiles": len(files),
              "uniqueBooks": len(books), "indexedPages": len(pages), "blankPages": blank,
              "ocrPending": pending, "unsupported": unsupported, "sourcePdfsModified": False,
              "formulaAccuracyVerified": False, "files": inventory}
    atomic(corpus / "manifest.json", {"version": 1, "books": books})
    atomic(output / "pages.json", {"version": 1, "pages": pages})
    atomic(output / "import-report.json", report)
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "private/knowledge")
    parser.add_argument("--ocr", choices=["none", "auto", "windows", "tesseract"], default="none")
    parser.add_argument("--language")
    parser.add_argument("--allow-unsupported", action="store_true")
    args = parser.parse_args()
    try:
        report = build(args.source, args.output, args.ocr, args.language, args.allow_unsupported)
        print(json.dumps({key: report[key] for key in ["complete", "pdfFiles", "uniqueBooks", "indexedPages", "blankPages"]}))
        sys.exit(0 if report["complete"] else 2)
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
