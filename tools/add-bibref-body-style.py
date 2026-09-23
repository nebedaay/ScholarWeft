#!/usr/bin/env python3
"""Copy the in-body reference paragraph style into the book/article templates.

`[[@key|reference]]` insertions are pre-rendered on export as paragraphs in the
"Bibliographic reference - body" style (see src/convertCitations.ts), which is
defined in the *document* templates. This copies it into book.* and article.*,
so every template sets in-body references apart the same way.

The style only sets the indent — it is a child of the bibliography style
("Bibliography 1" in ODT / "Bibliography" in DOCX), so font and line-height stay
inherited. For ODT, the parent "Bibliography 1" is copied too when a target
lacks it (article.odt); book.odt already has it.

Style names (must match src/convertCitations.ts REFERENCE_BODY_STYLE and the
`swrefbody` environment in the .tex templates):
  DOCX  id   : Bibliographicreference-body   (name "Bibliographic reference - body")
  DOCX parent: Bibliography
  ODT  name  : Bibliographic_20_reference_20_-_20_body
  ODT  parent: Bibliography_20_1 ("Bibliography 1")

Idempotent. Run from anywhere:  python3 tools/add-bibref-body-style.py
"""
import copy
import shutil
import sys
import zipfile
from pathlib import Path
from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
TPL = ROOT / 'sw-export-templates'

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
S = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'


def w(t): return '{%s}%s' % (W, t)
def s(t): return '{%s}%s' % (S, t)
def o(t): return '{%s}%s' % (O, t)


DOCX_STYLE_ID = 'Bibliographicreference-body'
DOCX_PARENT_ID = 'Bibliography'
ODT_STYLE_NAME = 'Bibliographic_20_reference_20_-_20_body'
ODT_PARENT_NAME = 'Bibliography_20_1'


def _rewrite_zip(path, data):
    tmp = str(path) + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        names = list(data)
        if 'mimetype' in names:
            names.remove('mimetype')
            z.writestr(zipfile.ZipInfo('mimetype'), data['mimetype'],
                       compress_type=zipfile.ZIP_STORED)
        for n in names:
            z.writestr(n, data[n])
    shutil.move(tmp, str(path))


def _docx_source_style():
    with zipfile.ZipFile(TPL / 'document.docx') as z:
        root = etree.fromstring(z.read('word/styles.xml'))
    st = next((x for x in root.findall(w('style'))
               if x.get(w('styleId')) == DOCX_STYLE_ID), None)
    if st is None:
        sys.exit('no "%s" style in document.docx' % DOCX_STYLE_ID)
    return st


def add_docx(path, src_style):
    with zipfile.ZipFile(path) as z:
        data = {n: z.read(n) for n in z.namelist()}
    root = etree.fromstring(data['word/styles.xml'])
    for old in root.findall(w('style')):            # idempotent
        if old.get(w('styleId')) == DOCX_STYLE_ID:
            root.remove(old)
    st = copy.deepcopy(src_style)
    anchor = next((x for x in root.findall(w('style'))
                   if x.get(w('styleId')) == DOCX_PARENT_ID), None)
    if anchor is None:
        anchor = next((x for x in root.findall(w('style'))
                       if x.get(w('styleId')) == 'Normal'), None)
    (anchor.addnext(st) if anchor is not None else root.append(st))
    data['word/styles.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)
    _rewrite_zip(path, data)
    print('DOCX %s: added "%s"' % (path.name, DOCX_STYLE_ID))


def _odt_source_styles():
    with zipfile.ZipFile(TPL / 'document.odt') as z:
        root = etree.fromstring(z.read('styles.xml'))
    want = {ODT_STYLE_NAME, ODT_PARENT_NAME}
    out = {}
    for st in root.iter(s('style')):
        if st.get(s('name')) in want:
            out[st.get(s('name'))] = st
    for name in want:
        if name not in out:
            sys.exit('no "%s" style in document.odt' % name)
    return out


def add_odt(path, src_styles):
    with zipfile.ZipFile(path) as z:
        data = {n: z.read(n) for n in z.namelist()}
    root = etree.fromstring(data['styles.xml'])
    styles = root.find(o('styles'))
    if styles is None:
        sys.exit('%s has no <office:styles>' % path.name)

    def find(name):
        return next((x for x in styles.iter(s('style'))
                     if x.get(s('name')) == name), None)

    # Parent ("Bibliography 1") first — the new style is a child of it.
    parent = find(ODT_PARENT_NAME)
    if parent is None:
        parent = copy.deepcopy(src_styles[ODT_PARENT_NAME])
        idx = find('Index')
        (idx.addnext(parent) if idx is not None else styles.append(parent))

    for old in styles.iter(s('style')):             # idempotent
        if old.get(s('name')) == ODT_STYLE_NAME:
            old.getparent().remove(old)
            break
    st = copy.deepcopy(src_styles[ODT_STYLE_NAME])
    parent.addnext(st)
    data['styles.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)
    _rewrite_zip(path, data)
    print('ODT %s: added "%s"' % (path.name, ODT_STYLE_NAME))


if __name__ == '__main__':
    docx_style = _docx_source_style()
    odt_styles = _odt_source_styles()
    for name in ('book', 'article'):
        add_docx(TPL / (name + '.docx'), docx_style)
        add_odt(TPL / (name + '.odt'), odt_styles)
