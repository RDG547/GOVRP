import React, {createContext, useContext} from 'react';
const PagingContext=createContext(false);
class SlidingResults extends React.Component {
  content=React.createRef();host=React.createRef();pending=null;animations=[];ghost=null;frame=null;
  getSnapshotBeforeUpdate(previous){
    if(previous.page===this.props.page)return null;
    return {node:this.content.current.cloneNode(true),height:this.content.current.getBoundingClientRect().height,direction:this.props.page>previous.page?1:-1,page:this.props.page};
  }
  componentDidUpdate(previous,state,snapshot){
    if(snapshot)this.pending=snapshot;
    if(!this.props.loading&&this.pending&&this.pending.page===this.props.page){
      cancelAnimationFrame(this.frame);
      this.frame=requestAnimationFrame(()=>{this.frame=requestAnimationFrame(()=>{if(!this.props.loading&&this.pending?.page===this.props.page)this.slide();});});
    }
  }
  componentWillUnmount(){cancelAnimationFrame(this.frame);this.clear();}
  clear(){this.animations.forEach(a=>a.cancel());this.animations=[];this.ghost?.remove();this.ghost=null;}
  slide(){
    const outgoing=this.pending;this.pending=null;this.clear();
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const host=this.host.current,current=this.content.current,width=host.clientWidth,height=current.getBoundingClientRect().height;
    const ghost=outgoing.node;ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.removeAttribute('data-page-current');
    ghost.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
    Object.assign(ghost.style,{position:'absolute',inset:'0 auto auto 0',width:'100%',pointerEvents:'none'});host.append(ghost);this.ghost=ghost;
    const options={duration:250,easing:'cubic-bezier(.2,.7,.2,1)'};
    const leave=ghost.animate([{transform:'translateX(0)'},{transform:`translateX(${-outgoing.direction*width}px)`}],options);
    const enter=current.animate([{transform:`translateX(${outgoing.direction*width}px)`},{transform:'translateX(0)'}],options);
    const resize=host.animate([{height:`${outgoing.height}px`},{height:`${height}px`}],options);this.animations=[leave,enter,resize];
    Promise.all(this.animations.map(a=>a.finished.catch(()=>{}))).then(()=>{if(this.ghost===ghost){ghost.remove();this.ghost=null;}});
  }
  render(){return <div ref={this.host} className={`relative min-w-0 overflow-hidden ${this.props.className||''}`} aria-busy={this.props.loading||undefined} data-pagination-page={this.props.page}><div ref={this.content} data-page-current>{this.props.children}</div></div>;}
}
export default function PagedResults({page,loading=false,children,className=''}){
 const nested=useContext(PagingContext);
 if(page===undefined||nested)return <div className={`min-w-0 ${className}`}>{children}</div>;
 return <PagingContext.Provider value={true}><SlidingResults page={page} loading={loading} className={className}>{children}</SlidingResults></PagingContext.Provider>;
}
