import argparse,hashlib,json,shutil
from pathlib import Path
import pymupdf as fitz

def build(source,target):
 target.mkdir(parents=True,exist_ok=True); books=[]
 for p in sorted(source.glob('*.pdf')):
  h=hashlib.sha256()
  with p.open('rb') as f:
   for b in iter(lambda:f.read(1048576),b''):h.update(b)
  bid=h.hexdigest(); dest=target/(bid+'.pdf')
  if not dest.exists():shutil.copy2(p,dest)
  with fitz.open(dest) as doc:
   title=p.stem
   if '第一卷' in title:title='冯琦《集合论导引》第一卷：基本理论'
   elif '第2卷' in title:title='冯琦《集合论导引》第二卷'
   elif '第三卷' in title:title='冯琦《集合论导引》第三卷：高阶无穷'
   elif title.lower().startswith('set theory'):title='Thomas Jech: Set Theory (English)'
   elif 'jech' in title.lower():title='Jech《集合论》中译本'
   else:title=p.stem
   books.append(dict(bookId=bid,title=title,pages=len(doc),file=dest.name))
 (target/'manifest.json').write_text(json.dumps(dict(version=1,books=books),ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(dict(books=len(books),manifest=str(target/'manifest.json'))))

def render(source,page,output):
 with fitz.open(source) as doc:
  if page<1 or page>len(doc):raise ValueError('PAGE_OUT_OF_RANGE')
  doc[page-1].get_pixmap(dpi=125,alpha=False).save(output)

if __name__=='__main__':
 parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='command',required=True)
 b=sub.add_parser('build');b.add_argument('source',type=Path);b.add_argument('target',type=Path)
 r=sub.add_parser('render');r.add_argument('source',type=Path);r.add_argument('page',type=int);r.add_argument('output',type=Path)
 a=parser.parse_args()
 if a.command=='build':build(a.source,a.target)
 else:render(a.source,a.page,a.output)