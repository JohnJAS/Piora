(() => {
  const themes = window.CHARACTER_THEMES;
  const names = {whale:'鲸鱼娘',gpt:'GPT 娘',claude:'Claude 娘',kitty:'Kitty 娘',glm:'GLM 娘',ernie:'文心娘',qwen:'Qwen 娘',kimi:'Kimi 娘',seed:'豆包娘',minimax:'MiniMax 娘',grok:'Grok 娘',gemini:'Gemini 娘'};
  const byId = id => document.getElementById(id);
  let family = 'all', mode = 'all', selected = themes.find(t => t.id === 'whale-tide'), artwork = false;
  const button = (label, pressed, click) => { const el=document.createElement('button'); el.type='button'; el.textContent=label; el.setAttribute('aria-pressed', String(pressed)); el.onclick=click; return el; };
  function select(theme) {
    selected=theme;
    const stage=byId('stage');
    ['base','panel','accent','ink'].forEach((key,index)=>stage.style.setProperty('--'+key,theme.palette[index]));
    byId('scene').src=theme.asset; byId('scene').alt=theme.name+'主题原画';
    byId('selected-name').textContent=theme.name;
    byId('family-name').textContent=names[theme.group]+' / '+(theme.mode==='dark'?'NIGHT COLLECTION':'DAY COLLECTION');
    byId('original-link').href=theme.original;
    byId('palette').replaceChildren(...theme.palette.map(color=>{const el=document.createElement('span');el.className='swatch';el.style.background=color;el.title=color;el.setAttribute('aria-label',color);return el;}));
    document.querySelectorAll('.card').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.id===theme.id)));
    try { localStorage.setItem('piora-character-study-selection',theme.id); } catch {}
  }
  function render() {
    const visible=themes.filter(t=>(family==='all'||t.group===family)&&(mode==='all'||t.mode===mode));
    byId('result-count').textContent=visible.length+' / '+themes.length+' 款';
    byId('empty').hidden=visible.length>0;
    byId('cards').replaceChildren(...visible.map(theme=>{
      const el=button('',selected.id===theme.id,()=>select(theme));el.className='card';el.dataset.id=theme.id;el.setAttribute('aria-label',theme.name);
      const img=document.createElement('img');img.src=theme.asset;img.alt='';img.loading='lazy';el.append(img);
      const info=document.createElement('div');info.className='card-info';const title=document.createElement('strong');title.textContent=theme.name;const badge=document.createElement('small');badge.textContent=theme.mode==='dark'?'深色':'浅色';info.append(title,badge);el.append(info);
      const colors=document.createElement('div');colors.className='card-palette';for(const color of theme.palette){const swatch=document.createElement('i');swatch.style.background=color;colors.append(swatch);}el.append(colors);return el;
    }));
  }
  const families=[['all','全部角色'],...Object.entries(names)];
  for(const [id,label] of families){const el=button(label,id==='all',()=>{family=id;byId('family-filters').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===el)));render();});el.dataset.family=id;byId('family-filters').append(el);}
  byId('mode-filters').querySelectorAll('button').forEach(el=>el.onclick=()=>{mode=el.dataset.mode;byId('mode-filters').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===el)));render();});
  function view(art){artwork=art;byId('stage').classList.toggle('art',art);byId('chat-view').setAttribute('aria-pressed',String(!art));byId('art-view').setAttribute('aria-pressed',String(art));byId('stage-label').textContent=art?'原画 · 内置模型生成':'聊天布局模拟';byId('opacity').disabled=art;}
  byId('chat-view').onclick=()=>view(false);byId('art-view').onclick=()=>view(true);
  byId('opacity').oninput=event=>{byId('stage').style.setProperty('--surface-opacity',event.target.value+'%');byId('opacity-value').textContent=event.target.value+'%';};
  try {const saved=themes.find(t=>t.id===localStorage.getItem('piora-character-study-selection'));if(saved)selected=saved;}catch{}
  select(selected);render();view(artwork);
})();
