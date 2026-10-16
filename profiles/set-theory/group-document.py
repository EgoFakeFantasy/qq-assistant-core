import sys,json,zipfile,re
from pathlib import Path
import xml.etree.ElementTree as ET
import pymupdf as fitz
sys.stdout.reconfigure(encoding='utf-8')
mode=sys.argv[1];source=Path(sys.argv[2])
if mode=='image':
 with fitz.open(source) as d:
  p=d[0]; scale=min(1,2400/max(p.rect.width,p.rect.height));p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).save(sys.argv[3])
 print(json.dumps({'ok':True}));sys.exit()
if mode=='render':
 with fitz.open(source) as d:
  n=int(sys.argv[3]);assert 1<=n<=len(d);d[n-1].get_pixmap(dpi=125,alpha=False).save(sys.argv[4])
 print(json.dumps({'ok':True}));sys.exit()
ext=source.suffix.lower();pages=[];truncated=False
if ext=='.pdf':
 with fitz.open(source) as d:
  if len(d)>6000:raise ValueError('DOCUMENT_PAGE_LIMIT')
  for i in range(len(d)):pages.append({'page':i+1,'text':d[i].get_text(sort=True)[:16000]})
else:
 if ext in ['.docx','.pptx','.xlsx','.epub','.zip']:
  with zipfile.ZipFile(source) as z:
   infos=z.infolist();assert len(infos)<10000 and sum(i.file_size for i in infos)<100*1024*1024
   if ext=='.zip':text='\n'.join(i.filename for i in infos)
   else:
    patterns={'.docx':r'^word/document\.xml$', '.pptx':r'^ppt/slides/slide\d+\.xml$', '.xlsx':r'^xl/(sharedStrings\.xml|worksheets/sheet\d+\.xml)$', '.epub':r'\.(xhtml|html|htm)$'}
    names=[i for i in z.namelist() if re.search(patterns[ext],i)]
    names.sort(key=lambda n:[int(x) if x.isdigit() else x for x in re.split(r'(\d+)',n)])
    if ext=='.xlsx':
     shared=[]
     if 'xl/sharedStrings.xml' in z.namelist():shared=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))]
     ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};sheets=[]
     for name in names:
      if '/worksheets/' not in name:continue
      rows=[]
      for row in ET.fromstring(z.read(name)).findall('.//s:row',ns):
       cells=[]
       for c in row.findall('s:c',ns):
        value=c.find('s:v',ns);v=value.text if value is not None else ''.join(c.find('s:is',ns).itertext()) if c.find('s:is',ns) is not None else ''
        if c.get('t')=='s' and v.isdigit():v=shared[int(v)] if int(v)<len(shared) else v
        cells.append(c.get('r','')+'='+v)
       rows.append(' | '.join(cells))
      sheets.append(name+'\n'+'\n'.join(rows))
     text='\n\n'.join(sheets)
    else:text='\n\n'.join(' '.join(ET.fromstring(z.read(i)).itertext()) for i in names)
 else:
  raw=source.read_bytes()
  try:text=raw.decode('utf-8-sig')
  except UnicodeError:text=raw.decode('gb18030',errors='replace')
  if ext in ['.html','.htm']:text=re.sub(r'<[^>]*>',' ',text)
 pages=[{'page':i//5000+1,'text':text[i:i+5000]} for i in range(0,len(text),5000)] or [{'page':1,'text':''}]
print(json.dumps({'pages':pages,'isPdf':ext=='.pdf','truncated':truncated},ensure_ascii=False))
