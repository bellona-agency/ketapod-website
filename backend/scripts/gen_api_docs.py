#!/usr/bin/env python3
"""تولید سند خوانای هر نسخه API از روی خود قرارداد.

سند دستی‌نوشته از قرارداد جدا می‌افتد — همیشه. این اسکریپت جدول
endpointها را از openapi.yaml می‌سازد تا آن بخش نتواند دروغ بگوید؛ فقط
متن سرآیند دستی است.

    make api-docs
"""
import collections
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
TAG_ORDER = ["home", "leads", "auth", "me", "catalog", "media",
             "library", "commerce", "kids", "admin"]


def auth_label(op):
    security = op.get("security")
    if security is None:
        return "عمومی"
    if any(entry == {} for entry in security):
        return "اختیاری"
    return "لازم"


def endpoint_tables(spec):
    tag_desc = {t["name"]: t.get("description", "") for t in spec.get("tags", [])}
    by_tag = collections.defaultdict(list)

    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            by_tag[(op.get("tags") or ["other"])[0]].append((method.upper(), path, op))

    out = ["\n## فهرست endpointها\n"]
    ordered = TAG_ORDER + [t for t in by_tag if t not in TAG_ORDER]
    for tag in ordered:
        if tag not in by_tag:
            continue
        out.append(f"\n### {tag}\n")
        if tag_desc.get(tag):
            out.append(f"{tag_desc[tag]}\n")
        out.append("\n| متد | مسیر | احراز هویت | شرح |")
        out.append("\n|---|---|:-:|---|")
        for method, path, op in sorted(by_tag[tag], key=lambda row: row[1]):
            summary = (op.get("summary") or op.get("operationId", "")).replace("|", "/").strip()
            out.append(f"\n| `{method}` | `{path}` | {auth_label(op)} | {summary} |")
        out.append("\n")
    return "".join(out)


def main(version):
    spec_path = ROOT / "backend" / "api" / version / "openapi.yaml"
    doc_path = ROOT / "docs" / "api" / f"{version}.md"

    spec = yaml.safe_load(spec_path.read_text())
    existing = doc_path.read_text() if doc_path.exists() else ""

    marker = "\n## فهرست endpointها\n"
    if marker not in existing:
        print(f"{doc_path}: سرآیند دستی پیدا نشد؛ اول آن را بنویس", file=sys.stderr)
        return 1

    head = existing.split(marker)[0]
    tail_marker = "\n## وقتی v2 بیاید\n"
    tail = tail_marker + existing.split(tail_marker)[1] if tail_marker in existing else ""

    doc_path.write_text(head + endpoint_tables(spec) + tail)
    print(f"wrote {doc_path.relative_to(ROOT)} ({len(spec['paths'])} paths)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "v1"))
