// Bridge between the selected ChatGPT tab and the local Video Image Studio.
// It intentionally uses only the rendered page, never cookies or credentials.
(()=>{
  let activeId='', lastText='', lastChanged=0, busy=false, timer=0;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const input=()=>document.querySelector('#prompt-textarea,textarea[placeholder*="Message"],textarea[placeholder*="Nhắn"],[contenteditable="true"][role="textbox"]');
  const sendButton=()=>{
    const form=input()?.closest('form');
    return form?.querySelector('button[type="submit"]:not([disabled]),[data-testid="send-button"]:not([disabled])')||document.querySelector('[data-testid="send-button"]:not([disabled])')||[...document.querySelectorAll('button')].find(b=>/send[- ]?(prompt|message)|gửi/i.test(`${b.getAttribute('aria-label')||''} ${b.getAttribute('data-testid')||''}`)&&!b.disabled);
  };
  const stopButton=()=>document.querySelector('[data-testid="stop-button"],button[aria-label*="Stop"],button[aria-label*="Dừng"]');
  const ready=()=>!!input();
  const responseText=()=>{
    const messages=[...document.querySelectorAll('[data-message-author-role="assistant"],article[data-testid^="conversation-turn"] [data-message-author-role="assistant"]')];
    return (messages.at(-1)?.innerText||'').trim();
  };
  const diagnostics=()=>({ready:ready(),generating:!!stopButton(),url:location.href});
  const notify=(type,data={})=>new Promise(resolve=>chrome.runtime.sendMessage({type,data},result=>resolve(result||{})));
  async function report(phase, extra={}){
    if(!activeId)return;
    const r=await notify('result',{id:activeId,phase,url:location.href,...extra});
    if(r.error)activeId='';
    return r;
  }
  function setPrompt(node,text){
    node.focus();
    if(node instanceof HTMLTextAreaElement){
      const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      setter.call(node,text);
    }else node.textContent=text;
    node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
  }
  async function send(command){
    const box=input();
    if(!box)throw Error('Không tìm thấy ô nhập ChatGPT.');
    if(!command.prompt?.trim())throw Error('Yêu cầu Studio không có nội dung để gửi.');
    if(stopButton())return;
    if((box.value||box.innerText||'').trim())throw Error('Ô ChatGPT đang có nội dung chưa gửi. Hãy gửi hoặc xóa nội dung đó rồi thử lại.');
    await report('sending');
    setPrompt(box,command.prompt);
    await pause(120);
    const button=sendButton();
    if(!button)throw Error('Không tìm thấy nút Gửi của ChatGPT.');
    button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    button.click();
    await pause(700);
    if((box.value||box.innerText||'').trim()){
      box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      box.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
    }
    await report('sent');
  }
  async function observe(command){
    const text=responseText();
    const generating=!!stopButton();
    if(generating){
      await report('waiting');
      if(text!==lastText){lastText=text;lastChanged=Date.now();await report('partial',{text});}
      return;
    }
    if(text&&text!==lastText){lastText=text;lastChanged=Date.now();await report('partial',{text});return;}
    if(text&&lastChanged&&Date.now()-lastChanged>1800){await report('done',{text});activeId='';lastText='';lastChanged=0;}
  }
  async function tick(){
    if(busy)return;
    busy=true;
    try{
      await notify('heartbeat',{ready:ready(),diagnostics:diagnostics()});
      const state=await notify('poll',{ready:ready(),generating:!!stopButton(),url:location.href});
      if(state.error||state.paused||!state.command)return;
      const command=state.command;
      if(activeId&&activeId!==command.id){activeId='';lastText='';lastChanged=0;}
      if(!activeId){activeId=command.id;await send(command);lastChanged=Date.now();}
      await observe(command);
    }catch(error){await report('error',{error:error.message});activeId='';}
    finally{busy=false;}
  }
  function wake(){if(!timer){timer=setInterval(tick,1500);tick();}}
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message.type==='ping'){reply({ready:ready(),diagnostics:diagnostics()});return;}
    if(message.type==='wake'){wake();reply({ok:true});return;}
  });
  wake();
})();
