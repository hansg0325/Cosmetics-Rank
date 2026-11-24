import detailSource from "./detail.browser.txt";

const common = `
const detailSource = ${JSON.stringify(detailSource)};
const read = (row) => page.evaluate(({source,id,name}) => new Function(source)(id,name), {source:detailSource,id:row.id,name:row.name});
const visit = async (url, row) => {
  let status=null, error=null;
  try { const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000}); status=response?.status(); }
  catch(e) { error=e.name; }
  if(status!==403 && status!==429) {
    try {
      if(row) await page.waitForFunction(({source,id,name})=>{const f=new Function(source)(id,name);return f&&f.review_status==='FOUND'}, {source:detailSource,id:row.id,name:row.name}, {timeout:5000});
      else await page.waitForFunction(()=>document.querySelectorAll('#Container .cate_prd_list .prd_info').length===100,null,{timeout:10000});
    } catch {}
  }
  const title=await page.title();
  const text=(await page.locator('body').innerText({timeout:2500})).slice(0,700);
  return {status,error,title,url:page.url(),excerpt:text,blocked:status===403||status===429||/just a moment|captcha|access denied|접속 정보를 확인|잠시만 기다려/i.test(title+' '+text)};
};`;

export type Product = {
  id: string;
  name: string;
  brand: string;
  rank: number;
  category?: string;
};
export type Fields = {
  product_id: string;
  cosmetic_disclosure?: boolean;
  raw: string | null;
  ingredients: string | null;
  review_count: number | null;
  rating: number | null;
  review_status: string;
  disclosure_checked: boolean;
};
export type Detail = {
  id: string;
  blocked: boolean;
  status: number | null;
  error: string | null;
  fields?: Fields | null;
  static_reused?: boolean;
};

export function rankingScript(info: { source_url: string; tab_id: string }) {
  return `async({page})=>{${common}
    const info=${JSON.stringify(info)};const diagnostic=await visit(info.source_url);
    const data=await page.evaluate(()=>({
      selected:Array.from(document.querySelectorAll('#Container li.on>button[title="선택됨"]')).map(e=>({id:e.getAttribute('data-ref-dispcatno')||'',text:e.textContent.trim()})),
      rows:Array.from(document.querySelectorAll('#Container .cate_prd_list .prd_info')).map(card=>{
        let id='';try{id=new URL(card.querySelector('.prd_name a')?.getAttribute('href'),document.baseURI).searchParams.get('goodsNo')||''}catch{}
        return {id,rank:Number(card.querySelector('.thumb_flag.best')?.textContent.trim()),name:card.querySelector('.tx_name')?.textContent.trim()||'',brand:card.querySelector('.tx_brand')?.textContent.trim()||'',category:card.querySelector('[data-ref-goodscategory]')?.getAttribute('data-ref-goodscategory')||''};
      })
    }));return {...diagnostic,...data};}`;
}

export function detailScript(products: (Product & { reuseStatic: boolean })[]) {
  return `async({page})=>{${common}const output=[];
    for(const row of ${JSON.stringify(products)}){
      await page.waitForTimeout(2000);
      const diagnostic=await visit('https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo='+encodeURIComponent(row.id),row);
      const result={id:row.id,...diagnostic,static_reused:row.reuseStatic};
      if(!diagnostic.blocked){
        if(!row.reuseStatic){
          const button=page.getByRole('button',{name:'상품정보 제공고시',exact:true});
          try { if(await button.count()){
            await button.first().click({timeout:2500});
            await page.waitForFunction(({source,id,name})=>new Function(source)(id,name)?.disclosure_checked,{source:detailSource,id:row.id,name:row.name},{timeout:5000});
          }} catch(e){result.disclosure_error=e.name;}
        }
        result.fields=await read(row);
        if(result.fields)delete result.excerpt;
        else {result.headings=(await page.locator('h1,h2,h3').allTextContents()).slice(0,20);result.expectedName=row.name;}
      }
      output.push(result);if(result.blocked)break;
    }return output;}`;
}
