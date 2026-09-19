"""Minimal xlsx reader — no sharedStrings in this workbook, so cells carry
inline strings. Returns each sheet as a list of row lists."""
import re, pathlib, html

BASE = pathlib.Path(__file__).parent / "workbook"

def sheets():
    wb = (BASE / "xl/workbook.xml").read_text()
    rels = (BASE / "xl/_rels/workbook.xml.rels").read_text()
    # Attribute order varies by writer, so match each Relationship element and
    # pull the two attributes out of it independently.
    target = {}
    for rel in re.findall(r"<Relationship\b[^>]*/?>", rels):
        rid = re.search(r'Id="([^"]+)"', rel)
        tgt = re.search(r'Target="([^"]+)"', rel)
        if rid and tgt:
            target[rid.group(1)] = tgt.group(1)
    out = []
    for m in re.finditer(r'<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"', wb):
        out.append((html.unescape(m.group(1)), BASE / target[m.group(2)].lstrip("/")))
    return out

def col_index(ref):
    letters = re.match(r"([A-Z]+)", ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1

def read(path):
    xml = path.read_text()
    rows = []
    for row_xml in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        cells = {}
        for c in re.finditer(r'<c r="([A-Z]+\d+)"([^>]*)>(.*?)</c>', row_xml, re.S):
            ref, attrs, body = c.group(1), c.group(2), c.group(3)
            if 'inlineStr' in attrs:
                texts = re.findall(r"<t[^>]*>(.*?)</t>", body, re.S)
                val = "".join(texts)
            else:
                v = re.search(r"<v>(.*?)</v>", body, re.S)
                val = v.group(1) if v else ""
            cells[col_index(ref)] = html.unescape(val).strip()
        if cells:
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
    return rows
