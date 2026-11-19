// Original local synthesis, inspired by the short key tone and alternating
// confirmation sequence of an electronic ballot. No remote audio dependency.
let context;
let voices=[];
export function playBallotSound(kind, enabled=true) {
 if(!enabled)return;
 try {
  const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!AudioContext)return;
  context ||= new AudioContext();
  const start=()=>{
   for(const voice of voices){try{voice.stop();}catch{/* already completed */}}voices=[];
   const at=context.currentTime;
   const tone=(frequency,offset,duration)=>{
    const oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.type='square';oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,at+offset);gain.gain.linearRampToValueAtTime(.035,at+offset+.003);gain.gain.setValueAtTime(.035,at+offset+duration-.008);gain.gain.linearRampToValueAtTime(0,at+offset+duration);
    oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at+offset);oscillator.stop(at+offset+duration);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};voices.push(oscillator);
   };
   if(kind==='finish'){for(let i=0;i<18;i++)tone(i%2?1046:784,i*.045,.043);tone(1046,.82,.16);}
   else if(kind==='confirm'){tone(880,0,.1);tone(1046,.12,.13);}
   else tone(kind==='correct'?330:523,0,kind==='correct'?.11:.055);
  };
  if(context.state==='suspended')void context.resume().then(start).catch(()=>{});else start();
 }catch{/* Audio must never prevent an authoritative vote. */}
}
