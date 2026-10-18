import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MemoryRouter, Routes, Route, Navigate, useLocation, useNavigate, useNavigationType, UNSAFE_LocationContext, UNSAFE_NavigationContext, UNSAFE_RouteContext } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { PhoneAppContext, PhonePortalContext, PhoneBackContext } from '@/contexts/PhoneAppContext';
import { ServiceSuspensionContext } from '@/contexts/ServiceSuspensionContext';
import ServiceAvailabilityGate from '@/components/ServiceAvailabilityGate';
import ServiceProtectedRoute from '@/components/ServiceProtectedRoute';
import { Button } from '@/components/ui/button';
import Bank from '@/pages/services/Bank';
import Business from '@/pages/services/Business';
import ProductDetails from '@/pages/services/ProductDetails';
import SocialX from '@/pages/services/SocialX';
import XFeed from '@/components/social-x/XFeed';
import XProfile from '@/pages/services/x/Profile';
import XNotifications from '@/pages/services/x/Notifications';
import XMessages from '@/pages/services/x/Messages';
import XSearch from '@/pages/services/x/Search';
import PostDetails from '@/pages/services/x/PostDetails';
import Internet from '@/pages/services/Internet';
import PhoneService from '@/pages/services/PhoneService';
import NationalCitizenCommerce from '@/pages/services/NationalCitizenCommerce';
import MyWork from '@/pages/services/MyWork';
import NationalHealth from '@/pages/services/NationalHealth';
import StockExchange from '@/pages/services/StockExchange';
import News from '@/pages/News';
import Article from '@/pages/Article';

function FullService({ openFull }) {
  const location = useLocation();
  return <div className="space-y-4 p-5 text-center"><h2 className="font-semibold">Abrir serviço completo</h2><p className="text-sm text-muted-foreground">Esta área está disponível no portal principal.</p><Button onClick={()=>openFull(location.pathname+location.search)}><ExternalLink className="mr-2 h-4 w-4"/>Abrir no GOVRP</Button></div>;
}
function AppRoutes({ path, register, goHome, openFull, backBus }) {
  const location=useLocation(), navigate=useNavigate(), navigationType=useNavigationType();
  const history=useRef([location.key]), index=useRef(0);
  useEffect(()=>{
    const found=history.current.indexOf(location.key);
    if(found>=0) index.current=found;
    else if(navigationType==='REPLACE') history.current[index.current]=location.key;
    else {history.current=history.current.slice(0,index.current+1);history.current.push(location.key);index.current=history.current.length-1;}
    register(path,()=>{
      const doc=document.getElementById('citizen-phone')?.querySelector('iframe:not(.hidden)')?.contentDocument;
      if(doc){
        const layers=[...doc.querySelectorAll('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="menu"][data-state="open"],[data-radix-popper-content-wrapper]')];
        const layer=layers.at(-1);
        if(layer){layer.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));return;}
      }
      const step=new CustomEvent('govrp:phone-back',{cancelable:true});
      backBus.dispatchEvent(step);if(step.defaultPrevented)return;
      if(index.current>0)navigate(-1);else if(location.search){navigate(location.pathname,{replace:true});}else goHome();
    });
  },[path,location.key,location.pathname,location.search,navigationType,navigate,goHome,register,backBus]);
  const gate=(key,component)=><ServiceAvailabilityGate serviceKey={key}>{component}</ServiceAvailabilityGate>;
  return <ServiceProtectedRoute><Routes>
    <Route path="/services/bank" element={gate('/services/bank',<Bank/>)}/>
    <Route path="/services/business" element={gate('/services/business',<Business/>)}/>
    <Route path="/services/business/product/:productId" element={gate('/services/business',<ProductDetails/>)}/>
    <Route path="/services/x" element={gate('/services/x',<SocialX/>)}>
      <Route index element={<Navigate to="feed" replace/>}/><Route path="feed" element={<XFeed/>}/>
      <Route path="post/:postId" element={<PostDetails/>}/><Route path="notifications" element={<XNotifications/>}/>
      <Route path="messages" element={<XMessages/>}/><Route path="messages/:conversationId" element={<XMessages/>}/>
      <Route path="search" element={<XSearch/>}/><Route path="profile/:handle" element={<XProfile/>}/>
    </Route>
    <Route path="/services/internet" element={gate('/services/internet',<Internet/>)}/>
    <Route path="/services/phone" element={gate('/services/phone',<PhoneService/>)}/>
    <Route path="/services/national-housing" element={gate('/services/national-housing',<NationalCitizenCommerce housing/>)}/>
    <Route path="/services/my-work" element={gate('/services/my-work',<MyWork/>)}/>
    <Route path="/services/health" element={gate('/services/health',<NationalHealth/>)}/>
    <Route path="/services/stock-exchange" element={gate('/services/stock-exchange',<StockExchange/>)}/>
    <Route path="/news" element={<News/>}/><Route path="/news/:articleId" element={<Article/>}/>
    <Route path="*" element={<FullService openFull={openFull}/>}/>
  </Routes></ServiceProtectedRoute>;
}
export default function PhoneAppViewport({ app, active, register, goHome, openFull }) {
  const frame=useRef(null),[host,setHost]=useState(null);
  const backBus=useRef(new EventTarget()).current;
  const {theme}=useTheme();
  useEffect(()=>{
    const doc=frame.current.contentDocument;
    doc.title=`Aplicativo ${app[0]}`;
    const syncStyles=()=>{doc.head.querySelectorAll('[data-phone-style]').forEach(node=>node.remove());document.head.querySelectorAll('style,link[rel="stylesheet"]').forEach(node=>{const copy=node.cloneNode(true);copy.setAttribute('data-phone-style','');doc.head.append(copy);});};
    syncStyles();
    const observer=new MutationObserver(syncStyles);observer.observe(document.head,{childList:true,subtree:true,characterData:true});
    doc.body.className='bg-background text-foreground phone-app';doc.body.style.margin='0';
    setHost(doc.body);
    return()=>observer.disconnect();
  },[app]);
  useEffect(()=>{if(host)host.ownerDocument.documentElement.className=theme;},[host,theme]);
  // This frame supplies only a mobile viewport. React portals preserve the existing
  // Auth, cart and needs providers; no second app boot or authentication request.
  // Isolate the router contexts so each app owns its memory history independently.
  return <iframe ref={frame} title={`Aplicativo ${app[0]} no celular`} className={`h-full w-full border-0 bg-background ${active?'block':'hidden'}`}>
    {host&&createPortal(<PhonePortalContext.Provider value={host}><PhoneAppContext.Provider value={{openFull}}><ServiceSuspensionContext.Provider value={!active}>
      <UNSAFE_LocationContext.Provider value={null}><UNSAFE_NavigationContext.Provider value={null}><UNSAFE_RouteContext.Provider value={{outlet:null,matches:[],isDataRoute:false}}>
        <PhoneBackContext.Provider value={backBus}><MemoryRouter initialEntries={[app[1]]}><AppRoutes path={app[1]} register={register} goHome={goHome} openFull={openFull} backBus={backBus}/></MemoryRouter></PhoneBackContext.Provider>
      </UNSAFE_RouteContext.Provider></UNSAFE_NavigationContext.Provider></UNSAFE_LocationContext.Provider>
    </ServiceSuspensionContext.Provider></PhoneAppContext.Provider></PhonePortalContext.Provider>,host)}
  </iframe>;
}
