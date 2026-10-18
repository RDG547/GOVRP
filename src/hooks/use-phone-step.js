import { useContext, useEffect, useRef } from 'react';
import { usePhoneApp, PhoneBackContext } from '@/contexts/PhoneAppContext';
export function usePhoneStep(value, setValue, root, elementRef, priority=10) {
 const phone=usePhoneApp(),bus=useContext(PhoneBackContext),history=useRef([root]),current=useRef(value),setter=useRef(setValue);setter.current=setValue;
 useEffect(()=>{if(current.current===value)return;current.current=value;const found=history.current.lastIndexOf(value);if(found>=0)history.current=history.current.slice(0,found+1);else history.current.push(value);},[value]);
 useEffect(()=>{
  if(!phone)return;
  const target=bus||elementRef?.current?.ownerDocument?.defaultView||window;
  if(!target.phoneSteps){
   target.phoneSteps=new Map();
   target.phoneStepListener=event=>{
    if(event.defaultPrevented)return;
    for(const step of [...target.phoneSteps.values()].sort((a,b)=>b.priority-a.priority)){
     if(step.back()){event.preventDefault();break;}
    }
   };
   target.addEventListener('govrp:phone-back',target.phoneStepListener);
  }
  const key=Symbol('phone-step');
  target.phoneSteps.set(key,{priority,back:()=>{
   if(current.current===root)return false;
   history.current.pop();const previous=history.current.at(-1)||root;
   current.current=previous;setter.current(previous);return true;
  }});
  return()=>{
   target.phoneSteps.delete(key);
   if(!target.phoneSteps.size){target.removeEventListener('govrp:phone-back',target.phoneStepListener);delete target.phoneSteps;delete target.phoneStepListener;}
  };
 },[phone,root,elementRef,bus,priority]);
}
