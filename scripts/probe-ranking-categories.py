import json,re
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
options=webdriver.ChromeOptions()
options.add_argument('--headless')
options.add_argument('--no-sandbox')
options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3')
driver=webdriver.Chrome(options=options)
try:
 driver.set_page_load_timeout(40)
 driver.get('https://www.oliveyoung.co.kr/store/main/getBestList.do')
 WebDriverWait(driver,30).until(lambda d: len(d.find_elements('css selector','.cate_prd_list .prd_info'))>=100)
 result=driver.execute_script('''
 const cards=Array.from(document.querySelectorAll('.cate_prd_list .prd_info'));
 return {title:document.title,count:cards.length,products:cards.map(c=>({name:c.querySelector('.tx_name')?.textContent,links:Array.from(c.querySelectorAll('a')).map(a=>({href:a.getAttribute('href'),onclick:a.getAttribute('onclick'),attrs:Array.from(a.attributes).filter(x=>/cate|data|tracking/i.test(x.name)).map(x=>[x.name,x.value])})),categoryFragments:c.outerHTML.match(/.{0,100}(?:dispCat|category|cateNo|catNo|item_category|카테고리).{0,200}/gi)||[]})),scripts:Array.from(document.scripts).map(s=>s.textContent).filter(t=>/item_category|dispCat|cateNo|catNo/i.test(t)).map(t=>t.match(/.{0,100}(?:item_category|dispCat|cateNo|catNo).{0,200}/gi)).flat().slice(0,60)};
 ''')
 Path('data/ranking-category-probe.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'count':result['count'],'sample':result['products'][:2],'scripts':result['scripts'][:10]},ensure_ascii=False))
finally: driver.quit()
