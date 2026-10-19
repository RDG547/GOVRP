import React,{useLayoutEffect,useRef} from 'react';
export default function PagedResults({page,loading=false,children,className=''}){
 const ref=useRef(null),previous=useRef(page);
 useLayoutEffect(()=>{if(loading||page===undefined||previous.current===page)return;const direction=page>previous.current?1:-1;previous.current=page;if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)ref.current?.animate([{opacity:.6,transform:`translateX(${direction*12}px)`},{opacity:1,transform:'translateX(0)'}],{duration:160,easing:'ease-out'});},[page,loading]);
 return <div ref={ref} className={`min-w-0 overflow-hidden ${className}`} aria-busy={loading||undefined} data-pagination-page={page}>{children}</div>;
}
