export function createHeroMotionController({video,mediaQuery}){
  let reduced=Boolean(mediaQuery.matches),disposed=false;
  const pause=()=>{try{video.pause()}catch{}}
  const resume=()=>{
    try{
      const result=video.play();
      if(result&&typeof result.catch==="function")result.catch(()=>{});
    }catch{}
  };
  const onChange=event=>{
    if(disposed)return;
    const next=Boolean(event.matches);
    if(next===reduced)return;
    const wasReduced=reduced;reduced=next;
    if(next)pause();else if(wasReduced)resume();
  };
  if(reduced)pause();
  mediaQuery.addEventListener("change",onChange);
  return{dispose(){if(disposed)return;disposed=true;mediaQuery.removeEventListener("change",onChange)}};
}
